// KickoffEngine — the facade the UI calls (doc/backend-design.md §8).
// Phase 1: single peer, in-memory op log. Phase 3 moves the log onto
// Pears/Autobase without changing this surface.

import { sideAtQuorum, tally, thresholdOutcome } from "./consensus";
import { hashOf, shortHash } from "./crypto";
import type { OracleRuntime } from "./oracles";
import { toVerdict } from "./oracles";
import { InMemoryAdapter, opContentHash, type P2PAdapter } from "./p2p";
import { applyOp, emptyState, replay, stakeTotal } from "./reducer";
import { computePayouts, formatUSDt } from "./settlement";
import type {
  AuditEntry,
  Category,
  EvidenceItem,
  LoggedOp,
  Market,
  Op,
  Participant,
  Resolution,
  Room,
  RoomPolicy,
  RoomState,
  RoomView,
  Settlement,
  Side,
  TimelineEvent,
  TimelineEventType,
} from "./types";

const DEMO_CREDIT = 12000n; // 120 test USDt (UC-01/UC-02 business rule)
const MOCK_LABEL = "Mock oracle runtime (scripted) — start the QVAC sidecar for real local inference";

export interface EngineOptions {
  runtime: OracleRuntime;
  runtimeLabel?: string;
  adapter?: P2PAdapter;
  /**
   * Deterministic mode for demo seeding: stable timestamps and ids so that
   * identical seeds on different peers produce byte-identical ops, which the
   * (clock, author, content-hash) dedup then collapses into one history.
   */
  deterministic?: boolean;
  /**
   * Optional on-chain payout executor (WDK): runs after SETTLE (payouts) and
   * after cancellations (refunds) on the resolving peer; returned tx hashes
   * attach via SETTLE_TX / REFUND_TX. Fire-and-forget — the room ledger never
   * blocks on the chain.
   */
  onSettlement?: (batch: {
    marketId: string;
    payouts: { wallet: string; amount: bigint }[];
  }) => Promise<{ wallet: string; txHash: string }[] | null>;
  /**
   * Distributed-jury auto-drive. When true and the room runs in jury mode, this
   * peer automatically (a) casts its own on-device verdict on any market that
   * enters RESOLVING, and (b) — if it is the room creator — tallies the signed
   * verdicts and emits the resolution once quorum is reached. Off by default so
   * the classic committee path and the deterministic demo seed are unchanged.
   */
  autoJury?: boolean;
}

interface LogEntry {
  l: LoggedOp;
  key: string; // `${clock}|${author}|${contentHash}` — identity AND order tiebreak
}

export class KickoffEngine {
  private log: LogEntry[] = [];
  private seen = new Set<string>();
  private clock = 0;
  private state: RoomState = emptyState();
  private listeners = new Set<(view: RoomView) => void>();
  private running = new Set<string>();
  private meParticipant: Participant | null = null;
  private nextId = 1;
  private juryVoted = new Set<string>(); // marketIds this peer has already voted on
  private juryDriving = false; // reentrancy guard for the async drive loop
  private juryDriveDirty = false; // state changed mid-drive → run once more

  private get me(): string | null {
    return this.meParticipant?.wallet ?? null;
  }
  private runtime: OracleRuntime;
  private runtimeLabel: string;
  private adapter: P2PAdapter;
  private deterministic: boolean;
  private detTs = 1_750_000_000_000;
  private onSettlement?: EngineOptions["onSettlement"];
  private autoJury: boolean;

  constructor(opts: EngineOptions) {
    this.runtime = opts.runtime;
    this.runtimeLabel = opts.runtimeLabel ?? MOCK_LABEL;
    this.adapter = opts.adapter ?? new InMemoryAdapter();
    this.deterministic = opts.deterministic ?? false;
    this.onSettlement = opts.onSettlement;
    this.autoJury = opts.autoJury ?? false;
    this.adapter.attach({
      deliver: (ops) => this.receive(ops),
      snapshot: () => this.log.map((e) => e.l),
    });
  }

