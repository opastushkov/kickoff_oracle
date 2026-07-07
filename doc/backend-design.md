# Kickoff Oracle — Backend Design

> Companion to [platform-analysis.md](platform-analysis.md) and
> [use-case-scenarios.md](use-case-scenarios.md). Status: **Phase 1 implemented** — the
> room engine described here lives in `frontend/src/engine/` (op log + reducers, canonical
> JSON + SHA-256 hashing, consensus + fallback, settlement math, single peer; selftest:
> `pnpm engine:test`). **Phase 2 is implemented too**: oracle verdicts run on a real local
> LLM (Llama 3.2 1B) through the QVAC SDK, bridged by `frontend/sidecar/` because the SDK
> requires Node/Bare, not a browser tab. **Phase 3 has a first cut**: rooms replicate
> across devices over Hyperswarm via the sidecar's room node (op relay + JSONL
> persistence; Autobase/Hypercore upgrade pending). **Phase 4 is implemented**: identity
> is a real WDK self-custodial wallet (Sepolia address; seed never leaves the machine),
> and settlements execute as real Sepolia transactions from the resolving peer's wallet
> (runner-as-paymaster), with tx hashes attached to the settlement and audit log.
> Every section references the use cases (UC-xx) it implements.

## 1. Design constraints

1. **Serverless.** There is no central server to deploy. The "backend" is a **room engine**
   that runs inside every peer's app; peers replicate state over Pears (P2P). One peer being
   offline must not lose room history.
2. **Local-first AI.** Oracles are LLMs running on-device via QVAC. No evidence or verdict
   leaves the machine except through room replication.
3. **Deterministic & auditable.** Given the same operation log, every peer must compute the
   same room state. Everything that influences a resolution (evidence, verdicts, threshold,
   fallback) is hashed and recorded (UC-06, UC-12).
4. **Demo money only.** All value flows are test USDt via WDK. No real-money paths.
5. **Hackathon-pragmatic.** Each module ships behind an interface with a mock
   implementation, so the demo works end-to-end at every phase (see §10).

## 2. Architecture overview

The engine is a library the React app calls directly — in the browser during development,
inside a Pear desktop app later. There is no HTTP API; the "API" is a TypeScript facade
(§8) plus an event stream.

```
┌────────────────────────────  each peer  ────────────────────────────┐
│  React UI (frontend/src/app)                                        │
│      │  KickoffEngine facade (§8)                                   │
│      ▼                                                              │
│  ┌───────────────────────  room engine  ────────────────────────┐   │
│  │ core/        op log + reducers → room state (§5)             │   │
│  │ crypto/      canonical JSON, SHA-256, hash chain (§7.1)      │   │
│  │ consensus/   threshold + fallback: facts / tiebreaker (§7.3) │   │
│  │ oracles/     personas, prompts, QVAC runner (§7.2)           │   │
│  │ settlement/  escrow + pro-rata payouts (§9)                  │   │
│  │ feed/        match event source: replay / manual / live      │   │
│  │ p2p/         room replication, invite keys                   │   │
│  └───────────────┬──────────────┬───────────────┬───────────────┘   │
│                  ▼              ▼               ▼                   │
│               Pears           QVAC             WDK                  │
│          (Hyperswarm /   (local LLM       (wallet login,            │
│           Autobase)       inference)       test-USDt)               │
└─────────────────────────────────────────────────────────────────────┘
```

### Technology mapping

| Concern | Technology | Notes |
|---|---|---|
| Peer discovery & transport | **Pears / Hyperswarm** | Room invite key ↔ swarm topic (UC-01, UC-02) |
| Multi-writer replicated log | **Pears / Autobase** | Total order over peer operations; reducers replay deterministically |
| Local LLM inference | **QVAC** | One session per oracle, model chosen in the room policy (UC-01, UC-07) |
| Wallet, balances, payouts | **WDK** | Wallet login (UC-16), test-USDt escrow and settlement (UC-04, UC-10) |
| Hashing | Web Crypto SHA-256 | Available in browser and Bare; no native deps |

