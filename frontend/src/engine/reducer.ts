// Pure reducers over the operation log (doc/backend-design.md §5).
// Invalid ops are ignored identically on every peer, so they cannot fork state.

import { tally, thresholdOutcome } from "./consensus";
import type { LoggedOp, Market, RoomState, Side } from "./types";

export function emptyState(): RoomState {
  return { room: null, participants: [], timeline: [], markets: [], balances: {} };
}

export function replay(ops: LoggedOp[]): RoomState {
  return ops.reduce(applyOp, emptyState());
}

function updMarket(s: RoomState, id: string, fn: (m: Market) => Market): RoomState {
  return { ...s, markets: s.markets.map((m) => (m.id === id ? fn(m) : m)) };
}

function credit(balances: RoomState["balances"], wallet: string, amount: bigint) {
  return { ...balances, [wallet]: (balances[wallet] ?? 0n) + amount };
}

function refundAll(s: RoomState, m: Market): RoomState {
  let balances = s.balances;
  for (const st of m.stakes) balances = credit(balances, st.wallet, st.amount);
  return { ...s, balances };
}

export function stakeTotal(m: Market, side: Side): bigint {
  return m.stakes.filter((s) => s.side === side).reduce((a, s) => a + s.amount, 0n);
}

export function applyOp(s: RoomState, logged: LoggedOp): RoomState {
  const op = logged.op;
  switch (op.type) {
    case "ROOM_CREATE": {
      if (s.room) return s; // genesis only once
      return { ...s, room: op.room };
    }

    case "PEER_JOIN": {
      if (s.participants.some((p) => p.wallet === op.participant.wallet)) return s;
      return {
        ...s,
        participants: [...s.participants, op.participant],
        balances: credit(s.balances, op.participant.wallet, op.demoCredit),
      };
    }

    case "MARKET_CREATE": {
      if (s.markets.some((m) => m.id === op.market.id)) return s;
      const market: Market = { ...op.market, status: "OPEN", stakes: [], verdicts: [] };
      return { ...s, markets: [...s.markets, market] };
    }

    case "MARKET_LOCK":
      return updMarket(s, op.marketId, (m) =>
        m.status === "OPEN" ? { ...m, status: "AWAITING_EVIDENCE" } : m,
      );

    case "STAKE_PLACE": {
      const { stake } = op;
      const m = s.markets.find((x) => x.id === stake.marketId);
      if (!m || m.status !== "OPEN") return s; // staking window closed
      if (stake.amount <= 0n) return s;
      if ((s.balances[stake.wallet] ?? 0n) < stake.amount) return s; // insufficient balance
      const next = updMarket(s, stake.marketId, (x) => ({ ...x, stakes: [...x.stakes, stake] }));
      return { ...next, balances: credit(next.balances, stake.wallet, -stake.amount) }; // escrow
    }

    case "EVENT_EMIT": {
      if (s.timeline.some((e) => e.id === op.event.id)) return s;
      const timeline = [...s.timeline, op.event].sort((a, b) => a.minute - b.minute);
      // Matching feed evidence flips waiting markets to RESOLVING (UC-05).
      const markets = s.markets.map((m) =>
        m.status === "AWAITING_EVIDENCE" && m.trigger === op.event.type
          ? { ...m, status: "RESOLVING" as const }
          : m,
      );
      return { ...s, timeline, markets };
    }

    case "BUNDLE_LOCK": {
      const m = s.markets.find((x) => x.id === op.bundle.marketId);
      if (!m || m.bundle) return s; // a bundle locks exactly once (UC-06)
      if (m.status !== "AWAITING_EVIDENCE" && m.status !== "RESOLVING") return s;
      return updMarket(s, op.bundle.marketId, (x) => ({
        ...x,
        bundle: op.bundle,
        status: "RESOLVING",
      }));
    }

    case "VERDICT_RECORD": {
      const { verdict } = op;
      const m = s.markets.find((x) => x.id === verdict.marketId);
      if (!m || !m.bundle) return s;
      const validStatus =
        verdict.oracle === "TIEBREAKER" ? m.status === "NO_CONSENSUS" : m.status === "RESOLVING";
      if (!validStatus) return s;
      if (verdict.bundleHash !== m.bundle.hash) return s; // wrong evidence → rejected
      if (verdict.oracle !== "TIEBREAKER") {
        const committee = s.room?.policy.committee ?? [];
        if (!committee.some((c) => c.id === verdict.oracle)) return s;
        if (m.verdicts.some((v) => v.oracle === verdict.oracle)) return s; // one per slot
      }
      return updMarket(s, verdict.marketId, (x) => {
        const verdicts = [...x.verdicts, verdict];
        // Once the full committee has voted, an unmet threshold deterministically
        // yields NO_CONSENSUS on every peer; a met threshold waits for the
        // engine's MARKET_RESOLVE op (which carries the votes hash).
        const committeeSize = s.room?.policy.committee.length ?? 0;
        const committeeVotes = verdicts.filter((v) => v.oracle !== "TIEBREAKER").length;
        if (
          s.room &&
          committeeVotes === committeeSize &&
          thresholdOutcome(tally(verdicts), s.room.policy) === null
        ) {
          return { ...x, verdicts, status: "NO_CONSENSUS" };
        }
        return { ...x, verdicts };
      });
    }

    case "MARKET_RESOLVE": {
      const m = s.markets.find((x) => x.id === op.marketId);
      if (!m || !["OPEN", "AWAITING_EVIDENCE", "RESOLVING", "NO_CONSENSUS"].includes(m.status)) return s;
      return updMarket(s, op.marketId, (x) => ({
        ...x,
        status: "RESOLVED",
        resolution: op.resolution,
      }));
    }

    case "FALLBACK_RESULT": {
      const m = s.markets.find((x) => x.id === op.marketId);
      if (!m || m.status !== "NO_CONSENSUS") return s;
      if (op.resolution) {
        return updMarket(s, op.marketId, (x) => ({
          ...x,
          status: "RESOLVED",
          resolution: op.resolution,
        }));
      }
      const cancelled = updMarket(s, op.marketId, (x) => ({
        ...x,
        status: "CANCELLED",
        cancelReason: op.cancelReason ?? "fallback inconclusive",
      }));
      return refundAll(cancelled, cancelled.markets.find((x) => x.id === op.marketId)!);
    }

    case "SETTLE": {
      const m = s.markets.find((x) => x.id === op.settlement.marketId);
      if (!m || m.status !== "RESOLVED" || m.settlement) return s;
      let balances = s.balances;
      for (const p of op.settlement.payouts) balances = credit(balances, p.wallet, p.amount);
      const next = updMarket(s, op.settlement.marketId, (x) => ({
        ...x,
        status: "SETTLED",
        settlement: op.settlement,
      }));
      return { ...next, balances };
    }

    case "MARKET_CANCEL": {
      const m = s.markets.find((x) => x.id === op.marketId);
      if (!m || ["RESOLVED", "SETTLED", "CANCELLED"].includes(m.status)) return s;
      const cancelled = updMarket(s, op.marketId, (x) => ({
        ...x,
        status: "CANCELLED",
        cancelReason: op.reason,
      }));
      return refundAll(cancelled, cancelled.markets.find((x) => x.id === op.marketId)!);
    }
  }
}