  /** Leave deterministic seed mode — live ops get real timestamps and unique ids. */
  endDeterministic(): void {
    this.deterministic = false;
  }

  /** Swap the oracle runtime (e.g. mock → QVAC once the sidecar is detected). */
  setRuntime(runtime: OracleRuntime, label: string): void {
    this.runtime = runtime;
    this.runtimeLabel = label;
    this.notify();
  }

  // ─── identity (UC-16) ──────────────────────────────────────────────────────

  /** Deterministic name-derived identity — used by the demo seed only. */
  async loginWithWallet(displayName: string): Promise<Participant> {
    const p: Participant = {
      wallet: `tb1q${displayName.toLowerCase().replace(/[^a-z0-9]/g, "")}`,
      displayName,
      joinedAt: this.now(),
    };
    this.adoptIdentity(p);
    return p;
  }

  /** Act as this participant from now on (per-peer local or WDK identity). */
  adoptIdentity(p: Participant): void {
    this.meParticipant = p;
  }

  get currentWallet(): string | null {
    return this.me;
  }

  // ─── rooms (UC-01, UC-02) ──────────────────────────────────────────────────

  createRoom(input: {
    name: string;
    matchContext: string;
    inviteKey: string;
    policy: RoomPolicy;
    feedMatchId?: string;
  }): Room {
    if (!this.me) throw new Error("log in with a wallet first (UC-16)");
    const room: Room = {
      id: `room_${this.genId()}`,
      inviteKey: input.inviteKey,
      name: input.name,
      matchContext: input.matchContext,
      feedMatchId: input.feedMatchId,
      creator: this.me,
      policy: input.policy,
    };
    this.append({ type: "ROOM_CREATE", room });
    this.append({
      type: "PEER_JOIN",
      participant: { wallet: this.me, displayName: this.displayNameOf(this.me), joinedAt: this.now() },
      demoCredit: DEMO_CREDIT,
    });
    return room;
  }

  /** Phase 1 stand-in for P2P join: adds a peer directly (UC-02). */
  joinAs(participant: Participant): void {
    this.append({ type: "PEER_JOIN", participant, demoCredit: DEMO_CREDIT }, participant.wallet);
  }

  // ─── markets (UC-03, UC-04, UC-13) ─────────────────────────────────────────

  createMarket(input: {
    id?: string;
    question: string;
    category: Category;
    trigger?: TimelineEventType;
  }): string {
    const room = this.requireRoom();
    const id = input.id ?? `mkt_${this.genId()}`;
    this.append({
      type: "MARKET_CREATE",
      market: {
        id,
        roomId: room.id,
        question: input.question,
        category: input.category,
        createdBy: this.me ?? "system",
        createdAt: this.now(),
        trigger: input.trigger,
      },
    });
    return id;
  }

  placeStake(marketId: string, wallet: string, side: Side, amount: bigint, txRef?: string): void {
    this.append({ type: "STAKE_PLACE", stake: { marketId, wallet, side, amount, txRef } }, wallet);
  }

  lockMarket(marketId: string): void {
    this.append({ type: "MARKET_LOCK", marketId });
  }

  cancelMarket(marketId: string, reason: string): void {
    const stakes = this.requireMarket(marketId).stakes;
    this.append({ type: "MARKET_CANCEL", marketId, reason });
    this.refundOnChain(marketId, stakes);
  }

  /** On-chain refunds after cancellation (host escrow → stakers), best-effort. */
  private refundOnChain(marketId: string, stakes: { wallet: string; amount: bigint }[]): void {
    if (!this.onSettlement || stakes.length === 0) return;
    const payouts = stakes.map((s) => ({ wallet: s.wallet, amount: s.amount }));
    void this.onSettlement({ marketId, payouts })
      .then((txs) => {
        if (txs && txs.length > 0) this.append({ type: "REFUND_TX", marketId, txs });
      })
      .catch(() => {});
  }

  // ─── evidence (UC-05, UC-06) ───────────────────────────────────────────────