## 3. Identity (UC-16)

A user *is* a wallet. On login, WDK connects (or creates) a Tether wallet; the engine
derives from the address:

- `participantId` = wallet address;
- display name / avatar seed (deterministic from the address, user-overridable);
- the test-USDt balance shown in the wallet chip.

All stakes, payouts, and op signatures reference the wallet address. Without login, the
engine is read-only (cannot create/join rooms — matches the UC-16 exception flow).

## 4. Data model

```ts
type Category = "OBJECTIVE" | "INTERPRETIVE";            // Social removed from scope
type Side = "YES" | "NO";
type Verdict = "YES" | "NO" | "INSUFFICIENT_EVIDENCE";
type MarketStatus =
  | "DRAFT" | "OPEN" | "LOCKED" | "AWAITING_EVIDENCE" | "RESOLVING"
  | "RESOLVED" | "NO_CONSENSUS" | "SETTLED" | "CANCELLED";

interface OracleConfig {
  id: string;                          // committee slot, e.g. "oracle-1" — interchangeable peers
  model: string;                       // QVAC model id, chosen by room creator (UC-01)
}

interface RoomPolicy {                 // room-level, immutable after ROOM_CREATE (UC-01)
  committee: OracleConfig[];           // 1–5 oracles; size chosen at room creation
  threshold: number;                   // votes required, e.g. 2 (of committee.length)
  fallback:                            // no-consensus route (UC-09): an extra LLM
    { kind: "TIEBREAKER_LLM"; model: string };
}

interface Room {
  id: string;                          // derived from the Autobase key
  inviteKey: string;                   // short human code, e.g. room_7KQ9 → swarm topic
  name: string;                        // "Ukraine vs Spain Watch Party"
  matchContext: string;
  creator: string;                     // wallet address
  policy: RoomPolicy;
}

interface Participant { wallet: string; displayName: string; joinedAt: number; }

interface TimelineEvent {              // room-level evidence stream (UC-05)
  id: string;
  minute: number;                      // 67
  type: "GOAL" | "PENALTY" | "VAR" | "CARD" | "FULL_TIME";
  description: string;                 // "Penalty — Ukraine"
  detail?: string;                     // "VAR confirmed"
  source: "REPLAY" | "MANUAL" | "LIVE";
}

interface EvidenceItem {
  weight: "PRIMARY" | "SECONDARY" | "CONTEXT";
  kind: "FEED_EVENT" | "MANUAL_NOTE" | "RULEBOOK";
  content: string;
  author?: string;                     // wallet address for manual notes
  eventRef?: string;                   // TimelineEvent.id for FEED_EVENT items
}

interface EvidenceBundle {             // per market, versioned + locked (UC-06)
  marketId: string;
  version: number;
  items: EvidenceItem[];
  hash: string;                        // SHA-256 over canonical JSON (§7.1)
  lockedAt?: number;
}

interface Stake { marketId: string; wallet: string; side: Side; amount: bigint; }
                                       // amount in minor units of test USDt

interface OracleVerdict {              // one per committee member (UC-07)
  marketId: string;
  bundleHash: string;                  // binds verdict to the exact locked evidence
  oracle: string;                      // committee slot id, or "TIEBREAKER" for the fallback
  model: string;
  verdict: Verdict;
  confidence: number;                  // 0–100, informational only
  reason: string;
  outputHash: string;                  // SHA-256 of the raw model output
}

interface Resolution {                 // (UC-08 / UC-09)
  outcome: Side;
  via: "CONSENSUS" | "TIEBREAKER";
  counts: { yes: number; no: number; insufficient: number };
  votesHash: string;                   // SHA-256 over ordered verdicts
}

interface Settlement {                 // (UC-10)
  marketId: string;
  pot: bigint;
  winningSide: Side;
  payouts: { wallet: string; amount: bigint }[];
  confirmedAt: number;
}
```

The audit log (UC-12) is not stored separately — it is a projection over the op log:
market question, `bundle.hash`, `resolution.votesHash`, threshold, outcome, settlement
mode, timestamps.

