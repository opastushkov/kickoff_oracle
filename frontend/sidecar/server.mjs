// Kickoff Oracle — QVAC sidecar.
// A thin localhost bridge: the browser app posts chat messages, this process
// runs them through the QVAC SDK on-device (llama.cpp under the hood) and
// returns the completion. No cloud AI; nothing leaves this machine.
//
//   pnpm --dir sidecar start        (or: node sidecar/server.mjs)
//
// Endpoints:
//   GET  /health    → { ok, loaded, model }
//   POST /complete  → { messages: [{role, content}] } → { text, model, ms }

import { createServer } from "node:http";
import * as sdk from "@qvac/sdk";
import { initRooms } from "./rooms.mjs";

const PORT = Number(process.env.QVAC_SIDECAR_PORT ?? 8791);
const DEFAULT_MODEL = "Llama 3.2 1B";

// Catalog of models the room creator can pick from. Downloads happen on
// demand through the QVAC registry (P2P, Hyperdrive-backed).
const CATALOG = {
  "Llama 3.2 1B": { constant: "LLAMA_3_2_1B_INST_Q4_0", sizeMB: 770 },
  "Qwen3 1.7B": { constant: "QWEN3_1_7B_INST_Q4", sizeMB: 1100 },
  "Qwen3 0.6B": { constant: "QWEN3_600M_INST_Q4", sizeMB: 480 },
  "SmolLM2 360M": { constant: "SMOLLM2_360M_INST_Q8", sizeMB: 390 },
};

// name → { modelId, loading: Promise|null, progress: number|null }
const models = new Map(Object.keys(CATALOG).map((n) => [n, { modelId: null, loading: null, progress: null }]));

function ensureModelByName(name) {
  const entry = models.get(name);
  const spec = CATALOG[name];
  if (!entry || !spec || !sdk[spec.constant]) {
    return Promise.reject(new Error(`unknown model "${name}"`));
  }
  if (entry.modelId) return Promise.resolve(entry.modelId);
  entry.loading ??= (async () => {
    let lastPct = -1;
    console.log(`[sidecar] loading model "${name}"…`);
    entry.progress = 0;
    try {
      entry.modelId = await sdk.loadModel({
        modelSrc: sdk[spec.constant],
        modelType: "llm",
        onProgress: (p) => {
          const raw = typeof p === "number" ? p : p?.percentage ?? p?.progress ?? p?.percent ?? NaN;
          const pct = Math.round(raw <= 1 && raw > 0 ? raw * 100 : raw);
          if (Number.isFinite(pct)) {
            entry.progress = pct;
            if (pct !== lastPct && pct % 10 === 0) {
              lastPct = pct;
              console.log(`[sidecar] "${name}" load: ${pct}%`);
            }
          }
        },
      });
      entry.progress = 100;
      console.log(`[sidecar] model "${name}" ready`);
      return entry.modelId;
    } catch (err) {
      entry.loading = null;
      entry.progress = null;
      throw err;
    }
  })();
  return entry.loading;
}

function modelStates() {
  return Object.entries(CATALOG).map(([name, spec]) => {
    const e = models.get(name);
    return {
      name,
      sizeMB: spec.sizeMB,
      loaded: e.modelId != null,
      downloading: e.modelId == null && e.loading != null ? (e.progress ?? 0) : null,
    };
  });
}

async function complete(messages, modelName = DEFAULT_MODEL) {
  const name = CATALOG[modelName] ? modelName : DEFAULT_MODEL;
  const id = await ensureModelByName(name);
  const t0 = Date.now();
  const result = sdk.completion({ modelId: id, history: messages, stream: true });
  let text = "";
  for await (const token of result.tokenStream) text += token;
  return { text, model: name, ms: Date.now() - t0 };
}

// Back-compat alias used at startup warm-up.
const ensureModel = () => ensureModelByName(DEFAULT_MODEL);

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

