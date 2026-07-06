// Demo seed: reproduces the "Ukraine vs Spain Watch Party" golden path
// (use-case-scenarios.md, end-to-end scenario) on top of the real engine.

import { KickoffEngine } from "./engine";
import { MockOracleRuntime, type OracleRuntime } from "./oracles";
import type { P2PAdapter } from "./p2p";
import type { Participant, RoomPolicy } from "./types";

export const DEMO = {
  inviteKey: "room_7KQ9",
  me: "tb1qoleksandr",
  penaltyId: "mkt_penalty",
  redCardId: "mkt_redcard",
  goalId: "mkt_goal",
};

// One local model for the whole committee — oracles are interchangeable;
// independence comes from separate inference runs.
export const DEMO_POLICY: RoomPolicy = {
  committee: [
    { id: "oracle-1", model: "Llama 3.2 1B" },
    { id: "oracle-2", model: "Llama 3.2 1B" },
    { id: "oracle-3", model: "Llama 3.2 1B" },
  ],
  threshold: 2,
  fallback: { kind: "TIEBREAKER_LLM", model: "Llama 3.2 1B" },
};

export interface DemoHandle {
  engine: KickoffEngine;
  runtime: MockOracleRuntime;
  /** Emits the scripted 67' penalty event and locks the evidence bundle (UC-05/06). */
  emitPenaltyEvent(): Promise<void>;
  /** Resets the penalty market's oracle run for replaying the reveal (UC-15). */
  resetOracles(): void;
}

export interface DemoOptions {
  adapter?: P2PAdapter;
  /** Runtime to switch to AFTER seeding (seeding always uses the instant mock). */
  runtime?: OracleRuntime;
  runtimeLabel?: string;
  /** The local user; joins the seeded room as themselves (distinct per peer). */
  identity?: Participant;
}

export async function createDemoEngine(opts: DemoOptions = {}): Promise<DemoHandle> {
  const runtime = new MockOracleRuntime(1200);
  // Deterministic seed: identical ops on every peer, deduped by content on sync.
  const engine = new KickoffEngine({ runtime, adapter: opts.adapter, deterministic: true });

  await engine.loginWithWallet("Oleksandr");
  engine.createRoom({
    name: "Ukraine vs Spain Watch Party",
    matchContext: "Ukraine vs Spain",
    inviteKey: DEMO.inviteKey,
    policy: DEMO_POLICY,
  });
  engine.joinAs({ wallet: "tb1qmarco", displayName: "Marco", joinedAt: 0 });
  engine.joinAs({ wallet: "tb1qivan", displayName: "Ivan", joinedAt: 0 });

  // Initial timeline (UC-05 precondition).
  await engine.emitEvent({ minute: 12, type: "GOAL", team: "Spain", description: "Goal — Spain", source: "REPLAY" });
  await engine.emitEvent({ minute: 90, type: "FULL_TIME", description: "Full time", source: "REPLAY" });

  // Penalty market — interpretive, waits for the 67' penalty event.
  engine.createMarket({
    id: DEMO.penaltyId,
    question: "Was the penalty decision correct?",
    category: "INTERPRETIVE",
    trigger: "PENALTY",
  });
  engine.placeStake(DEMO.penaltyId, DEMO.me, "YES", 500n);
  engine.placeStake(DEMO.penaltyId, "tb1qmarco", "YES", 1000n);
  engine.placeStake(DEMO.penaltyId, "tb1qivan", "NO", 1500n);
  engine.lockMarket(DEMO.penaltyId);

  // Red-card market — interpretive; seeded all the way to NO_CONSENSUS so the
  // fallback banner is live state, not a hard-coded variant (UC-09).
  engine.createMarket({
    id: DEMO.redCardId,
    question: "Was the red card deserved?",
    category: "INTERPRETIVE",
  });
  engine.placeStake(DEMO.redCardId, "tb1qmarco", "YES", 800n);
  engine.placeStake(DEMO.redCardId, "tb1qivan", "NO", 1200n);
  engine.lockMarket(DEMO.redCardId);
  await engine.lockBundle(DEMO.redCardId, [
    {
      weight: "PRIMARY",
      kind: "FEED_EVENT",
      content: "43' — Second yellow → red card, Ukraine defender",
    },
    {
      weight: "CONTEXT",
      kind: "RULEBOOK",
      content: "A player who receives a second caution in the same match is sent off…",
    },
  ]);
  runtime.delayMs = 0; // seed instantly, keep the live run animated
  await engine.runOracles(DEMO.redCardId); // splits → NO_CONSENSUS by design
  runtime.delayMs = 1200;

  // Objective-category market — resolves through the committee like any other.
  engine.createMarket({
    id: DEMO.goalId,
    question: "Will Spain score a second goal before 80'?",
    category: "OBJECTIVE",
  });
  engine.placeStake(DEMO.goalId, "tb1qmarco", "YES", 2000n);
  engine.placeStake(DEMO.goalId, "tb1qivan", "NO", 1000n);

  // Seed complete — live ops from here on (real timestamps, unique ids).
  engine.endDeterministic();
  if (opts.runtime) engine.setRuntime(opts.runtime, opts.runtimeLabel ?? "Custom oracle runtime");

  // The local user enters the room as themselves — a distinct participant per
  // peer (the seeded Oleksandr/Marco/Ivan are fictional demo characters).
  if (opts.identity) {
    engine.adoptIdentity(opts.identity);
    engine.joinAs({ ...opts.identity, joinedAt: Date.now() });
  }

  let checkpoint = 0;

  const emitPenaltyEvent = async () => {
    const event = await engine.emitEvent({
      id: "evt_pen67", // fixed id: the scripted event dedups across peers
      minute: 67,
      type: "PENALTY",
      team: "Ukraine",
      description: "Penalty — Ukraine",
      detail: "VAR confirmed",
      source: "REPLAY",
    });
    await engine.lockBundle(DEMO.penaltyId, [
      {
        weight: "PRIMARY",
        kind: "FEED_EVENT",
        content: "67' — Penalty awarded to Ukraine · VAR: Confirmed",
        eventRef: event.id,
      },
      {
        weight: "SECONDARY",
        kind: "MANUAL_NOTE",
        content: "Defender made leg contact with attacker inside the box before touching the ball.",
        author: DEMO.me,
      },
      {
        weight: "CONTEXT",
        kind: "RULEBOOK",
        content: "A direct free kick is awarded if a player trips or attempts to trip an opponent…",
      },
    ]);
    checkpoint = engine.checkpoint();
  };

  const resetOracles = () => {
    if (checkpoint > 0) engine.resetTo(checkpoint);
  };

  return { engine, runtime, emitPenaltyEvent, resetOracles };
}
