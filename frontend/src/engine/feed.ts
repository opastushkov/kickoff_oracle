// Match evidence feed (backend-design.md `feed/`, UC-05).
// Production target: a licensed live sports-data API. Current cut: a single
// hardcoded match replayed on an accelerated clock. The room creator's client
// plays the fixture; events carry fixed ids, so if several peers ever replay
// the same fixture the ops deduplicate by content and the reducer by event id.
// Manual event entry was removed on purpose — facts come from the feed, not
// from a participant's keyboard.

import type { KickoffEngine } from "./engine";
import type { TimelineEventType } from "./types";

export interface FixtureEvent {
  id: string;
  /** Seconds after feed start (accelerated clock — a full match in ~6 minutes). */
  atSeconds: number;
  minute: number;
  type: TimelineEventType;
  team?: string;
  description: string;
  detail?: string;
}

export interface MatchFixture {
  id: string;
  label: string;
  events: FixtureEvent[];
}

/** The one match available for now. Swappable for an API adapter later. */
export const MATCH_FIXTURE: MatchFixture = {
  id: "ukr-esp-replay-001",
  label: "Ukraine vs Spain (replay feed)",
  events: [
    { id: "feed_ukresp_01", atSeconds: 15, minute: 12, type: "GOAL", team: "Spain", description: "Goal — Spain", detail: "Header from a corner" },
    { id: "feed_ukresp_02", atSeconds: 65, minute: 23, type: "CARD", team: "Ukraine", description: "Yellow card — Ukraine defender", detail: "Late challenge in midfield" },
    { id: "feed_ukresp_03", atSeconds: 125, minute: 41, type: "GOAL", team: "Ukraine", description: "Goal — Ukraine", detail: "Counter-attack, low finish" },
    { id: "feed_ukresp_04", atSeconds: 185, minute: 55, type: "CARD", team: "Ukraine", description: "Second yellow → red card — Ukraine defender", detail: "Shirt pull stopped a break" },
    { id: "feed_ukresp_05", atSeconds: 245, minute: 67, type: "PENALTY", team: "Ukraine", description: "Penalty — Ukraine", detail: "VAR confirmed" },
    { id: "feed_ukresp_06", atSeconds: 305, minute: 78, type: "GOAL", team: "Spain", description: "Goal — Spain", detail: "Free kick, top corner" },
    { id: "feed_ukresp_07", atSeconds: 365, minute: 90, type: "FULL_TIME", description: "Full time", detail: "Spain 2 — 1 Ukraine" },
  ],
};

/**
 * Start replaying the fixture into the room. Events already present in the
 * timeline (e.g. after a creator reload) are skipped; the remaining ones play
 * with their original spacing. Returns a stop function.
 */
export function startMatchFeed(engine: KickoffEngine, fixture: MatchFixture = MATCH_FIXTURE): () => void {
  const already = new Set(engine.getView().timeline.map((e) => e.id));
  const pending = fixture.events.filter((e) => !already.has(e.id));
  if (pending.length === 0) return () => {};

  const base = pending[0].atSeconds;
  const timers: ReturnType<typeof setTimeout>[] = [];
  for (const ev of pending) {
    const delayMs = (ev.atSeconds - base + 10) * 1000; // first pending event ~10 s in
    timers.push(
      setTimeout(() => {
        void engine.emitEvent({
          id: ev.id,
          minute: ev.minute,
          type: ev.type,
          team: ev.team,
          description: ev.description,
          detail: ev.detail,
          source: "REPLAY",
        });
      }, delayMs),
    );
  }
  return () => timers.forEach(clearTimeout);
}
