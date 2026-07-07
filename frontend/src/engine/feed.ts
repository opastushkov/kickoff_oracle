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

export interface RemoteMatch {
  id: string;
  label: string;
}

/** Search real matches by team name via the sidecar's feed provider. */
export async function searchRealMatches(
  team: string,
  baseUrl = "http://127.0.0.1:8791",
): Promise<RemoteMatch[]> {
  try {
    const res = await fetch(`${baseUrl}/feed/search?team=${encodeURIComponent(team)}`, {
      signal: AbortSignal.timeout(20_000),
    });
    const j = await res.json();
    return j?.ok ? (j.matches as RemoteMatch[]) : [];
  } catch {
    return [];
  }
}

/** Fetch a real match's timeline as a replayable fixture (accelerated clock). */
export async function fetchMatchFixture(
  matchId: string,
  baseUrl = "http://127.0.0.1:8791",
): Promise<MatchFixture | null> {
  try {
    const res = await fetch(`${baseUrl}/feed/match?id=${encodeURIComponent(matchId)}`, {
      signal: AbortSignal.timeout(20_000),
    });
    const j = await res.json();
    if (!j?.ok || !Array.isArray(j.events) || j.events.length === 0) return null;
    return {
      id: `api-${matchId}`,
      label: String(j.label ?? "Real match"),
      events: j.events.map((e: FixtureEvent, i: number) => ({
        id: `api_${matchId}_${i}`, // deterministic → dedups across peers
        atSeconds: 12 + i * 30,
        minute: e.minute,
        type: e.type,
        team: e.team,
        description: e.description,
        detail: e.detail,
      })),
    };
  } catch {
    return null;
  }
}

/**
 * Start replaying the fixture into the room. Events already present in the
 * timeline (e.g. after a creator reload) are skipped; the remaining ones play
 * with their original spacing. Returns a stop function.
 */
export function startMatchFeed(engine: KickoffEngine, fixture: MatchFixture): () => void {
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
