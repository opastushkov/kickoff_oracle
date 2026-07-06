// QVAC-backed oracle runtime (doc/backend-design.md §7.2, Phase 2).
// Talks to the local sidecar (sidecar/server.mjs), which runs inference
// on-device through @qvac/sdk. If the sidecar is not running, the app
// falls back to the mock runtime automatically (detectQvacRuntime → null).

import { MockOracleRuntime, type JudgeRequest, type JudgeResult, type OracleRuntime } from "./oracles";
import type { EvidenceItem, Market, OracleVerdict, Resolution } from "./types";

// One neutral instruction for every committee member — oracles are
// interchangeable; independence comes from separate inference runs.
const ORACLE_PROMPT =
  "You are an independent oracle on a football watch-party market committee. " +
  "Judge the question strictly and only on the locked evidence provided: the recorded " +
  "events, any notes, and any rulebook excerpts. Do not speculate beyond the evidence; " +
  "if it is not sufficient to decide, answer INSUFFICIENT_EVIDENCE.";

const TIEBREAKER_PROMPT =
  "You are the tiebreaker oracle. The committee split without consensus. " +
  "Weigh the locked evidence neutrally and decide only if it genuinely supports a side; " +
  "otherwise answer INSUFFICIENT_EVIDENCE.";

const JSON_RULES =
  'Respond with a single JSON object and nothing else — no markdown, no prose around it: ' +
  '{"verdict":"YES"|"NO"|"INSUFFICIENT_EVIDENCE","confidence":<integer 0-100>,"reason":"<one sentence>"}';

function bundleText(items: EvidenceItem[]): string {
  return items.map((i) => `- [${i.weight} · ${i.kind}] ${i.content}`).join("\n");
}

function parseVerdict(text: string): { verdict: JudgeResult["verdict"]; confidence: number; reason: string } | null {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const j = JSON.parse(match[0]);
    if (j.verdict !== "YES" && j.verdict !== "NO" && j.verdict !== "INSUFFICIENT_EVIDENCE") return null;
    const confidence = Math.max(0, Math.min(100, Math.round(Number(j.confidence) || 0)));
    return { verdict: j.verdict, confidence, reason: String(j.reason ?? "").slice(0, 300) || "No reason given." };
  } catch {
    return null;
  }
}

export class QvacOracleRuntime implements OracleRuntime {
  private fallback = new MockOracleRuntime(0);

  constructor(
    private baseUrl: string,
    public readonly modelLabel: string,
  ) {}

  private async complete(messages: { role: string; content: string }[], timeoutMs = 240_000): Promise<string> {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(`${this.baseUrl}/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages }),
        signal: ctrl.signal,
      });
      if (!res.ok) throw new Error(`sidecar ${res.status}: ${await res.text()}`);
      const j = await res.json();
      return String(j.text ?? "");
    } finally {
      clearTimeout(t);
    }
  }

  async judge(req: JudgeRequest): Promise<JudgeResult> {
    const messages = [
      {
        role: "system",
        content: `${req.oracle === "TIEBREAKER" ? TIEBREAKER_PROMPT : ORACLE_PROMPT}\n${JSON_RULES}`,
      },
      {
        role: "user",
        content:
          `Market question: ${req.question}\n\n` +
          `Locked evidence bundle (the ONLY material you may consider):\n${bundleText(req.bundle.items)}\n\n` +
          `Judge the question strictly on this evidence. ${JSON_RULES}`,
      },
    ];

    // One retry on malformed output, then INSUFFICIENT_EVIDENCE (doc §7.2).
    for (let attempt = 0; attempt < 2; attempt++) {
      const raw = await this.complete(messages);
      const parsed = parseVerdict(raw);
      if (parsed) return { ...parsed, rawOutput: raw, model: this.modelLabel };
    }
    return {
      verdict: "INSUFFICIENT_EVIDENCE",
      confidence: 0,
      reason: "The oracle's output could not be parsed as a valid verdict.",
      rawOutput: "parse-failure",
      model: this.modelLabel,
    };
  }

  async explain(market: Market, resolution: Resolution, verdicts: OracleVerdict[]): Promise<string> {
    try {
      const votes = verdicts
        .map((v) => `${v.oracle}: ${v.verdict} (${v.confidence}%) — ${v.reason}`)
        .join("\n");
      const text = await this.complete(
        [
          {
            role: "system",
            content:
              "You write a 2–3 sentence plain-language explanation of a market resolution for non-technical " +
              "participants. Name the outcome, the vote result, the key evidence, and any dissent. Plain text only.",
          },
          {
            role: "user",
            content:
              `Question: ${market.question}\nOutcome: ${resolution.outcome} (via ${resolution.via})\n` +
              `Votes: YES ${resolution.counts.yes} · NO ${resolution.counts.no} · INSUFFICIENT ${resolution.counts.insufficient}\n` +
              `Evidence:\n${bundleText(market.bundle?.items ?? [])}\n\nOracle votes:\n${votes}`,
          },
        ],
        120_000,
      );
      const clean = text.trim();
      return clean.length > 0 ? clean.slice(0, 600) : await this.fallback.explain(market, resolution, verdicts);
    } catch {
      return this.fallback.explain(market, resolution, verdicts);
    }
  }
}

/** Probe the local sidecar; null → caller should stay on the mock runtime. */
export async function detectQvacRuntime(
  baseUrl = "http://127.0.0.1:8791",
): Promise<QvacOracleRuntime | null> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 1500);
    const res = await fetch(`${baseUrl}/health`, { signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) return null;
    const j = await res.json();
    return j?.ok ? new QvacOracleRuntime(baseUrl, String(j.model ?? "local model")) : null;
  } catch {
    return null;
  }
}
