// Engine selftest — exercises the golden path plus the fallback and facts
// routes end-to-end. Run: esbuild-bundle to CJS, then node (see package.json
// "engine:test" script). Throws on the first failed assertion.

import { createDemoEngine, DEMO } from "./demo";
import { computePayouts } from "./settlement";

function assert(cond: boolean, label: string): void {
  if (!cond) throw new Error(`SELFTEST FAIL: ${label}`);
  console.log(`ok — ${label}`);
}

const HEX64 = /^[0-9a-f]{64}$/;

async function main() {
  const { engine, runtime, emitPenaltyEvent } = await createDemoEngine({
    // Mock on-chain executor: returns a receipt per payout (UC-10 txRefs path).
    onSettlement: async (s) => s.payouts.map((p) => ({ wallet: p.wallet, txHash: `0xtest_${p.wallet}` })),
  });
  runtime.delayMs = 0; // instant oracles for the test

  // ── seed sanity ────────────────────────────────────────────────────────────
  let v = engine.getView();
  assert(v.room?.inviteKey === "room_7KQ9", "room seeded with invite key");
  assert(v.participants.length === 3, "three participants joined");
  assert(v.markets.length === 3, "three markets seeded (no Social)");
  assert(
    v.markets.find((m) => m.id === DEMO.redCardId)?.status === "NO_CONSENSUS",
    "red-card market seeded to NO_CONSENSUS via a real split committee run",
  );
  assert(v.balances[DEMO.me] === 11500n, "creator balance = 120 − 5 staked");

  // ── golden path: emit → run oracles → consensus → settle ─────────────────
  await emitPenaltyEvent();
  v = engine.getView();
  const penalty = () => engine.getView().markets.find((m) => m.id === DEMO.penaltyId)!;
  assert(penalty().status === "RESOLVING", "penalty market flips to RESOLVING on the 67' event");
  assert(HEX64.test(penalty().bundle!.hash), "evidence bundle hash is a real SHA-256");

  await engine.runOracles(DEMO.penaltyId);
  const p = penalty();
  assert(p.status === "SETTLED", "penalty market resolved and settled");
  assert(p.resolution!.outcome === "YES" && p.resolution!.via === "CONSENSUS", "2-of-3 YES consensus");
  assert(HEX64.test(p.resolution!.votesHash), "votes hash is a real SHA-256");
  assert(p.settlement!.pot === 3000n, "pot is 30 test USDt");
  const payoutOf = (w: string) => p.settlement!.payouts.find((x) => x.wallet === w)?.amount ?? 0n;
  assert(payoutOf(DEMO.me) === 1000n && payoutOf("tb1qmarco") === 2000n, "pro-rata payouts 10 / 20");
  assert(engine.getView().balances[DEMO.me] === 12500n, "creator balance after payout = 125");
  assert(p.settlement!.explanation.includes("2 of 3"), "explanation names the threshold result");

  const audit = engine.getAuditLog(DEMO.penaltyId);
  assert(audit.some((e) => e.key === "Evidence hash" && HEX64.test(e.value)), "audit log carries evidence hash");
  assert(audit.some((e) => e.key === "Threshold" && e.value === "2_of_3"), "audit log carries threshold");

  // ── on-chain receipts attach asynchronously via SETTLE_TX ────────────────
  await new Promise((r) => setTimeout(r, 20));
  const settled = penalty();
  assert(
    (settled.settlement!.txRefs?.length ?? 0) === settled.settlement!.payouts.length,
    "settlement receipts attached for every payout",
  );
  assert(
    engine.getAuditLog(DEMO.penaltyId).some((e) => e.key.startsWith("Sepolia tx")),
    "audit log carries on-chain tx rows",
  );

  // ── locked evidence is enforced ───────────────────────────────────────────
  const before = penalty().bundle!.hash;
  await engine.lockBundle(DEMO.penaltyId, [{ weight: "PRIMARY", kind: "MANUAL_NOTE", content: "tampered" }]);
  assert(penalty().bundle!.hash === before, "re-locking an existing bundle is rejected");

  // ── tiebreaker fallback on the red-card market ────────────────────────────
  await engine.runFallback(DEMO.redCardId);
  const red = engine.getView().markets.find((m) => m.id === DEMO.redCardId)!;
  assert(red.status === "CANCELLED", "tiebreaker INSUFFICIENT_EVIDENCE cancels the market");
  assert(engine.getView().balances["tb1qmarco"] >= 800n, "cancelled stakes refunded");
  await new Promise((r) => setTimeout(r, 20));
  const redAfter = engine.getView().markets.find((m) => m.id === DEMO.redCardId)!;
  assert((redAfter.refundTxs?.length ?? 0) === 2, "on-chain refund receipts attached after cancellation");

  // ── stakes can carry their on-chain transfer reference ───────────────────
  engine.placeStake(DEMO.goalId, "tb1qivan", "NO", 100n, "0xstake_selftest");
  assert(
    engine.getView().markets.find((m) => m.id === DEMO.goalId)!.stakes.some((st) => st.txRef === "0xstake_selftest"),
    "stake carries its on-chain txRef",
  );

  // ── no facts path: markets resolve only through oracles ──────────────────
  await engine.emitEvent({ minute: 75, type: "GOAL", team: "Spain", description: "Goal — Spain", source: "REPLAY" });
  const goal = engine.getView().markets.find((m) => m.id === DEMO.goalId)!;
  assert(goal.status === "OPEN", "feed events alone never resolve a market");

  // ── payout rounding: remainder distributed deterministically ─────────────
  const rounded = computePayouts(
    [
      { marketId: "m", wallet: "a", side: "YES", amount: 100n },
      { marketId: "m", wallet: "b", side: "YES", amount: 100n },
      { marketId: "m", wallet: "c", side: "YES", amount: 100n },
      { marketId: "m", wallet: "z", side: "NO", amount: 100n },
    ],
    "YES",
  );
  const sum = rounded.reduce((a, p2) => a + p2.amount, 0n);
  assert(sum === 400n, "rounded payouts sum exactly to the pot");
  assert(rounded.filter((x) => x.amount === 134n).length === 1, "largest-remainder gives one winner the extra unit");

  console.log("\nAll engine selftests passed.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
