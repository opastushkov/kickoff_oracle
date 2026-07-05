// Kickoff Oracle — P2P room node (backend-design.md Phase 3, first cut).
// Each room's op log replicates over the Pears stack: the invite key maps to a
// Hyperswarm topic; sidecars holding the same key find each other over the DHT
// and exchange ops as newline-delimited JSON over encrypted Hyperswarm streams.
// Browsers connect to their local sidecar via WebSocket. Ops are opaque here —
// identity is (clock, author, content hash); ordering happens in the engine.
// (Autobase/Hypercore persistence is the planned upgrade; this is the relay cut.)

import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Hyperswarm from "hyperswarm";
import { WebSocketServer } from "ws";

const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), ".rooms");

const rooms = new Map(); // key → { ops: Map<opKey, opJson>, clients: Set<ws>, conns: Set<stream>, swarm }

function topicFor(inviteKey) {
  return createHash("sha256").update(`kickoff-oracle:${inviteKey}`).digest();
}

function fnv(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/** Canonical JSON over the wire form (bigints arrive as tagged strings). */
function canonical(v) {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  const keys = Object.keys(v).filter((k) => v[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(",")}}`;
}

function opKeyOf(op) {
  return `${op.clock}|${op.author}|${fnv(canonical(op.op))}`;
}

function roomFile(key) {
  return join(DATA_DIR, `${fnv(key)}-${key.replace(/[^a-z0-9_]/gi, "")}.jsonl`);
}

function getRoom(inviteKey) {
  const key = String(inviteKey).trim().toLowerCase();
  let room = rooms.get(key);
  if (room) return room;

  room = { key, ops: new Map(), clients: new Set(), conns: new Set(), swarm: new Hyperswarm() };
  rooms.set(key, room);

  // Restore persisted ops so rooms survive sidecar restarts.
  mkdirSync(DATA_DIR, { recursive: true });
  const file = roomFile(key);
  if (existsSync(file)) {
    for (const line of readFileSync(file, "utf8").split("\n")) {
      if (!line.trim()) continue;
      try {
        const op = JSON.parse(line);
        room.ops.set(opKeyOf(op), line);
      } catch {
        /* skip corrupt line */
      }
    }
    console.log(`[rooms] ${key}: restored ${room.ops.size} ops`);
  }

  const discovery = room.swarm.join(topicFor(key), { server: true, client: true });
  discovery
    .flushed()
    .then(() => console.log(`[rooms] ${key}: announced to the DHT`))
    .catch((e) => console.log(`[rooms] ${key}: announce failed: ${e?.message}`));
  room.swarm.on("connection", (conn) => {
    console.log(`[rooms] ${key}: peer connected (${room.conns.size + 1} peers)`);
    room.conns.add(conn);
    conn.on("error", () => {});
    conn.on("close", () => room.conns.delete(conn));

    // Full snapshot to the new peer, then tail.
    for (const line of room.ops.values()) conn.write(line + "\n");

    let buf = "";
    conn.on("data", (chunk) => {
      buf += chunk.toString("utf8");
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        if (line.trim()) ingest(room, line, conn);
      }
    });
  });

  console.log(`[rooms] ${key}: joined swarm topic ${topicFor(key).toString("hex").slice(0, 16)}…`);
  return room;
}

/** Accept one op (JSON line), dedup, persist, fan out to ws clients and peers. */
function ingest(room, line, source) {
  let op;
  try {
    op = JSON.parse(line);
  } catch {
    return;
  }
  const key = opKeyOf(op);
  if (room.ops.has(key)) return;
  room.ops.set(key, line);
  try {
    appendFileSync(roomFile(room.key), line + "\n");
  } catch {
    /* persistence is best-effort */
  }

  const wsMsg = JSON.stringify({ type: "ops", payload: `[${line}]` });
  for (const ws of room.clients) {
    if (ws !== source && ws.readyState === 1) ws.send(wsMsg);
  }
  for (const conn of room.conns) {
    if (conn !== source) conn.write(line + "\n");
  }
}

export function initRooms(httpServer) {
  const wss = new WebSocketServer({ server: httpServer });
  wss.on("connection", (ws) => {
    let room = null;
    ws.on("message", (data) => {
      let msg;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return;
      }
      if (msg.type === "join" && msg.inviteKey) {
        room = getRoom(msg.inviteKey);
        room.clients.add(ws);
        console.log(`[rooms] ${room.key}: browser joined (${room.clients.size} local clients)`);
        if (room.ops.size > 0) {
          ws.send(JSON.stringify({ type: "ops", payload: `[${[...room.ops.values()].join(",")}]` }));
        }
      } else if (msg.type === "ops" && room) {
        let ops;
        try {
          ops = JSON.parse(msg.payload);
        } catch {
          return;
        }
        for (const op of ops) ingest(room, JSON.stringify(op), ws);
      }
    });
    ws.on("close", () => room?.clients.delete(ws));
  });
  console.log("[rooms] WebSocket room bridge attached");
}
