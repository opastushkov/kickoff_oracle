// QVAC-backed oracle runtime (doc/backend-design.md §7.2, Phase 2).
// Talks to the local sidecar (sidecar/server.mjs), which runs inference
// on-device through @qvac/sdk. If the sidecar is not running, the app
// falls back to the mock runtime automatically (detectQvacRuntime → null).

import { MockOracleRuntime, type JudgeRequest, type JudgeResult, type OracleRuntime } from "./oracles";
import type { EvidenceItem, Market, OracleVerdict, Resolution } from "./types";

// One neutral instruction for every committee member — oracles are
// interchangeable; independence comes from separate inference runs.
const RULES =
  "Decide using ONLY the locked evidence provided (the recorded match events and stats). " +
  "Answer YES only if the evidence EXPLICITLY and fully supports the claim. " +
  "If the evidence contradicts the claim, or does not contain enough to support it, answer NO. " +
  "For counting or numeric claims (e.g. 'scored N goals'), count ONLY what the evidence " +
  "explicitly shows — never assume, round up, or inflate. " +
  "Never invent players, goals, or events that are not written in the evidence. " +
  "Use INSUFFICIENT_EVIDENCE only when the evidence is genuinely silent on the subject.";

const ORACLE_PROMPT =
  "You are an independent oracle judging a YES/NO question about a football match. " + RULES;

const TIEBREAKER_PROMPT =
  "You are the tiebreaker oracle; the jury split without consensus. Judge neutrally. " + RULES;

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

  private async complete(
    messages: { role: string; content: string }[],
    model?: string,
    timeoutMs = 240_000,
  ): Promise<{ text: string; model: string }> {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(`${this.baseUrl}/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages, model }),
        signal: ctrl.signal,
      });
      if (!res.ok) throw new Error(`sidecar ${res.status}: ${await res.text()}`);
      const j = await res.json();
      return { text: String(j.text ?? ""), model: String(j.model ?? model ?? this.modelLabel) };
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
      const out = await this.complete(messages, req.model);
      const parsed = parseVerdict(out.text);
      if (parsed) return { ...parsed, rawOutput: out.text, model: out.model };
    }
    return {
      verdict: "INSUFFICIENT_EVIDENCE",
      confidence: 0,
      reason: "The oracle's output could not be parsed as a valid verdict.",
      rawOutput: "parse-failure",
      model: req.model,
    };
  }

  async explain(market: Market, resolution: Resolution, verdicts: OracleVerdict[]): Promise<string> {
    try {
      const votes = verdicts
        .map((v) => `${v.oracle}: ${v.verdict} (${v.confidence}%) — ${v.reason}`)
        .join("\n");
      const out = await this.complete(
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
        verdicts[0]?.model, // explain with a model that is already loaded
        120_000,
      );
      const clean = out.text.trim();
      return clean.length > 0 ? clean.slice(0, 600) : await this.fallback.explain(market, resolution, verdicts);
    } catch {
      return this.fallback.explain(market, resolution, verdicts);
    }
  }
}

// ─── Model catalog client (room setup: pick + download models) ──────────────

export interface QvacModelInfo {
  name: string;
  sizeMB: number;
  loaded: boolean;
  /** Download progress 0–100 while downloading, null otherwise. */
  downloading: number | null;
  /** Why the last download failed, if it did (from GET /models). */
  error?: string | null;
}

export async function listQvacModels(baseUrl = "http://127.0.0.1:8791"): Promise<QvacModelInfo[] | null> {
  try {
    const res = await fetch(`${baseUrl}/models`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return null;
    const j = await res.json();
    return j?.ok ? (j.models as QvacModelInfo[]) : null;
  } catch {
    return null;
  }
}

/** Ask the sidecar to download a model. Returns null on success, else why not. */
export async function requestQvacModel(
  name: string,
  baseUrl = "http://127.0.0.1:8791",
): Promise<string | null> {
  try {
    const res = await fetch(`${baseUrl}/models/load`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) return null;
    const j = await res.json().catch(() => null);
    return String(j?.error ?? `download request failed (HTTP ${res.status})`);
  } catch {
    return "The local helper did not respond — is the sidecar running on this machine?";
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
