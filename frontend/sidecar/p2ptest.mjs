// P2P replication test: two sidecar room nodes on one machine, joined to the
// same swarm topic, must relay an op A → Hyperswarm(DHT) → B. Run: node p2ptest.mjs

import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocket } from "ws";

const dir = dirname(fileURLToPath(import.meta.url));
const key = `room_p2ptest_${Math.random().toString(36).slice(2, 8)}`;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function startSidecar(port) {
  const child = spawn(process.execPath, [join(dir, "server.mjs")], {
    env: { ...process.env, QVAC_SIDECAR_PORT: String(port), QVAC_DISABLE_LLM: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (d) => process.stdout.write(`[${port}] ${d}`));
  child.stderr.on("data", (d) => process.stderr.write(`[${port}] ${d}`));
  return child;
}

async function connect(port) {
  for (let i = 0; i < 30; i++) {
    try {
      const ws = new WebSocket(`ws://127.0.0.1:${port}`);
      await new Promise((res, rej) => {
        ws.once("open", res);
        ws.once("error", rej);
      });
      return ws;
    } catch {
      await wait(500);
    }
  }
  throw new Error(`cannot connect to sidecar on ${port}`);
}

const a = startSidecar(8794);
const b = startSidecar(8795);
let ok = false;

try {
  const wsA = await connect(8794);
  const wsB = await connect(8795);
  wsA.send(JSON.stringify({ type: "join", inviteKey: key }));
  wsB.send(JSON.stringify({ type: "join", inviteKey: key }));

  const op = {
    clock: 1,
    ts: Date.now(),
    author: "tb1qtest",
    op: { type: "EVENT_EMIT", event: { id: "e1", minute: 1, type: "GOAL", description: "test", source: "REPLAY" } },
  };

  const received = new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("op did not arrive over Hyperswarm within 150s")), 150_000);
    const tick = setInterval(() => console.log("…still waiting for peer discovery"), 20_000);
    t.unref?.();
    const stop = () => clearInterval(tick);
    setTimeout(stop, 150_000).unref?.();
    wsB.on("message", (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type !== "ops") return;
      const ops = JSON.parse(msg.payload);
      if (ops.some((o) => o.author === "tb1qtest" && o.clock === 1)) {
        clearTimeout(t);
        resolve(undefined);
      }
    });
  });

  await wait(1000);
  wsA.send(JSON.stringify({ type: "ops", payload: JSON.stringify([op]) }));
  console.log(`op sent to node A; waiting for DHT discovery + relay to node B (room ${key})…`);
  await received;
  console.log("\nP2P TEST OK — op replicated 8794 → Hyperswarm → 8795");
  ok = true;
} catch (err) {
  console.error("\nP2P TEST FAILED:", err?.message ?? err);
} finally {
  a.kill();
  b.kill();
}
process.exit(ok ? 0 : 1);
