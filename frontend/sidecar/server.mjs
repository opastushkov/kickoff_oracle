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
const MODEL_LABEL = "Llama 3.2 1B";

let modelId = null;
let loading = null;

async function ensureModel() {
  if (modelId) return modelId;
  loading ??= (async () => {
    let lastPct = -1;
    console.log("[sidecar] loading model…");
    modelId = await sdk.loadModel({
      modelSrc: sdk.LLAMA_3_2_1B_INST_Q4_0,
      modelType: "llm",
      onProgress: (p) => {
        const raw = typeof p === "number" ? p : p?.progress ?? p?.percent ?? NaN;
        const pct = Math.round(raw <= 1 ? raw * 100 : raw);
        if (Number.isFinite(pct) && pct !== lastPct && pct % 10 === 0) {
          lastPct = pct;
          console.log(`[sidecar] model load: ${pct}%`);
        }
      },
    });
    console.log("[sidecar] model ready");
    return modelId;
  })();
  return loading;
}

async function complete(messages) {
  const id = await ensureModel();
  const t0 = Date.now();
  const result = sdk.completion({ modelId: id, history: messages, stream: true });
  let text = "";
  for await (const token of result.tokenStream) text += token;
  return { text, model: MODEL_LABEL, ms: Date.now() - t0 };
}

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

  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, engine: "qvac", loaded: modelId != null, model: MODEL_LABEL }));
    return;
  }

  if (req.method === "POST" && req.url === "/complete") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", async () => {
      try {
        const { messages } = JSON.parse(body);
        if (!Array.isArray(messages) || messages.length === 0) throw new Error("messages[] required");
        const out = await complete(messages);
        console.log(`[sidecar] completion ${out.ms}ms, ${out.text.length} chars`);
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
