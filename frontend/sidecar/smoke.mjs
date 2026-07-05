// QVAC smoke test: prove real on-device inference on this machine.
// Prints the SDK surface first so API drift is visible, then loads
// Llama 3.2 1B (one-time download) and runs a tiny JSON completion.

import * as sdk from "@qvac/sdk";

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

try {
  log("exports:", Object.keys(sdk).sort().join(", "));

  const modelSrc = sdk.LLAMA_3_2_1B_INST_Q4_0;
  log("modelSrc:", typeof modelSrc === "string" ? modelSrc : JSON.stringify(modelSrc)?.slice(0, 300));

  let lastPct = -1;
  const modelId = await sdk.loadModel({
    modelSrc,
    modelType: "llm",
    onProgress: (p) => {
      const raw = typeof p === "number" ? p : p?.progress ?? p?.percent ?? NaN;
      const pct = Math.round(raw <= 1 ? raw * 100 : raw);
      if (Number.isFinite(pct) && pct !== lastPct && pct % 5 === 0) {
        lastPct = pct;
        log(`load progress: ${pct}%`);
      } else if (!Number.isFinite(pct) && lastPct === -1) {
        lastPct = -2;
        log("progress payload sample:", JSON.stringify(p)?.slice(0, 200));
      }
    },
  });
  log("model loaded, id:", JSON.stringify(modelId)?.slice(0, 120));

  const history = [
    { role: "system", content: "You reply with valid JSON only, nothing else." },
    { role: "user", content: 'Return exactly this JSON: {"ok":true,"msg":"qvac-live"}' },
  ];
  const t0 = Date.now();
  const result = sdk.completion({ modelId, history, stream: true });
  let text = "";
  for await (const token of result.tokenStream) text += token;
  log(`completion in ${((Date.now() - t0) / 1000).toFixed(1)}s:`, text.trim().slice(0, 200));

  await sdk.unloadModel?.({ modelId });
  await sdk.close?.();
  log("SMOKE OK");
  process.exit(0);
} catch (err) {
  console.error("SMOKE FAILED:", err?.message ?? err);
  console.error(err?.stack);
  process.exit(1);
}
