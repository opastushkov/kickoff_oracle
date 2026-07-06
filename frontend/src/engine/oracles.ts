// Oracle runtime interface + mock implementation (doc/backend-design.md §7.2).
// Oracles are interchangeable committee members — no personas. Independence
// comes from separate inference runs, not from different instructions.
// Phase 2 replaces MockOracleRuntime with the QVAC-backed implementation.

import { sha256Hex } from "./crypto";
import type {
  EvidenceBundle,
  Market,
  OracleVerdict,
  Resolution,
  VerdictValue,
} from "./types";

export interface JudgeRequest {
  oracle: string; // committee slot id, or "TIEBREAKER" for the fallback judge
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

// ─── Mock runtime (tests + no-sidecar fallback): scripted, deterministic ─────

interface Script {
  verdict: VerdictValue;
  confidence: number;
  reason: string;
}

/** Scripts keyed by committee slot index so runs are deterministic. */
const SCRIPTS: { match: RegExp; bySlot: Script[]; tiebreaker: Script }[] = [
  {
    match: /penalty/i,
    bySlot: [
      {
        verdict: "YES",
        confidence: 86,
        reason: "The recorded contact in the box plus the VAR confirmation support the decision.",
      },
      {
        verdict: "YES",
        confidence: 82,
        reason: "The feed event and the attached note both point to a correctly awarded penalty.",
      },
      {
        verdict: "NO",
        confidence: 58,
        reason: "Without video the severity of the contact cannot be verified from this bundle.",
      },
    ],
    tiebreaker: {
      verdict: "YES",
      confidence: 74,
      reason: "On the locked evidence alone, the VAR confirmation outweighs the missing video.",
    },
  },
  {
    match: /red card/i,
    bySlot: [
      {
        verdict: "YES",
        confidence: 71,
        reason: "A second bookable offence mandates a red card under the laws of the game.",
      },
      {
        verdict: "INSUFFICIENT_EVIDENCE",
        confidence: 44,
        reason: "The bundle records the card but nothing about the severity of the challenge.",
      },
      {
        verdict: "NO",
        confidence: 52,
        reason: "Deservedness cannot be established from the recorded events alone.",
      },
    ],
    tiebreaker: {
      verdict: "INSUFFICIENT_EVIDENCE",
      confidence: 40,
      reason: "The locked bundle does not describe the challenge itself, only its outcome.",
    },
  },
];

const DEFAULT_SCRIPT: Script = {
  verdict: "INSUFFICIENT_EVIDENCE",
  confidence: 35,
  reason: "The locked evidence does not address this question directly.",
};

function slotIndex(oracle: string): number {
  const m = oracle.match(/(\d+)$/);
  return m ? Number(m[1]) - 1 : 0;
}

export class MockOracleRuntime implements OracleRuntime {
  constructor(public delayMs = 1200) {}

  async judge(req: JudgeRequest): Promise<JudgeResult> {
    if (this.delayMs > 0) await new Promise((r) => setTimeout(r, this.delayMs));
    const set = SCRIPTS.find((s) => s.match.test(req.question));
    const script =
      req.oracle === "TIEBREAKER"
        ? set?.tiebreaker ?? DEFAULT_SCRIPT
        : set?.bySlot[slotIndex(req.oracle) % (set?.bySlot.length || 1)] ?? DEFAULT_SCRIPT;
    return { ...script, rawOutput: JSON.stringify(script) };
  }

  async explain(market: Market, resolution: Resolution, verdicts: OracleVerdict[]): Promise<string> {
    const { counts, outcome } = resolution;
    const agreeing = outcome === "YES" ? counts.yes : counts.no;
    const total = verdicts.filter((v) => v.oracle !== "TIEBREAKER").length;
    const primary = market.bundle?.items.find((i) => i.weight === "PRIMARY")?.content ?? "the feed evidence";
    const secondary = market.bundle?.items.find((i) => i.weight === "SECONDARY")?.content;
    const dissenter = verdicts.find((v) => v.oracle !== "TIEBREAKER" && v.verdict !== outcome);
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
        `One oracle ${dissenter.verdict === "INSUFFICIENT_EVIDENCE" ? "found the evidence insufficient" : "dissented"}: ${dissenter.reason.replace(/\.$/, "").toLowerCase()}.`,
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
    oracle: req.oracle,
    model: result.model ?? req.model,
    verdict: result.verdict,
    confidence: result.confidence,
    reason: result.reason,
    outputHash: await sha256Hex(result.rawOutput),
  };
}
