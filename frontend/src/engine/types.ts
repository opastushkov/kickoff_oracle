// Kickoff Oracle room engine — data model (doc/backend-design.md §4)
// All amounts are bigint minor units of test USDt (1 USDt = 100 minor units).

export type Category = "OBJECTIVE" | "INTERPRETIVE"; // Social removed from scope
export type Side = "YES" | "NO";
export type VerdictValue = "YES" | "NO" | "INSUFFICIENT_EVIDENCE";
/** The tiebreaker is a process role (fallback judge), not a persona. */
export const TIEBREAKER = "TIEBREAKER";

export type MarketStatus =
  | "OPEN"
  | "AWAITING_EVIDENCE"
  | "RESOLVING"
  | "NO_CONSENSUS"
  | "RESOLVED"
  | "SETTLED"
  | "CANCELLED";

export interface OracleConfig {
  /** Committee slot id, e.g. "oracle-1". Oracles are interchangeable peers. */
  id: string;
  model: string; // QVAC model id, chosen by the room creator (UC-01)
}

export interface RoomPolicy {
  committee: OracleConfig[];
  threshold: number; // votes required, e.g. 2 (of committee.length)
  /** No-consensus fallback: an extra LLM judges the same locked evidence. */
  fallback: { kind: "TIEBREAKER_LLM"; model: string };
}

export interface Room {
  id: string;
  inviteKey: string;
  name: string;
  matchContext: string;
  creator: string; // wallet address
  policy: RoomPolicy; // immutable after ROOM_CREATE
}

export interface Participant {
  wallet: string;
  displayName: string;
  joinedAt: number;
}

export type TimelineEventType = "GOAL" | "PENALTY" | "VAR" | "CARD" | "FULL_TIME";

export interface TimelineEvent {
  id: string;
  minute: number;
  type: TimelineEventType;
  team?: string;
  description: string; // "Penalty — Ukraine"
  detail?: string; // "VAR confirmed"
  source: "REPLAY" | "MANUAL" | "LIVE";
}

export interface EvidenceItem {
  weight: "PRIMARY" | "SECONDARY" | "CONTEXT";
  kind: "FEED_EVENT" | "MANUAL_NOTE" | "RULEBOOK";
  content: string;
  author?: string; // wallet address for manual notes
  eventRef?: string; // TimelineEvent.id for FEED_EVENT items
}

export interface EvidenceBundle {
  marketId: string;
  version: number;
  items: EvidenceItem[];
  hash: string; // SHA-256 over canonical JSON of {marketId, version, items}
  lockedAt: number;
}

export interface Stake {
  marketId: string;
  wallet: string;
  side: Side;
  amount: bigint;
}

export interface OracleVerdict {
  marketId: string;
  bundleHash: string; // binds the verdict to the exact locked evidence
  oracle: string; // committee slot id, or "TIEBREAKER" for the fallback judge
  model: string;
  verdict: VerdictValue;
  confidence: number; // 0–100, informational only
  reason: string;
  outputHash: string; // SHA-256 of the raw model output
}

export interface Resolution {
  outcome: Side;
  via: "CONSENSUS" | "TIEBREAKER";
  counts: { yes: number; no: number; insufficient: number };
  votesHash: string; // SHA-256 over the ordered verdicts ("" for pure facts routes)
  resolvedAt: number;
}

export interface Settlement {
  marketId: string;
  pot: bigint;
  winningSide: Side;
  payouts: { wallet: string; amount: bigint }[];
  explanation: string; // plain-language summary (UC-11)
  confirmedAt: number;
}

export interface Market {
  id: string;
  roomId: string;
  question: string;
  category: Category;
  status: MarketStatus;
  createdBy: string;
  createdAt: number;
  /** Feed event type that flips AWAITING_EVIDENCE → RESOLVING (UC-05). */
  trigger?: TimelineEventType;
  stakes: Stake[];
  bundle?: EvidenceBundle;
  verdicts: OracleVerdict[];
  resolution?: Resolution;
  settlement?: Settlement;
  cancelReason?: string;
}

// ─── Operation log (doc/backend-design.md §5) ────────────────────────────────

export type Op =
  | { type: "ROOM_CREATE"; room: Room }
  | { type: "PEER_JOIN"; participant: Participant; demoCredit: bigint }
  | {
      type: "MARKET_CREATE";
      market: Pick<
        Market,
        "id" | "roomId" | "question" | "category" | "createdBy" | "createdAt" | "trigger"
      >;
    }
  | { type: "MARKET_LOCK"; marketId: string } // closes staking → AWAITING_EVIDENCE
  | { type: "STAKE_PLACE"; stake: Stake }
  | { type: "EVENT_EMIT"; event: TimelineEvent }
  | { type: "BUNDLE_LOCK"; bundle: EvidenceBundle }
  | { type: "VERDICT_RECORD"; verdict: OracleVerdict }
  | { type: "MARKET_RESOLVE"; marketId: string; resolution: Resolution }
  | { type: "FALLBACK_RESULT"; marketId: string; resolution?: Resolution; cancelReason?: string }
  | { type: "SETTLE"; settlement: Settlement }
  | { type: "MARKET_CANCEL"; marketId: string; reason: string };

export interface LoggedOp {
  /** Lamport clock: total order across peers is (clock, author, content hash). */
  clock: number;
  ts: number;
  author: string; // wallet address, or "system" for engine-emitted ops
  op: Op;
}

// ─── Projected state ─────────────────────────────────────────────────────────

export interface RoomState {
  room: Room | null;
  participants: Participant[];
  timeline: TimelineEvent[];
  markets: Market[];
  balances: Record<string, bigint>;
}

/** What the UI subscribes to: replicated state + transient runner flags. */
export interface RoomView extends RoomState {
  runningOracles: string[]; // marketIds with an oracle run in flight
  oracleRuntime: string; // human label of the active runtime (QVAC or mock)
}

export interface AuditEntry {
  key: string;
  value: string;
}
