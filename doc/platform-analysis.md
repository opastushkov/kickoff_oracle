# Kickoff Oracle — Platform Analysis

> Analysis date: 2026-07-04 · Scope: `frontend/` code bundle + product concept docs (`frontend/src/imports/kickoff-oracle-figma-prompt-revised.md`)

## 1. What the platform is

**Kickoff Oracle** is a private, serverless football watch-party platform where friends create
prediction markets about a live (or replayed) match, stake **demo/test USDt**, and have the
markets resolved not by a bookmaker or a single admin, but by a **committee of local AI
oracles** (size and threshold chosen per room) that review a locked evidence bundle and
vote. A market resolves only when a **threshold consensus** (e.g. 2-of-3) is reached.

The core mechanism, in one line:

> Evidence comes in → three oracles vote → threshold consensus resolves the market.

It is explicitly positioned as a **watch-party and oracle-consensus tool, not a sportsbook**:
no odds, no real-money betting language, persistent "TESTNET USDt" labeling on every
screen that shows money-like values.

## 2. Target stack (hackathon concept)

| Layer | Technology | Role |
|---|---|---|
| Networking | **Pears** (Holepunch) | Serverless P2P rooms — no central server; peers sync room state directly ("P2P · synced" indicator) |
| AI runtime | **QVAC** | Runs the LLM oracle committee **locally** ("Runs locally via QVAC — no data leaves your machine") and generates the plain-language resolution explanation |
| Payments | **WDK** (Wallet Development Kit) | Test-USDt balances, stakes, and settlement payouts |

## 3. Current implementation state

The repository contains the Figma-Make-exported **interactive prototype** plus the
**Phase-1 room engine** (`frontend/src/engine/` — see
[backend-design.md](backend-design.md) §10): a replicated-op-log state machine with real
SHA-256 evidence/vote hashing, threshold consensus with the facts/tiebreaker fallback, and
bigint pro-rata settlement that actually mutates balances. The UI's golden path runs on
this engine, and oracle verdicts run on a **real local LLM** (Llama 3.2 1B through the
QVAC SDK, bridged by `frontend/sidecar/`; scripted mock fallback when the sidecar is
off). Rooms replicate **across devices over Hyperswarm** via the sidecar's room node
(first cut: op relay with JSONL persistence; Autobase upgrade pending) — invite keys
map to swarm topics, and a second machine can join a live room by key. Still absent:
wallet integration (WDK).

### 3.1 Repository layout

```
Tether_Hackathon/
├── doc/                  ← this documentation
└── frontend/             ← Vite + React 18 + Tailwind 4 prototype
    ├── src/
    │   ├── main.tsx
    │   ├── app/
    │   │   ├── App.tsx                    ← the entire product UI (~1,380 lines)
    │   │   └── components/ui/             ← full shadcn/Radix UI kit (mostly unused by App.tsx)
    │   ├── engine/                        ← Phase-1 room engine: op log + reducers, crypto,
    │   │                                    consensus/fallback, settlement, mock oracles, demo seed
    │   ├── imports/
    │   │   └── kickoff-oracle-figma-prompt-revised.md   ← product/design spec
    │   └── styles/                        ← Tailwind, theme, fonts
    ├── package.json       ← React 18, Vite 6, Tailwind 4, Radix, motion, recharts, MUI, …
    └── README.md          ← run with `npm i` + `npm run dev`
```

### 3.2 What is actually implemented (simulated)

Everything lives in [App.tsx](../frontend/src/app/App.tsx) as a single-file, four-screen SPA
with client-side screen switching (no router usage despite `react-router` being installed):

