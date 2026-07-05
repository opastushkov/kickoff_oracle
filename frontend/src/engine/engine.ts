// KickoffEngine — the facade the UI calls (doc/backend-design.md §8).
// Phase 1: single peer, in-memory op log. Phase 3 moves the log onto
// Pears/Autobase without changing this surface.

import { evaluateFacts, tally, thresholdOutcome } from "./consensus";
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
  FactsRule,
  LoggedOp,
  Market,
  Op,
  Participant,
  Resolution,
  Room,
  RoomPolicy,
  RoomState,
  RoomView,
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

  private get me(): string | null {
    return this.meParticipant?.wallet ?? null;
  }
  private runtime: OracleRuntime;
  private runtimeLabel: string;
  private adapter: P2PAdapter;
  private deterministic: boolean;
  private detTs = 1_750_000_000_000;

  constructor(opts: EngineOptions) {
    this.runtime = opts.runtime;
    this.runtimeLabel = opts.runtimeLabel ?? MOCK_LABEL;
    this.adapter = opts.adapter ?? new InMemoryAdapter();
    this.deterministic = opts.deterministic ?? false;
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

  createRoom(input: { name: string; matchContext: string; inviteKey: string; policy: RoomPolicy }): Room {
    if (!this.me) throw new Error("log in with a wallet first (UC-16)");
    const room: Room = {
      id: `room_${this.genId()}`,
      inviteKey: input.inviteKey,
      name: input.name,
      matchContext: input.matchContext,
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
    factsRule?: FactsRule;
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
        factsRule: input.factsRule,
      },
    });
    return id;
  }

  placeStake(marketId: string, wallet: string, side: Side, amount: bigint): void {
    this.append({ type: "STAKE_PLACE", stake: { marketId, wallet, side, amount } }, wallet);
  }

  lockMarket(marketId: string): void {
    this.append({ type: "MARKET_LOCK", marketId });
  }

  cancelMarket(marketId: string, reason: string): void {
    this.append({ type: "MARKET_CANCEL", marketId, reason });
  }

  // ─── evidence (UC-05, UC-06) ───────────────────────────────────────────────

  async emitEvent(event: Omit<TimelineEvent, "id"> & { id?: string }): Promise<TimelineEvent> {
    // Fixed ids (demo script) keep the op identical across peers → dedup by content.
    const full: TimelineEvent = { ...event, id: event.id ?? `evt_${this.genId()}` };
    this.append({ type: "EVENT_EMIT", event: full });
    await this.shortCircuitObjectiveMarkets();
    return full;
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
      // Sequential and independent — one session per oracle (§7.2).
      for (const cfg of room.policy.committee) {
        const req = {
          role: cfg.role,
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

    const fallback = room.policy.fallback;
    if (fallback.kind === "FACTS") {
      const outcome = market.factsRule ? evaluateFacts(market.factsRule, this.state.timeline) : null;
      if (outcome) {
        await this.resolve(marketId, outcome, "FACTS", true);
      } else {
        this.append({ type: "FALLBACK_RESULT", marketId, cancelReason: "facts inconclusive" });
      }
      return;
    }

    // TIEBREAKER_LLM: a fourth oracle judges the same locked bundle (§7.4).
    const req = {
      role: "TIEBREAKER" as const,
      model: fallback.model,
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
    const verdict = this.requireMarket(marketId).verdicts.find((v) => v.role === "TIEBREAKER");
    if (verdict && verdict.verdict !== "INSUFFICIENT_EVIDENCE") {
      await this.resolve(marketId, verdict.verdict, "TIEBREAKER", true);
    } else {
      this.append({ type: "FALLBACK_RESULT", marketId, cancelReason: "tiebreaker found the evidence insufficient" });
    }
  }

  private async resolve(marketId: string, outcome: Side, via: Resolution["via"], viaFallback = false): Promise<void> {
    const market = this.requireMarket(marketId);
    const ordered = [...market.verdicts].sort((a, b) => (a.role < b.role ? -1 : 1));
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
    this.append({
      type: "SETTLE",
      settlement: {
        marketId,
        pot,
        winningSide: market.resolution.outcome,
        payouts,
        explanation,
        confirmedAt: Date.now(),
      },
    });
  }

  /** Objective markets resolve directly from feed facts, no committee (UC-14). */
  private async shortCircuitObjectiveMarkets(): Promise<void> {
    for (const m of this.state.markets) {
      if (m.category !== "OBJECTIVE" || !m.factsRule) continue;
      if (!["OPEN", "AWAITING_EVIDENCE", "RESOLVING"].includes(m.status)) continue;
      const outcome = evaluateFacts(m.factsRule, this.state.timeline);
      if (outcome) await this.resolve(m.id, outcome, "FACTS");
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
    if (room) {
      entries.push({ key: "Threshold", value: `${room.policy.threshold}_of_${room.policy.committee.length}` });
    }
    if (m.resolution) {
      entries.push({ key: "Final outcome", value: m.resolution.outcome });
      entries.push({ key: "Resolved via", value: m.resolution.via });
    }
    entries.push({ key: "Settlement mode", value: "TEST_USDT" });
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
