// Distributed-jury selftest — "the swarm is the oracle".
// Spins up three independent engines (three fans, three devices) sharing one
// replicated op log over an in-process bus. Each peer runs its OWN on-device
// judge and signs one verdict; the market resolves by a quorum of those signed
// verdicts, with no committee and no single node deciding the result.
// Run: esbuild-bundle to CJS, then node (see package.json "jury:test").

import { KickoffEngine } from "./engine";
import type { AdapterHost, P2PAdapter } from "./p2p";
import type { JudgeResult, OracleRuntime } from "./oracles";
import type { EvidenceItem, LoggedOp, Participant, RoomPolicy, VerdictValue } from "./types";

function assert(cond: boolean, label: string): void {
  if (!cond) throw new Error(`JURY SELFTEST FAIL: ${label}`);
  console.log(`ok — ${label}`);
}

// ─── an in-process P2P bus: every node sees every op (like the DHT swarm) ────

class Bus {
  private nodes = new Set<Node>();
  private log: LoggedOp[] = [];
  register(n: Node) {
    this.nodes.add(n);
  }
  unregister(n: Node) {
    this.nodes.delete(n);
  }
  snapshot() {
    return this.log.slice();
  }
  publish(op: LoggedOp) {
    this.log.push(op);
    for (const n of this.nodes) n.receive([op]);
  }
}

class Node implements P2PAdapter {
  private host: AdapterHost | null = null;
  private alive = true;
  constructor(private bus: Bus) {}
  attach(host: AdapterHost) {
    this.host = host;
    this.bus.register(this);
    const log = this.bus.snapshot();
    if (log.length) host.deliver(log); // late-joiner sync
  }
  append(op: LoggedOp) {
    if (this.alive) this.bus.publish(op); // echoes back to us via receive()
  }
  receive(ops: LoggedOp[]) {
    if (this.alive) this.host?.deliver(ops);
  }
  /** Simulate the device dropping off the swarm (network death). */
  kill() {
    this.alive = false;
    this.bus.unregister(this);
  }
}

// ─── each peer's local on-device judge (scripted, stands in for QVAC) ────────

class FixedJudge implements OracleRuntime {
  constructor(
    private value: VerdictValue,
    private confidence = 80,
  ) {}
  async judge(): Promise<JudgeResult> {
    return {
      verdict: this.value,
      confidence: this.confidence,
      reason: `on-device judge read the locked evidence and answered ${this.value}`,
      rawOutput: JSON.stringify({ verdict: this.value }),
    };
  }
  async explain(): Promise<string> {
    return "The jury reached quorum on the hash-locked evidence.";
  }
}

const BUNDLE: EvidenceItem[] = [
  { weight: "PRIMARY", kind: "FEED_EVENT", content: "78' — hard challenge in the box, VAR review." },
  { weight: "SECONDARY", kind: "MANUAL_NOTE", content: "Defender makes contact before the ball." },
];

const JURY_POLICY: RoomPolicy = {
  committee: [], // unused in jury mode
  threshold: 2,
  fallback: { kind: "TIEBREAKER_LLM", model: "tiebreaker" },
  jury: { quorum: 2, model: "local-jury" },
};

const P = (wallet: string, displayName: string): Participant => ({ wallet, displayName, joinedAt: 0 });

/** Spin the event loop until `predicate` holds (or we give up). */
async function waitFor(predicate: () => boolean, label: string, tries = 200): Promise<void> {
  for (let i = 0; i < tries; i++) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 0));
  }
  throw new Error(`JURY SELFTEST TIMEOUT: ${label}`);
}

