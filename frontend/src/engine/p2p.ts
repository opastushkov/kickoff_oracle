// P2P adapters (doc/backend-design.md §2, Phase 3).
// The engine never mutates state directly: it publishes ops through an adapter
// and applies whatever the adapter delivers — local echoes and remote ops alike.
// Convergence comes from the engine's (clock, author, hash) total order, so an
// adapter only has to move ops around; it never has to order them.

import { canonicalJson } from "./crypto";
import type { LoggedOp } from "./types";

export interface AdapterHost {
  /** Deliver ops into the engine (idempotent — duplicates are fine). */
  deliver(ops: LoggedOp[]): void;
  /** Current full log, for answering late-joiner sync requests. */
  snapshot(): LoggedOp[];
}

export interface P2PAdapter {
  attach(host: AdapterHost): void;
  /** Publish a locally created op. Must also echo it back via host.deliver. */
  append(op: LoggedOp): void;
  close?(): void;
}

/** Phase 1: single peer, synchronous loopback. */
export class InMemoryAdapter implements P2PAdapter {
  private host: AdapterHost | null = null;
  attach(host: AdapterHost): void {
    this.host = host;
  }
  append(op: LoggedOp): void {
    this.host?.deliver([op]);
  }
}

// ─── Wire encoding ────────────────────────────────────────────────────────────
// Ops carry bigints (test-USDt minor units); JSON can't. Tag them on the wire.

const BIG = "$big:";

export function encodeOps(ops: LoggedOp[]): string {
  return JSON.stringify(ops, (_k, v) => (typeof v === "bigint" ? `${BIG}${v.toString()}` : v));
}

export function decodeOps(text: string): LoggedOp[] {
  return JSON.parse(text, (_k, v) =>
    typeof v === "string" && v.startsWith(BIG) ? BigInt(v.slice(BIG.length)) : v,
  );
}

/** Cheap content hash (FNV-1a) for op identity — not security, just identity. */
export function opContentHash(op: LoggedOp["op"]): string {
  const s = canonicalJson(op);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

// ─── Stage 2: same-machine replication between browser tabs ─────────────────

type BcMessage = { kind: "ops"; payload: string } | { kind: "hello" };

export class BroadcastChannelAdapter implements P2PAdapter {
  private host: AdapterHost | null = null;
  private ch: BroadcastChannel;

  constructor(topic: string) {
    this.ch = new BroadcastChannel(`kickoff-oracle:${topic.toLowerCase()}`);
    this.ch.onmessage = (e: MessageEvent<BcMessage>) => {
      if (e.data.kind === "ops") {
        this.host?.deliver(decodeOps(e.data.payload));
      } else if (e.data.kind === "hello") {
        const log = this.host?.snapshot() ?? [];
        if (log.length > 0) this.ch.postMessage({ kind: "ops", payload: encodeOps(log) });
      }
    };
  }

  attach(host: AdapterHost): void {
    this.host = host;
    this.ch.postMessage({ kind: "hello" } satisfies BcMessage); // late-joiner sync
  }

  append(op: LoggedOp): void {
    this.host?.deliver([op]);
    this.ch.postMessage({ kind: "ops", payload: encodeOps([op]) } satisfies BcMessage);
  }

  close(): void {
    this.ch.close();
  }
}

// ─── Stage 3: cross-machine replication via the sidecar's Hyperswarm node ───

export class WebSocketAdapter implements P2PAdapter {
  private host: AdapterHost | null = null;
  private ws: WebSocket | null = null;
  private ready = false;
  private queue: string[] = [];
  private closed = false;

  constructor(
    private inviteKey: string,
    private url = "ws://127.0.0.1:8791",
  ) {}

  attach(host: AdapterHost): void {
    this.host = host;
    this.connect();
  }

  private connect(): void {
    if (this.closed) return;
    const ws = new WebSocket(this.url);
    this.ws = ws;
    ws.onopen = () => {
      ws.send(JSON.stringify({ type: "join", inviteKey: this.inviteKey }));
      // Contribute our log so peers (and the sidecar) catch up from us too.
      const log = this.host?.snapshot() ?? [];
      if (log.length > 0) ws.send(JSON.stringify({ type: "ops", payload: encodeOps(log) }));
      this.ready = true;
      for (const msg of this.queue.splice(0)) ws.send(msg);
    };
    ws.onmessage = (e) => {
      const msg = JSON.parse(String(e.data));
      if (msg.type === "ops") this.host?.deliver(decodeOps(msg.payload));
    };
    ws.onclose = () => {
      this.ready = false;
      if (!this.closed) setTimeout(() => this.connect(), 2000); // auto-reconnect
    };
    ws.onerror = () => ws.close();
  }

  append(op: LoggedOp): void {
    this.host?.deliver([op]); // optimistic local apply; order converges on sync
    const msg = JSON.stringify({ type: "ops", payload: encodeOps([op]) });
    if (this.ready && this.ws) this.ws.send(msg);
    else this.queue.push(msg);
  }

  close(): void {
    this.closed = true;
    this.ws?.close();
  }
}