## 5. Replicated operation log

All state changes are operations appended to the room's Autobase. Reducers are pure
functions `(state, op) → state`; peers converge because Autobase gives a total order.

| Op | Emitted by | Effect | UC |
|---|---|---|---|
| `ROOM_CREATE {name, matchContext, policy}` | creator | Genesis op; policy becomes immutable | UC-01 |
| `PEER_JOIN {wallet, displayName}` | joining peer | Adds participant | UC-02, UC-16 |
| `MARKET_CREATE {question, category}` | any peer | New market in OPEN; inherits room policy | UC-03 |
| `MARKET_LOCK {marketId}` | creator | Closes the staking window; market awaits evidence | UC-04, UC-05 |
| `STAKE_PLACE {marketId, side, amount}` | participant | Validates balance, escrows via WDK | UC-04 |
| `EVENT_EMIT {event}` | feed module / creator | Appends to timeline; flips dependent markets to RESOLVING | UC-05 |
| `BUNDLE_LOCK {marketId, items, hash}` | creator | Freezes evidence; enables oracle run | UC-06 |
| `VERDICT_RECORD {verdict}` | oracle runner (host) | One per committee member; rejected if `bundleHash` mismatches | UC-07 |
| `MARKET_RESOLVE {resolution}` | engine (deterministic) | Emitted when all verdicts are in and threshold evaluated | UC-08 |
| `FALLBACK_RESULT {resolution \| cancel}` | engine | Tiebreaker verdict, or cancellation with refunds | UC-09 |
| `SETTLE {settlement}` | settlement module | Pays out pot; markets → SETTLED | UC-10 |
| `MARKET_CANCEL {reason}` | creator / engine | Refunds all stakes | UC-13 |

Validation is part of the reducer: an op that violates the state machine (staking on a
LOCKED market, re-locking a bundle, a second `VERDICT_RECORD` for the same role) is
ignored by every peer identically, so invalid ops cannot fork state.

**Ordering (implemented):** ops are totally ordered by `(Lamport clock, author wallet,
content hash)` and deduplicated by the same triple; a peer that receives an op out of
order re-replays the log. Adapters (in-memory, BroadcastChannel, WebSocket→Hyperswarm)
only move ops — they never have to order them. Autobase can replace this ordering later
without touching the reducers.

## 6. Market lifecycle

```
DRAFT → OPEN → LOCKED → AWAITING_EVIDENCE → RESOLVING ──► RESOLVED ──► SETTLED
                                               │
                                               └─► NO_CONSENSUS ─► fallback (§7.4)
                                                       ├─► RESOLVED ─► SETTLED
                                                       └─► CANCELLED (stakes refunded)
        (any pre-resolution state) ────────────────────────► CANCELLED
```

Objective markets take a short-circuit: on `EVENT_EMIT`, the engine checks the question's
match rule against the feed event and can resolve directly without the committee (UC-14);
the committee at most confirms the factual match.

## 7. Resolution pipeline

### 7.1 Evidence lock & hashing (UC-06)

- Canonical JSON: keys sorted, no whitespace, numbers normalized — so every peer hashes
  identical bytes.
- `bundle.hash = sha256(canonical(bundle.items + marketId + version))`.
- `BUNDLE_LOCK` records the hash **before any oracle sees the bundle**; verdicts referencing
  a different `bundleHash` are rejected by the reducer. This is what makes "no re-rolling
  evidence" enforceable rather than aspirational.

### 7.2 Oracle execution (UC-07)

The peer that triggers "Run oracles" (the *runner*, normally the host) executes the
committee **sequentially and independently** — one QVAC session per oracle, no shared
context:

- Prompt = one neutral oracle instruction + the locked bundle items, nothing else.
  Oracles are interchangeable; independence comes from separate inference runs, not from
  different instructions.
- Model = `policy.committee[i].model` (chosen by the room creator at UC-01).
- Sampling at temperature 0; output constrained to a JSON schema
  `{ verdict, confidence, reason }`. A malformed output is retried once, then recorded as
  `INSUFFICIENT_EVIDENCE` with the parse failure as the reason.