| Screen | Content | Interactivity |
|---|---|---|
| **Landing** | Hero, "How it works" (4 steps), market-type explainer, oracle committee preview, transparency cards, CTA footer | Navigation buttons only |
| **Room home** | Room header with copyable invite key `room_7KQ9`, 2×2 market card grid, evidence timeline rail | Copy invite key; "Emit next event"; navigate to market |
| **Market detail** | Question header, stake panel (YES/NO/pot), Evidence bundle / Oracle committee / Consensus result panels, timeline rail | "Emit next event" → enables "Run oracles" → staggered oracle reveal animation → 2-of-3 consensus → "View settlement"; reset button |
| **Settlement** | Payout rows, QVAC explanation quote card, receipt-style audit log | Copy-to-clipboard on audit entries |

Cross-cutting implemented elements:

- **Global top bar**: room name, live-minute chip (highest recorded minute), the
  participants' avatars, "P2P · synced" indicator, "TESTNET USDt" badge, and the local
  user's wallet balance chip.
- **Evidence feed** right rail with minute-marked events arriving automatically from
  the bound match fixture (hardcoded single-match replay, accelerated clock; live API
  feeds are the target). A pulsing REPLAY FEED badge flips to FULL TIME at the last
  event. Manual event entry was removed — participants cannot author facts.
- **Status chip system**: DRAFT, OPEN, LOCKED, AWAITING EVIDENCE (pulsing), RESOLVING,
  RESOLVED, NO CONSENSUS, CANCELLED (struck through).
- **Category tags**: Objective / Interpretive.
- **Oracle cards** with three states (idle → analyzing with shimmer → revealed with verdict
  stamp, confidence bar, and reasoning text).
- **No-consensus fallback** on the "Was the red card deserved?" market — a genuine
  split-committee state, with a working **Run fallback** (tiebreaker LLM) trigger on the
  market detail screen.
- **Create room / join / create market** modals — real flows backed by the engine (one
  engine instance per room; join resolves locally known invite keys).
- **Production posture**: the pre-seeded demo room, scripted "Emit next event", manual
  event entry, screen nav pill, and oracle reset were removed — rooms exist only when
  created or joined, and evidence arrives from the match feed. The old demo seed
  survives only as an engine test fixture.

### 3.3 What is design-spec only (not yet built)

Still absent from the code:

