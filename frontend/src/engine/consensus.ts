// Threshold consensus (doc/backend-design.md §7.3).

import type { OracleVerdict, RoomPolicy, Side } from "./types";

export interface Tally {
  yes: number;
  no: number;
  insufficient: number;
}

export function tally(verdicts: OracleVerdict[]): Tally {
  const committee = verdicts.filter((v) => v.oracle !== "TIEBREAKER");
  return {
    yes: committee.filter((v) => v.verdict === "YES").length,
    no: committee.filter((v) => v.verdict === "NO").length,
    insufficient: committee.filter((v) => v.verdict === "INSUFFICIENT_EVIDENCE").length,
  };
}

/** Confidence is never an input — verdict counts only (UC-07 business rule). */
export function thresholdOutcome(t: Tally, policy: RoomPolicy): Side | null {
  if (t.yes >= policy.threshold) return "YES";
  if (t.no >= policy.threshold) return "NO";
  return null;
}