  async emitEvent(event: Omit<TimelineEvent, "id"> & { id?: string }): Promise<TimelineEvent> {
    // Fixed ids (demo script) keep the op identical across peers → dedup by content.
    const full: TimelineEvent = { ...event, id: event.id ?? `evt_${this.genId()}` };
    this.append({ type: "EVENT_EMIT", event: full });
    if (full.type === "FULL_TIME") await this.autoResolveAtFullTime();
    return full;
  }

  /**
   * At full time the creator auto-closes staking and freezes the complete feed
   * as each market's evidence — so no manual "close staking" / "lock evidence"
   * step is needed. Each device then casts its verdict via castJuryVerdict.
   */
  private async autoResolveAtFullTime(): Promise<void> {
    if (!this.state.room?.policy.jury) return; // jury-mode behaviour only
    if (this.me == null || this.me !== this.state.room?.creator) return;
    if (!this.state.timeline.some((e) => e.type === "FULL_TIME")) return;
    const ids = this.state.markets.map((m) => m.id);
    for (const id of ids) {
      const m = this.state.markets.find((x) => x.id === id);
      if (m?.status === "OPEN") this.append({ type: "MARKET_LOCK", marketId: id });
    }
    for (const id of ids) {
      const m = this.state.markets.find((x) => x.id === id);
      if (m && !m.bundle && m.status === "AWAITING_EVIDENCE") await this.lockWholeFeed(id);
    }
  }

  private async lockWholeFeed(marketId: string): Promise<void> {
    const items: EvidenceItem[] = [...this.state.timeline]
      .sort((a, b) => a.minute - b.minute)
      .map((ev) => ({
        weight: "PRIMARY",
        kind: "FEED_EVENT",
        content: `${ev.minute}' — ${ev.description}${ev.detail ? ` · ${ev.detail}` : ""}`,
        eventRef: ev.id,
      }));
    await this.lockBundle(marketId, items);
  }

  async lockBundle(marketId: string, items: EvidenceItem[]): Promise<void> {
    const version = 1;
    const hash = await hashOf({ marketId, version, items });
    this.append({
      type: "BUNDLE_LOCK",
      bundle: { marketId, version, items, hash, lockedAt: this.now() },
    });
  }

  // ─── resolution pipeline (UC-07 … UC-10) ───────────────────────────────────

  async runOracles(marketId: string): Promise<void> {
    const market = this.requireMarket(marketId);
    const room = this.requireRoom();
    if (!market.bundle || market.status !== "RESOLVING" || this.running.has(marketId)) return;

    this.running.add(marketId);
    this.notify();
    try {
      // Sequential and independent — one inference run per oracle (§7.2).
      for (const cfg of room.policy.committee) {
        const req = {
          oracle: cfg.id,
          model: cfg.model,
          question: market.question,
          bundle: this.requireMarket(marketId).bundle!,
        };
        const result = await this.runtime.judge(req);
        this.append({ type: "VERDICT_RECORD", verdict: await toVerdict(req, result, marketId) });
      }
    } finally {
      this.running.delete(marketId);
      this.notify();
    }

    const after = this.requireMarket(marketId);
    const outcome = thresholdOutcome(tally(after.verdicts), room.policy);
    if (outcome) {
      await this.resolve(marketId, outcome, "CONSENSUS");
    }
    // Threshold unmet → the reducer has already set NO_CONSENSUS; the fallback
    // runs on an explicit trigger (runFallback), mirroring the runner's role.
  }

  async runFallback(marketId: string): Promise<void> {
    const market = this.requireMarket(marketId);
    const room = this.requireRoom();
    if (market.status !== "NO_CONSENSUS") return;

    // TIEBREAKER_LLM: an extra oracle judges the same locked bundle (§7.4).
    const req = {
      oracle: "TIEBREAKER",
      model: room.policy.fallback.model,
      question: market.question,
      bundle: market.bundle!,
    };
    this.running.add(marketId);
    this.notify();
    try {
      const result = await this.runtime.judge(req);
      this.append({ type: "VERDICT_RECORD", verdict: await toVerdict(req, result, marketId) });
    } finally {
      this.running.delete(marketId);
      this.notify();
    }
    const verdict = this.requireMarket(marketId).verdicts.find((v) => v.oracle === "TIEBREAKER");
    if (verdict && verdict.verdict !== "INSUFFICIENT_EVIDENCE") {
      await this.resolve(marketId, verdict.verdict, "TIEBREAKER", true);
    } else {
      const stakes = this.requireMarket(marketId).stakes;
      this.append({ type: "FALLBACK_RESULT", marketId, cancelReason: "tiebreaker found the evidence insufficient" });
      this.refundOnChain(marketId, stakes);
    }
  }