- Evidence bundle detail, oracle committee detail, and consensus result detail screens.
- Mobile layout (390px adaptation).
- On-chain settlement transfers (the WDK wallet identity is integrated — Sepolia address,
  locally held seed — but payouts still settle on the engine's test-USDt ledger).
- Autobase/Hypercore-backed op log (the current P2P cut relays ops over Hyperswarm with
  JSONL persistence in the sidecar).

### 3.4 Known divergences from the design spec

- **Theme**: the spec calls for a dark "floodlit pitch at night" palette (`#0C120F`
  background); the implementation uses a **light** palette (`#F5F7F2` background, dark green
  accents). Structure and color roles (green = YES/resolved, red = NO, amber = pending,
  teal = money) are preserved.
- **Fonts**: spec says Barlow Condensed / Archivo / IBM Plex Mono; code uses Barlow
  Condensed / Inter (with Archivo in a few places) / JetBrains Mono.
- The extensive shadcn/Radix component library under `components/ui/` is installed but
  App.tsx builds its UI from raw styled elements instead.

## 4. Domain model (as expressed by the UI)

- **Room** — a private watch party for one match. Has a name ("Ukraine vs Spain Watch
  Party"), an invite key (`room_7KQ9`), participants, a live minute, and a P2P sync status.
- **Participant** — a peer in the room (Oleksandr, Marco, Ivan) with a test-USDt balance.
- **Market** — a YES/NO question about the match. Attributes: question, **category**
  (Objective | Interpretive — Social is removed from scope), **status** (8-state
  lifecycle), YES/NO stake totals. Markets inherit the **room resolution policy** (oracle
  committee with an LLM per oracle, threshold, fallback) set once by the room creator.
- **Evidence timeline** — the room-level, minute-ordered stream of match events (goals,
  penalties, VAR decisions, full time).
- **Evidence bundle** — the per-market packet the oracles judge: versioned, hashed, and
  **locked before voting**. Items carry weights: PRIMARY (feed event), SECONDARY (manual
  note by room creator), CONTEXT (rulebook excerpt).
- **Oracle** — an interchangeable AI committee member; the room creator picks how many
  (1–5) and which model. Each reviews the locked bundle in an independent inference run
  and returns a verdict — **YES | NO | INSUFFICIENT_EVIDENCE** — plus a confidence score
  (explicitly secondary to the verdict; confidence never overrides the threshold) and a
  one-sentence reason.
- **Consensus** — threshold rule (2-of-3). Met → market resolves; not met → **no
  consensus** → fallback per room policy: objective **facts** re-check or a dedicated
  **tiebreaker LLM**; if that is also inconclusive, the market cancels and stakes return.
- **Settlement** — pot distribution to the winning side in test USDt, followed by a QVAC
  explanation and an **audit log** (market, evidence hash, oracle vote hash, threshold,
  outcome, settlement mode, timestamp).

## 5. Market lifecycle

```
DRAFT ──► OPEN ──► LOCKED ──► AWAITING EVIDENCE ──► RESOLVING ──┬──► RESOLVED ──► settled
                                                                └──► NO CONSENSUS ──► fallback (facts | tiebreaker LLM) ──► RESOLVED | CANCELLED
   (any pre-resolution state) ──────────────────────────────────────► CANCELLED
```

Resolution routes by category:

| Category | Resolution | Example |
|---|---|---|
| Objective | Feed-event match (facts only) | "Did Spain score before 80'?" |
| Interpretive | Oracle committee reasoning, 2-of-3 threshold | "Was the penalty decision correct?" |

(The former Social category — room-vote-only markets — is removed from scope for now.)

## 6. Product principles baked into the design

1. **Transparency over authority** — evidence is hashed and locked before any oracle sees
   it; no oracle can be re-run against different evidence after a verdict; every hash is
   surfaced in the audit log.
2. **A split committee never forces an outcome** — when oracles disagree below threshold,
   a dedicated tiebreaker LLM judges the same locked evidence; if that is also
   inconclusive, the market cancels and stakes are returned. Only LLMs make decisions —
   there is no automatic facts-resolution path.
3. **Explainability** — every resolution ships with a plain-language QVAC explanation of
   what was decided, on what key evidence, and why any oracle dissented.
4. **Not gambling** — demo/test stakes only, mandated vocabulary ("stake", "market",
   "resolve", "evidence", "oracle", "threshold", "consensus"), banned vocabulary ("bet",
   "odds", "casino", …), and a persistent DEMO badge.
5. **Local & serverless** — oracles run on-device via QVAC; rooms sync peer-to-peer via
   Pears; no data leaves the machine.

## 7. Running the prototype

```bash
cd frontend
npx pnpm@11 install   # pnpm workspace — avoid plain `npm i`
npx pnpm@11 dev       # Vite dev server → http://localhost:5173

# Real local AI (optional but recommended — the app falls back to mocks without it):
cd sidecar
npm install           # npm on purpose: pnpm breaks QVAC's platform binaries (qvac#1492)
npm start             # QVAC bridge on 127.0.0.1:8791; first run downloads Llama 3.2 1B (~770 MB)
```

> Windows note: QVAC's native binaries are unsigned; Windows 11 **Smart App Control**
> blocks them and must be off on the machine running the sidecar.

## 8. See also

- [use-case-scenarios.md](use-case-scenarios.md) — detailed actor-based use case scenarios,
  including the end-to-end demo "golden path".
- [backend-design.md](backend-design.md) — backend architecture: room engine, replicated
  op log, oracle pipeline, consensus/fallback, settlement, and the phased build plan.
- [test-plan.md](test-plan.md) — automated checks, service checks, UI scenarios
  (single-machine and multi-peer), failure paths, and known limitations.
