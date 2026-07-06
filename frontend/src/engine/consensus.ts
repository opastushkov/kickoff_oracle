// Threshold consensus + deterministic facts evaluation (doc/backend-design.md §7.3–7.4).

import type { FactsRule, OracleVerdict, RoomPolicy, Side, TimelineEvent } from "./types";

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

/**
 * Evaluate a facts rule against the typed timeline (UC-09 FACTS fallback, UC-14
 * objective short-circuit). Returns YES/NO when decidable, null while undecided.
 */
export function evaluateFacts(rule: FactsRule, timeline: TimelineEvent[]): Side | null {
  const needed = rule.countAtLeast ?? 1;
  const matches = timeline.filter(
    (e) =>
      e.type === rule.eventType &&
      (rule.team === undefined || e.team === rule.team) &&
      (rule.beforeMinute === undefined || e.minute < rule.beforeMinute),
  );
  if (matches.length >= needed) return "YES";
  // Decidable as NO once a live event lands at/after the window boundary.
  // FULL_TIME is deliberately not decisive in Phase 1: the demo replays a
  // pre-seeded 90' entry while the room is still "live" mid-match, so treating
  // it as final would resolve open windows prematurely.
  const windowClosed =
    rule.beforeMinute !== undefined &&
    timeline.some((e) => e.minute >= rule.beforeMinute! && e.type !== "FULL_TIME");
  if (windowClosed) return "NO";
  return null;
}