  // ─── distributed jury (UC-07 variant: the swarm is the oracle) ─────────────

  /**
   * Run *this* peer's on-device judge over the locked evidence and broadcast one
   * signed verdict. Every participant calls this independently; the reducer keeps
   * one vote per juror and binds it to the evidence hash. Safe to call repeatedly
   * — it is a no-op once this peer has voted or while its inference is in flight.
   */
  async castJuryVerdict(marketId: string, model?: string): Promise<void> {
    const room = this.state.room;
    const me = this.me;
    if (!room?.policy.jury || !me) return;
    const market = this.state.markets.find((x) => x.id === marketId);
    if (!market?.bundle || market.status !== "RESOLVING") return;
    if (this.juryVoted.has(marketId) || this.running.has(marketId)) return;
    if (market.verdicts.some((v) => v.juror === me)) {
      this.juryVoted.add(marketId);
      return;
    }
    if (!this.state.participants.some((p) => p.wallet === me)) return; // must be a seated peer

    this.running.add(marketId);
    this.notify();
    try {
      // Each juror judges on THEIR OWN chosen model (falling back to the room
      // default) — different brains, one verdict each, bound to the same evidence.
      const req = { oracle: me, model: model ?? room.policy.jury.model, question: market.question, bundle: market.bundle };
      const result = await this.runtime.judge(req);
      const verdict = { ...(await toVerdict(req, result, marketId)), juror: me };
      this.juryVoted.add(marketId);
      this.append({ type: "VERDICT_RECORD", verdict });
    } finally {
      this.running.delete(marketId);
      this.notify();
    }
  }

  /** The peer responsible for announcing tallied resolutions (room creator). */
  private juryResolver(): string | null {
    return this.state.room?.policy.jury ? (this.state.room.creator ?? null) : null;
  }

  /**
   * Debounced auto-drive: cast our own verdict on live jury markets and, if we
   * are the resolver, announce any market that has reached quorum (or fall to
   * the tiebreaker once a fully-voted jury never agreed). Idempotent and
   * convergence-safe: the resolution is a pure tally of the replicated signed
   * verdicts, so any peer can verify it — the resolver only publishes the count.
   */
  private scheduleJuryDrive(): void {
    if (!this.autoJury || !this.state.room?.policy.jury) return;
    if (this.juryDriving) {
      this.juryDriveDirty = true; // verdicts landed mid-drive — re-check after
      return;
    }
    this.juryDriving = true;
    queueMicrotask(() => {
      void this.driveJury().finally(() => {
        this.juryDriving = false;
        if (this.juryDriveDirty) {
          this.juryDriveDirty = false;
          this.scheduleJuryDrive();
        }
      });
    });
  }

  private async driveJury(): Promise<void> {
    const jury = this.state.room?.policy.jury;
    if (!jury) return;
    // Jurors cast their verdict via an explicit per-device action (castJuryVerdict),
    // not automatically. The resolver's only automatic job is to tally the signed
    // verdicts and publish the outcome once quorum is reached (or the tiebreaker).
    const amResolver = this.me != null && this.me === this.juryResolver();
    if (!amResolver) return;

    for (const m of this.state.markets) {
      if (m.status === "RESOLVING" && m.bundle) {
        const outcome = sideAtQuorum(tally(m.verdicts), jury.quorum);
        if (outcome) await this.resolve(m.id, outcome, "CONSENSUS");
      } else if (m.status === "NO_CONSENSUS" && !this.running.has(m.id)) {
        // Jury split (everyone voted, no quorum) → the tiebreaker judge decides.
        await this.runFallback(m.id);
      }
    }
  }