- Each verdict is appended as `VERDICT_RECORD` with `outputHash` of the raw model text.

**Trust model (honest limits):** LLM inference is not bit-reproducible across devices, so
peers do not re-run models to verify. What peers *can* verify: the verdict is bound to the
locked evidence hash, the committee/models match the immutable room policy, and the
recorded outputs hash-chain into the audit log. Byzantine runners are out of hackathon
scope (§11).

### 7.3 Threshold consensus (UC-08)

```
counts = tally(verdicts)                    # yes / no / insufficient
if counts.yes >= policy.threshold:     resolve(YES,  via=CONSENSUS)
elif counts.no >= policy.threshold:    resolve(NO,   via=CONSENSUS)
else:                                  status = NO_CONSENSUS → fallback (7.4)
```

Confidence is never an input — it is display-only, per the business rule in UC-07.

### 7.4 No-consensus fallback: tiebreaker LLM (UC-09)

Only LLMs make decisions — there is no automatic facts-resolution path. On a split
committee, an extra oracle (`"TIEBREAKER"`, model from the policy, may differ from the
committee models) judges the **same locked bundle** under the same neutral instruction.
YES/NO → resolves; `INSUFFICIENT_EVIDENCE` → cancel.

Cancellation refunds every stake in full (UC-13) and is recorded in the audit log with the
fallback path taken.

### 7.5 Explanation (UC-11)

After settlement, the runner asks QVAC for a plain-language summary constrained to name:
the outcome, the threshold result (e.g. "2 of 3"), the key evidence item, and any dissent.
Stored alongside the settlement with provenance "Generated locally by QVAC".

## 8. Engine API (what the frontend calls)

```ts
interface KickoffEngine {
  // identity (UC-16)
  loginWithWallet(): Promise<Participant>;

  // rooms (UC-01, UC-02)
  createRoom(input: { name: string; matchContext: string; policy: RoomPolicy }): Promise<Room>;
  joinRoom(inviteKey: string): Promise<Room>;

  // markets (UC-03, UC-04, UC-13)
  createMarket(roomId: string, input: { question: string; category: Category }): Promise<Market>;
  placeStake(marketId: string, side: Side, amount: bigint): Promise<Stake>;
  cancelMarket(marketId: string, reason: string): Promise<void>;

  // evidence (UC-05, UC-06)
  emitEvent(roomId: string, event: Omit<TimelineEvent, "id">): Promise<TimelineEvent>;
  lockBundle(marketId: string, items: EvidenceItem[]): Promise<EvidenceBundle>;

  // resolution (UC-07 — runner only; consensus/fallback/settlement are automatic)
  runOracles(marketId: string): Promise<OracleVerdict[]>;

  // reads (UC-10, UC-11, UC-12)
  getRoom(roomId: string): RoomState;                    // full projected state
  getAuditLog(marketId: string): AuditEntry[];

  // reactivity — every replicated op re-renders subscribers
  subscribe(roomId: string, onChange: (state: RoomState) => void): () => void;
}
```

The UI never mutates state directly; it appends ops through this facade and re-renders from
`subscribe`. This is exactly the seam where today's hard-coded demo data gets replaced.

## 9. Settlement math (UC-10)

All amounts are `bigint` minor units (no floats). For a resolved market:

```
pot          = Σ all stakes
winnersTotal = Σ stakes on winning side
payout_i     = floor(stake_i × pot / winnersTotal)
```

The rounding remainder (at most `winners − 1` minor units) is distributed one unit at a
time by largest fractional part, ties broken by wallet address order — deterministic on
every peer. Edge cases:

- **Nobody on the winning side** → treat as cancellation: refund all stakes.
- **Cancelled market** → full refunds (UC-13).
- WDK executes the transfers; `SETTLE` records the resulting payout table for the audit log.

## 10. Implementation phases

Each phase keeps the golden-path demo working and upgrades statuses in
[use-case-scenarios.md](use-case-scenarios.md):

