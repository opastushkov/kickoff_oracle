// Oracle runtime interface + mock implementation (doc/backend-design.md §7.2).
// Phase 2 replaces MockOracleRuntime with a QVAC-backed implementation; the
// engine only depends on this interface.

import { sha256Hex } from "./crypto";
import type {
  EvidenceBundle,
  Market,
  OracleConfig,
  OracleVerdict,
  Resolution,
  VerdictValue,
} from "./types";

export interface JudgeRequest {
  role: OracleConfig["role"] | "TIEBREAKER";
  model: string;
  question: string;
  bundle: EvidenceBundle;
}

export interface JudgeResult {
  verdict: VerdictValue;
  confidence: number;
  reason: string;
  rawOutput: string;
  /** Actual model that produced the output, when it differs from the requested one. */
  model?: string;
}

export interface OracleRuntime {
  judge(req: JudgeRequest): Promise<JudgeResult>;
  explain(market: Market, resolution: Resolution, verdicts: OracleVerdict[]): Promise<string>;
}

// ─── Mock runtime (Phase 1): scripted verdicts, real pipeline ────────────────

interface Script {
  verdict: VerdictValue;
  confidence: number;
  reason: string;
}

const SCRIPTS: { match: RegExp; byRole: Record<string, Script> }[] = [
  {
    match: /penalty/i,
    byRole: {
      RULES: {
        verdict: "YES",
        confidence: 86,
        reason: "The rule excerpt supports a penalty when a defender trips an opponent.",
      },
      EVIDENCE: {
        verdict: "YES",
        confidence: 82,
        reason: "The feed confirms a penalty and VAR confirmation.",
      },
      SKEPTIC: {
        verdict: "NO",
        confidence: 58,
        reason:
          "The evidence does not include video, so the contact may not be enough to prove the penalty was correct.",
      },
      TIEBREAKER: {
        verdict: "YES",
        confidence: 74,
        reason: "On the locked evidence alone, the VAR confirmation outweighs the missing video.",
      },
    },
  },
  {
    match: /red card/i,
    byRole: {
      RULES: {
        verdict: "YES",
        confidence: 71,
        reason: "A second bookable offence mandates a red card under the laws of the game.",
      },
      EVIDENCE: {
        verdict: "INSUFFICIENT_EVIDENCE",
        confidence: 44,
        reason: "The feed records the card but nothing about the severity of the challenge.",
      },
      SKEPTIC: {
        verdict: "NO",
        confidence: 52,
        reason: "Without footage of the challenge, deservedness cannot be established.",
      },
      TIEBREAKER: {
        verdict: "INSUFFICIENT_EVIDENCE",
        confidence: 40,
        reason: "The locked bundle does not describe the challenge itself, only its outcome.",
      },
    },
  },
];

const DEFAULT_SCRIPT: Script = {
  verdict: "INSUFFICIENT_EVIDENCE",
  confidence: 35,
  reason: "The locked evidence does not address this question directly.",
};

export class MockOracleRuntime implements OracleRuntime {
  constructor(public delayMs = 1200) {}

  async judge(req: JudgeRequest): Promise<JudgeResult> {
    if (this.delayMs > 0) await new Promise((r) => setTimeout(r, this.delayMs));
    const script =
      SCRIPTS.find((s) => s.match.test(req.question))?.byRole[req.role] ?? DEFAULT_SCRIPT;
    return { ...script, rawOutput: JSON.stringify(script) };
  }

  async explain(market: Market, resolution: Resolution, verdicts: OracleVerdict[]): Promise<string> {
    const { counts, outcome } = resolution;
    const agreeing = outcome === "YES" ? counts.yes : counts.no;
    const total = verdicts.filter((v) => v.role !== "TIEBREAKER").length;
    const primary = market.bundle?.items.find((i) => i.weight === "PRIMARY")?.content ?? "the feed evidence";
    const secondary = market.bundle?.items.find((i) => i.weight === "SECONDARY")?.content;
    const dissenter = verdicts.find(
      (v) => v.role !== "TIEBREAKER" && v.verdict !== outcome,
    );
    const parts = [
      resolution.via === "CONSENSUS"
        ? `The market resolved ${outcome} after ${agreeing} of ${total} oracles agreed.`
        : resolution.via === "TIEBREAKER"
          ? `The committee split, so the tiebreaker oracle resolved the market ${outcome} from the same locked evidence.`
          : `The market resolved ${outcome} directly from objective feed facts.`,
      `The key evidence was ${secondary ? secondary.replace(/\.$/, "").toLowerCase() : primary}.`,
    ];
    if (dissenter) {
      parts.push(
        `The ${dissenter.role.toLowerCase()} oracle ${dissenter.verdict === "INSUFFICIENT_EVIDENCE" ? "found the evidence insufficient" : "disagreed"}: ${dissenter.reason.replace(/\.$/, "").toLowerCase()}.`,
      );
    }
    return parts.join(" ");
  }
}

export async function toVerdict(
  req: JudgeRequest,
  result: JudgeResult,
  marketId: string,
): Promise<OracleVerdict> {
  return {
    marketId,
    bundleHash: req.bundle.hash,
    role: req.role,
    model: result.model ?? req.model,
    verdict: result.verdict,
    confidence: result.confidence,
    reason: result.reason,
    outputHash: await sha256Hex(result.rawOutput),
  };
}