  private async resolve(marketId: string, outcome: Side, via: Resolution["via"], viaFallback = false): Promise<void> {
    const market = this.requireMarket(marketId);
    const keyOf = (v: { juror?: string; oracle: string }) => v.juror ?? v.oracle;
    const ordered = [...market.verdicts].sort((a, b) => (keyOf(a) < keyOf(b) ? -1 : 1));
    const resolution: Resolution = {
      outcome,
      via,
      counts: tally(market.verdicts),
      votesHash: ordered.length > 0 ? await hashOf(ordered) : "",
      resolvedAt: Date.now(),
    };
    if (viaFallback) {
      this.append({ type: "FALLBACK_RESULT", marketId, resolution });
    } else {
      this.append({ type: "MARKET_RESOLVE", marketId, resolution });
    }
    await this.settle(marketId);
  }

  private async settle(marketId: string): Promise<void> {
    const market = this.requireMarket(marketId);
    if (market.status !== "RESOLVED" || !market.resolution) return;
    const payouts = computePayouts(market.stakes, market.resolution.outcome);
    const pot = market.stakes.reduce((a, s) => a + s.amount, 0n);
    const explanation = await this.runtime.explain(market, market.resolution, market.verdicts);
    const settlement: Settlement = {
      marketId,
      pot,
      winningSide: market.resolution.outcome,
      payouts,
      explanation,
      confirmedAt: Date.now(),
    };
    this.append({ type: "SETTLE", settlement });

    // On-chain receipts (WDK, Sepolia): async, best-effort, never blocking.
    if (this.onSettlement) {
      void this.onSettlement(settlement)
        .then((txs) => {
          if (txs && txs.length > 0) this.append({ type: "SETTLE_TX", marketId, txs });
        })
        .catch(() => {});
    }
  }

  // ─── reads ────────────────────────────────────────────────────────────────

  getView(): RoomView {
    return { ...this.state, runningOracles: [...this.running], oracleRuntime: this.runtimeLabel };
  }

  getAuditLog(marketId: string): AuditEntry[] {
    const m = this.state.markets.find((x) => x.id === marketId);
    if (!m) return [];
    const room = this.state.room;
    const entries: AuditEntry[] = [{ key: "Market", value: m.question }];
    if (m.bundle) entries.push({ key: "Evidence hash", value: m.bundle.hash });
    if (m.resolution?.votesHash) entries.push({ key: "Oracle vote hash", value: m.resolution.votesHash });
    if (room?.policy.jury) {
      const jurors = m.verdicts.filter((v) => v.juror).length;
      entries.push({ key: "Oracle mode", value: "DISTRIBUTED_JURY" });
      entries.push({ key: "Quorum", value: `${room.policy.jury.quorum}_of_${jurors}_jurors` });
    } else if (room) {
      entries.push({ key: "Threshold", value: `${room.policy.threshold}_of_${room.policy.committee.length}` });
    }
    if (m.resolution) {
      entries.push({ key: "Final outcome", value: m.resolution.outcome });
      entries.push({ key: "Resolved via", value: m.resolution.via });
    }
    entries.push({ key: "Settlement mode", value: "TEST_USDT" });
    for (const tx of m.settlement?.txRefs ?? []) {
      entries.push({ key: `Sepolia tx → ${tx.wallet.slice(0, 8)}…`, value: tx.txHash });
    }
    for (const tx of m.refundTxs ?? []) {
      entries.push({ key: `Refund tx → ${tx.wallet.slice(0, 8)}…`, value: tx.txHash });
    }
    for (const st of m.stakes) {
      if (st.txRef) entries.push({ key: `Stake tx ← ${st.wallet.slice(0, 8)}…`, value: st.txRef });
    }
    if (m.resolution) {
      const minute = this.primaryMinuteOf(m);
      const time = new Date(m.resolution.resolvedAt).toLocaleTimeString();
      entries.push({ key: "Timestamp", value: minute ? `${minute}' event / resolved at ${time}` : `resolved at ${time}` });
    }
    return entries;
  }