const server = createServer(async (req, res) => {
  cors(res);
  if (req.method === "OPTIONS") {
    res.writeHead(204).end();
    return;
  }

  if (req.method === "GET" && req.url === "/wallet") {
    try {
      const { getWalletInfo } = await import("./wallet.mjs");
      const info = await getWalletInfo();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(info));
    } catch (err) {
      console.error("[wallet] error:", err?.message ?? err);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: String(err?.message ?? err) }));
    }
    return;
  }

  if (req.method === "POST" && req.url === "/wallet/transfer") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", async () => {
      try {
        const { to, amountMinor } = JSON.parse(body);
        if (!to || !amountMinor) throw new Error("to and amountMinor required");
        const { sendTransfer } = await import("./wallet.mjs");
        const txHash = await sendTransfer(to, amountMinor);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, txHash }));
      } catch (err) {
        console.error("[wallet] transfer error:", err?.message ?? err);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: String(err?.message ?? err) }));
      }
    });
    return;
  }

  if (req.method === "POST" && req.url === "/wallet/create") {
    try {
      const { createWallet } = await import("./wallet.mjs");
      const out = await createWallet();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, ...out }));
    } catch (err) {
      console.error("[wallet] create error:", err?.message ?? err);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: String(err?.message ?? err) }));
    }
    return;
  }

  if (req.method === "POST" && req.url === "/wallet/import") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", async () => {
      try {
        const { seedPhrase } = JSON.parse(body);
        const { importWallet } = await import("./wallet.mjs");
        const out = await importWallet(seedPhrase);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, ...out }));
      } catch (err) {
        console.error("[wallet] import error:", err?.message ?? err);
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: String(err?.message ?? err) }));
      }
    });
    return;
  }

  if (req.method === "POST" && req.url === "/wallet/settle") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", async () => {
      try {
        const { payouts } = JSON.parse(body); // [{ to, amountMinor }]
        if (!Array.isArray(payouts) || payouts.length === 0) throw new Error("payouts[] required");
        const { sendSettlement } = await import("./wallet.mjs");
        const out = await sendSettlement(payouts);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, ...out }));
      } catch (err) {
        console.error("[wallet] settle error:", err?.message ?? err);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: String(err?.message ?? err) }));
      }
    });
    return;
  }

  if (req.method === "GET" && req.url === "/health") {
    const def = models.get(DEFAULT_MODEL);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, engine: "qvac", loaded: def.modelId != null, model: DEFAULT_MODEL }));
    return;
  }

  if (req.method === "GET" && req.url?.startsWith("/feed/search")) {
    try {
      const team = new URL(req.url, "http://x").searchParams.get("team") ?? "";
      const { searchMatches } = await import("./feedapi.mjs");
      const matches = await searchMatches(team);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, matches }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: String(err?.message ?? err) }));
    }
    return;
  }

  if (req.method === "GET" && req.url?.startsWith("/feed/match")) {
    try {
      const id = new URL(req.url, "http://x").searchParams.get("id") ?? "";
      const { matchTimeline } = await import("./feedapi.mjs");
      const data = await matchTimeline(id);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, ...data }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: String(err?.message ?? err) }));
    }
    return;
  }

  if (req.method === "GET" && req.url === "/models") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, models: modelStates() }));
    return;
  }

  if (req.method === "POST" && req.url === "/models/load") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      try {
        const { name } = JSON.parse(body);
        if (!CATALOG[name]) throw new Error(`unknown model "${name}"`);
        // Fire and forget — progress is polled via GET /models.
        ensureModelByName(name).catch((err) =>
          console.error(`[sidecar] load "${name}" failed:`, err?.message ?? err),
        );
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, models: modelStates() }));
      } catch (err) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: String(err?.message ?? err) }));
      }
    });
    return;
  }

  if (req.method === "POST" && req.url === "/complete") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", async () => {
      try {
        const { messages, model } = JSON.parse(body);
        if (!Array.isArray(messages) || messages.length === 0) throw new Error("messages[] required");
        const out = await complete(messages, model);
        console.log(`[sidecar] completion via "${out.model}" ${out.ms}ms, ${out.text.length} chars`);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(out));
      } catch (err) {
        console.error("[sidecar] error:", err?.message ?? err);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: String(err?.message ?? err) }));
      }
    });
    return;
  }

  res.writeHead(404).end();
});

initRooms(server); // P2P room replication (Hyperswarm) + WebSocket bridge

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[sidecar] QVAC bridge on http://127.0.0.1:${PORT}`);
  if (process.env.QVAC_DISABLE_LLM) {
    console.log("[sidecar] LLM disabled via QVAC_DISABLE_LLM (rooms-only mode)");
  } else {
    console.log("[sidecar] warming model…");
    // Warm the model at startup so the first oracle run doesn't eat the download.
    ensureModel().catch((err) => console.error("[sidecar] model load failed:", err?.message ?? err));
  }
});
