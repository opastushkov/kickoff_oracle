// Real match data provider (UC-05 alternative flow: real feeds).
// Uses TheSportsDB (free/dev key "3"; set SPORTSDB_KEY for a production key).
// The sidecar proxies the API so the browser needs no key and no CORS games.
// Provider is pluggable — an API-Football adapter can replace this for richer
// per-player statistics on the same endpoints.

const KEY = process.env.SPORTSDB_KEY ?? "3";
const BASE = `https://www.thesportsdb.com/api/v1/json/${KEY}`;

async function getJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`sportsdb ${res.status}`);
  return res.json();
}

/** Search a team by name → its most recent finished matches. */
export async function searchMatches(teamName) {
  const t = await getJson(`${BASE}/searchteams.php?t=${encodeURIComponent(teamName)}`);
  const team = (t?.teams ?? []).find((x) => x.strSport === "Soccer") ?? t?.teams?.[0];
  if (!team) return [];
  const last = await getJson(`${BASE}/eventslast.php?id=${team.idTeam}`);
  const events = last?.results ?? last?.events ?? [];
  return events
    .filter((e) => e.strSport === "Soccer" || !e.strSport)
    .map((e) => ({
      id: String(e.idEvent),
      label: `${e.strEvent} — ${e.dateEvent}${e.intHomeScore != null ? ` (${e.intHomeScore}–${e.intAwayScore})` : ""}`,
    }));
}

/** Fetch a match's real timeline mapped to Kickoff event shapes. */
export async function matchTimeline(eventId) {
  const evRes = await getJson(`${BASE}/lookupevent.php?id=${eventId}`);
  const ev = evRes?.events?.[0];
  if (!ev) throw new Error("match not found");
  const tlRes = await getJson(`${BASE}/lookuptimeline.php?id=${eventId}`);
  const timeline = tlRes?.timeline ?? [];

  const events = [];
  const perPlayer = new Map(); // real per-player involvement, derived from the timeline
  const bump = (player, team, field) => {
    if (!player) return;
    const a = perPlayer.get(player) ?? { team, goals: 0, assists: 0, cards: 0 };
    a[field] += 1;
    perPlayer.set(player, a);
  };

  for (const t of timeline) {
    const minute = parseInt(t.intTime, 10) || 0;
    const kind = String(t.strTimeline ?? "").toLowerCase();
    const detail = String(t.strTimelineDetail ?? "");
    if (kind.includes("goal")) {
      const isPen = /penalt/i.test(detail);
      events.push({
        minute,
        type: isPen ? "PENALTY" : "GOAL",
        team: t.strTeam || undefined,
        description: `${isPen ? "Penalty goal" : "Goal"} — ${t.strPlayer || t.strTeam || "unknown"}`,
        detail: t.strAssist ? `Assist: ${t.strAssist}` : detail || undefined,
      });
      bump(t.strPlayer, t.strTeam, "goals");
      bump(t.strAssist, t.strTeam, "assists");
    } else if (kind.includes("card")) {
      events.push({
        minute,
        type: "CARD",
        team: t.strTeam || undefined,
        description: `${detail || "Card"} — ${t.strPlayer || t.strTeam || "unknown"}`,
        detail: undefined,
      });
      bump(t.strPlayer, t.strTeam, "cards");
    }
  }
  events.sort((a, b) => a.minute - b.minute);

  // Per-player stat lines as feed events (evidence for comparative markets),
  // derived strictly from the real timeline — nothing invented.
  const ranked = [...perPlayer.entries()]
    .map(([player, a]) => ({ player, ...a, score: a.goals * 3 + a.assists * 2 + a.cards }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 4);
  for (const p of ranked) {
    const bits = [];
    if (p.goals) bits.push(`${p.goals} goal${p.goals > 1 ? "s" : ""}`);
    if (p.assists) bits.push(`${p.assists} assist${p.assists > 1 ? "s" : ""}`);
    if (p.cards) bits.push(`${p.cards} card${p.cards > 1 ? "s" : ""}`);
    if (bits.length === 0) continue;
    events.push({
      minute: 90,
      type: "STATS",
      team: p.team || undefined,
      description: `Player stats — ${p.player}`,
      detail: bits.join(" · "),
    });
  }

  events.push({
    minute: 90,
    type: "FULL_TIME",
    description: "Full time",
    detail: `${ev.strHomeTeam} ${ev.intHomeScore ?? "?"} — ${ev.intAwayScore ?? "?"} ${ev.strAwayTeam}`,
  });

  return { label: `${ev.strEvent} (${ev.dateEvent})`, events };
}