  subscribe(listener: (view: RoomView) => void): () => void {
    this.listeners.add(listener);
    listener(this.getView());
    return () => this.listeners.delete(listener);
  }

  // ─── demo utilities (UC-15) ────────────────────────────────────────────────

  /** Log-length checkpoint for the presentation-only oracle reset. */
  checkpoint(): number {
    return this.log.length;
  }

  /**
   * Truncate the local log and replay — demo-only; real logs are append-only.
   * Under P2P the truncated ops may return from peers on the next sync.
   */
  resetTo(length: number): void {
    const removed = this.log.splice(length);
    for (const e of removed) this.seen.delete(e.key);
    this.state = replay(this.log.map((e) => e.l));
    this.notify();
  }

  // ─── internals ────────────────────────────────────────────────────────────

  private append(op: Op, author?: string): void {
    const logged: LoggedOp = {
      clock: ++this.clock,
      ts: this.now(),
      author: author ?? this.me ?? "system",
      op,
    };
    // Publish through the adapter; it echoes back synchronously via receive(),
    // so callers can read their own writes immediately.
    this.adapter.append(logged);
  }

  /** Ingest ops (local echoes and remote peers alike); idempotent and order-free. */
  private receive(incoming: LoggedOp[]): void {
    const appended: LogEntry[] = [];
    let inOrder = true;
    for (const l of incoming) {
      const key = `${l.clock}|${l.author}|${opContentHash(l.op)}`;
      if (this.seen.has(key)) continue;
      this.seen.add(key);
      this.clock = Math.max(this.clock, l.clock);
      const entry: LogEntry = { l, key };
      const last = this.log[this.log.length - 1];
      if (!last || compareEntries(last, entry) < 0) {
        this.log.push(entry);
        appended.push(entry);
      } else {
        let idx = this.log.findIndex((e) => compareEntries(entry, e) < 0);
        if (idx === -1) idx = this.log.length;
        this.log.splice(idx, 0, entry);
        inOrder = false;
      }
    }
    if (appended.length === 0 && inOrder) return;
    if (inOrder) {
      for (const e of appended) this.state = applyOp(this.state, e.l);
    } else {
      // An op landed in the middle of history — replay for convergence.
      this.state = replay(this.log.map((e) => e.l));
    }
    this.notify();
    // React to new state: cast our vote / announce a quorum in jury mode.
    this.scheduleJuryDrive();
  }

  private now(): number {
    return this.deterministic ? (this.detTs += 1000) : Date.now();
  }

  private notify(): void {
    const view = this.getView();
    for (const l of this.listeners) l(view);
  }

  private genId(): string {
    const n = (this.nextId++).toString(36);
    return this.deterministic ? `d${n}` : `${n}${Math.random().toString(36).slice(2, 6)}`;
  }

  private requireRoom(): Room {
    if (!this.state.room) throw new Error("no room yet (UC-01)");
    return this.state.room;
  }

  private requireMarket(marketId: string): Market {
    const m = this.state.markets.find((x) => x.id === marketId);
    if (!m) throw new Error(`unknown market ${marketId}`);
    return m;
  }

  private displayNameOf(wallet: string): string {
    if (this.meParticipant?.wallet === wallet) return this.meParticipant.displayName;
    const p = this.state.participants.find((x) => x.wallet === wallet);
    if (p) return p.displayName;
    const raw = wallet.replace(/^tb1q/, "");
    return raw.charAt(0).toUpperCase() + raw.slice(1);
  }

  private primaryMinuteOf(m: Market): number | null {
    const ref = m.bundle?.items.find((i) => i.weight === "PRIMARY")?.eventRef;
    const evt = this.state.timeline.find((e) => e.id === ref);
    return evt?.minute ?? null;
  }
}

function compareEntries(a: LogEntry, b: LogEntry): number {
  if (a.l.clock !== b.l.clock) return a.l.clock - b.l.clock;
  if (a.l.author !== b.l.author) return a.l.author < b.l.author ? -1 : 1;
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
}

export { formatUSDt, shortHash, stakeTotal };
