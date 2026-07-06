// Diagnostic: join a room key through the LOCAL sidecar and print whatever
// ops arrive — isolates the sidecar/swarm path from the browser app.
//   node jointest.mjs <inviteKey> [port=8791]
// On the room creator's machine this should print ops immediately (they are
// already in the local sidecar). On another machine it proves DHT discovery
// + relay: expect ops within 1–3 minutes on first contact.

import { WebSocket } from "ws";

const key = process.argv[2];
const port = process.argv[3] ?? "8791";
if (!key) {
  console.error("usage: node jointest.mjs <inviteKey> [port]");
  process.exit(1);
}

const t0 = Date.now();
const elapsed = () => `+${((Date.now() - t0) / 1000).toFixed(1)}s`;
const ws = new WebSocket(`ws://127.0.0.1:${port}`);

ws.on("open", () => {
  console.log(`[jointest] connected to sidecar :${port}, joining "${key}"…`);
  ws.send(JSON.stringify({ type: "join", inviteKey: key }));
  console.log("[jointest] waiting for ops… first DHT contact can take 1-3 minutes. Ctrl+C to stop.");
});

ws.on("message", (d) => {
  let msg;
  try {
    msg = JSON.parse(d.toString());
  } catch {
    return;
  }
  if (msg.type !== "ops") return;
  const ops = JSON.parse(msg.payload);
  const kinds = {};
  for (const o of ops) kinds[o.op?.type ?? "?"] = (kinds[o.op?.type ?? "?"] ?? 0) + 1;
  console.log(`[jointest] ${elapsed()} received ${ops.length} op(s): ${JSON.stringify(kinds)}`);
});

ws.on("error", (e) => console.error(`[jointest] ${elapsed()} websocket error:`, e.message));
ws.on("close", () => console.log(`[jointest] ${elapsed()} connection closed`));
setInterval(() => {}, 1 << 30);