| Phase | Scope | UC status changes |
|---|---|---|
| **1. In-app engine** ✅ done | `frontend/src/engine/` package: op log, reducers, real SHA-256 hashing, mock oracle runtime (scripted verdicts), single peer, in-memory wallet | UC-01…06, 08, 13 → Simulated with real logic; audit hashes become real |
| **2. QVAC oracles** ✅ done | `sidecar/` (npm-installed — pnpm breaks QVAC's nested platform binaries, tetherto/qvac#1492) bridges the browser to `@qvac/sdk` on localhost; personas as system prompts, JSON-constrained verdicts with one retry, real tiebreaker + explanation; app auto-detects the sidecar and falls back to the mock | UC-07, 09, 11 → real |
| **3. Pears P2P** ✅ first cut | Sidecar room node: invite key ↔ Hyperswarm topic; ops relay over encrypted swarm connections with JSONL persistence and full-snapshot sync to late joiners; browser ↔ sidecar over WebSocket; BroadcastChannel fallback syncs same-machine tabs without a sidecar. Remaining: Autobase/Hypercore-backed log | UC-02 → real; second device joins live |
| **4. WDK wallet** ✅ done | Sidecar `wallet.mjs`: real self-custodial wallet via `@tetherto/wdk` + `wdk-wallet-evm` — seed generated once, stored only on-device; the app's identity and op authorship are the wallet's Sepolia address. **Every money movement is a real Sepolia transaction** (host-as-custodial-escrow, 1 test-USDt cent = 1e12 wei): stakes transfer staker → host wallet (`txRef` on the stake), settlement payouts host → winners (`SETTLE_TX`), cancellation refunds host → stakers (`REFUND_TX`); all hashes appear as Etherscan links and audit rows. Unfunded wallets degrade gracefully to ledger-only. Remaining: trustless contract escrow (post-hackathon) | UC-16 → real; UC-04/10/13 → real on-chain value flow |
| **Stretch** | Live/replay feed adapter replacing "Emit next event" | UC-05 alternative flows |

Phase 1 deliberately lives inside the existing Vite app (no separate process, no server)
— the engine is pure TypeScript, so it later moves unchanged into a Pear desktop app.
`oracles/`, `p2p/`, and `settlement/` each expose an interface with `Mock` and real
implementations so phases 2–4 are swaps, not rewrites.

## 11. Explicitly out of scope (hackathon honesty)

- **Byzantine peers** — a malicious runner could fabricate verdicts; mitigations
  (multi-runner verdict comparison, signed ops) are noted but not built.
- **Sybil resistance / permissioning** — anyone with the invite key is trusted.
- **Real money** — WDK is used in test mode only; no mainnet paths.
- **Oracle reproducibility** — verdicts are audited by hash binding, not by re-execution.
- **Live sports data licensing** — the feed module ships with replay fixtures only.

## 12. Traceability

| Use case | Module(s) | Op(s) |
|---|---|---|
| UC-01 Create room | core, p2p | `ROOM_CREATE` |
| UC-02 Join room | p2p, core | `PEER_JOIN` |
| UC-03 Create market | core | `MARKET_CREATE` |
| UC-04 Stake | core, settlement | `STAKE_PLACE` |
| UC-05 Emit event | feed, core | `EVENT_EMIT` |
| UC-06 Lock bundle | crypto, core | `BUNDLE_LOCK` |
| UC-07 Run oracles | oracles (QVAC) | `VERDICT_RECORD` × committee |
| UC-08 Consensus | consensus | `MARKET_RESOLVE` |
| UC-09 Fallback facts/LLM | consensus, oracles | `FALLBACK_RESULT` |
| UC-10 Settlement | settlement (WDK) | `SETTLE` |
| UC-11 Explanation | oracles (QVAC) | stored with settlement |
| UC-12 Audit log | crypto | projection over op log |
| UC-13 Cancel | core, settlement | `MARKET_CANCEL` |
| UC-14 Category routing | consensus, feed | objective short-circuit in reducer |
| UC-16 Wallet login | settlement (WDK) | `PEER_JOIN` identity |