async function main() {
  const bus = new Bus();
  let settledPayouts = 0;

  // Three peers, three verdicts: Alice=YES, Bruno=YES, Carla=NO → quorum(2) = YES.
  const aliceNode = new Node(bus);
  const brunoNode = new Node(bus);
  const carlaNode = new Node(bus);
  const alice = new KickoffEngine({
    runtime: new FixedJudge("YES"),
    adapter: aliceNode,
    autoJury: true,
    onSettlement: async (b) => {
      settledPayouts += b.payouts.length;
      return b.payouts.map((p) => ({ wallet: p.wallet, txHash: `0xjury_${p.wallet}` }));
    },
  });
  const bruno = new KickoffEngine({ runtime: new FixedJudge("YES"), adapter: brunoNode, autoJury: true });
  const carla = new KickoffEngine({ runtime: new FixedJudge("NO"), adapter: carlaNode, autoJury: true });

  const aliceId = P("tb1qalice", "Alice");
  const brunoId = P("tb1qbruno", "Bruno");
  const carlaId = P("tb1qcarla", "Carla");
  alice.adoptIdentity(aliceId);
  bruno.adoptIdentity(brunoId);
  carla.adoptIdentity(carlaId);

  // Alice opens the room; Bruno and Carla join over the swarm.
  alice.createRoom({ name: "Final — watch party", matchContext: "ARG vs FRA", inviteKey: "room_JURY", policy: JURY_POLICY });
  bruno.joinAs(brunoId);
  carla.joinAs(carlaId);
  await waitFor(() => carla.getView().participants.length === 3, "all three peers seated on every device");
  assert(alice.getView().participants.length === 3, "Alice sees the full room");

  // ── Round 1: a disputed penalty, resolved by the distributed jury ─────────
  const mkt = alice.createMarket({ question: "Was the 78' challenge a penalty?", category: "INTERPRETIVE" });
  alice.placeStake(mkt, aliceId.wallet, "YES", 1000n);
  bruno.placeStake(mkt, brunoId.wallet, "YES", 1000n);
  carla.placeStake(mkt, carlaId.wallet, "NO", 1000n);
  await waitFor(() => alice.getView().markets.find((m) => m.id === mkt)!.stakes.length === 3, "three stakes replicated");

  alice.lockMarket(mkt);
  await waitFor(() => alice.getView().markets.find((m) => m.id === mkt)!.status === "AWAITING_EVIDENCE", "staking window closed");
  await alice.lockBundle(mkt, BUNDLE); // → RESOLVING; each device now judges locally

  // No one calls runOracles. Each peer's autoJury casts its own verdict and the
  // resolver announces the quorum — all driven by state replication alone.
  await waitFor(() => carla.getView().markets.find((m) => m.id === mkt)!.status === "SETTLED", "market settles on every peer");

  for (const [name, eng] of [["Alice", alice], ["Bruno", bruno], ["Carla", carla]] as const) {
    const m = eng.getView().markets.find((x) => x.id === mkt)!;
    assert(m.status === "SETTLED", `${name}'s device converged to SETTLED`);
    assert(m.resolution!.outcome === "YES", `${name} sees outcome YES`);
    assert(m.resolution!.via === "CONSENSUS", `${name} sees resolution via jury CONSENSUS`);
  }

  const settled = alice.getView().markets.find((m) => m.id === mkt)!;
  const jurors = settled.verdicts.filter((v) => v.juror);
  assert(jurors.length >= 2, "at least a quorum of distinct peers signed verdicts");
  assert(new Set(jurors.map((v) => v.juror)).size === jurors.length, "one signed verdict per juror (no ballot stuffing)");
  assert(jurors.every((v) => v.bundleHash === settled.bundle!.hash), "every verdict is bound to the locked evidence hash");
  assert(settledPayouts > 0, "winners were paid out on-chain (resolver only)");

  const audit = alice.getAuditLog(mkt);
  assert(audit.some((e) => e.key === "Oracle mode" && e.value === "DISTRIBUTED_JURY"), "audit log records distributed-jury mode");
  assert(audit.some((e) => e.key === "Quorum"), "audit log records the quorum result");

  // ── Round 2: kill a peer mid-tournament — the market still resolves ───────
  carlaNode.kill(); // Carla's device drops off the swarm
  console.log("— Carla's device dropped off the swarm —");

  const mkt2 = alice.createMarket({ question: "Was the late goal offside?", category: "INTERPRETIVE" });
  alice.placeStake(mkt2, aliceId.wallet, "YES", 1000n);
  bruno.placeStake(mkt2, brunoId.wallet, "YES", 1000n);
  await waitFor(() => bruno.getView().markets.find((m) => m.id === mkt2)!.stakes.length === 2, "round-2 stakes replicated to the living peers");

  alice.lockMarket(mkt2);
  await waitFor(() => alice.getView().markets.find((m) => m.id === mkt2)!.status === "AWAITING_EVIDENCE", "round-2 staking closed");
  await alice.lockBundle(mkt2, BUNDLE);

  await waitFor(() => bruno.getView().markets.find((m) => m.id === mkt2)!.status === "SETTLED", "market resolves with a dead peer (quorum from the survivors)");
  const m2 = alice.getView().markets.find((m) => m.id === mkt2)!;
  assert(m2.status === "SETTLED", "quorum reached without the dead peer");
  assert(m2.resolution!.outcome === "YES", "survivors' verdicts carried the outcome");
  assert(m2.verdicts.filter((v) => v.juror).length === 2, "exactly the two living peers voted");
  assert(carla.getView().markets.find((m) => m.id === mkt2)?.status !== "SETTLED", "the dead peer never saw the resolution");

  console.log("\nAll distributed-jury selftests passed.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
