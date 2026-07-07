# Kickoff Oracle — Use Case Scenarios

> Companion to [platform-analysis.md](platform-analysis.md) and
> [backend-design.md](backend-design.md). Each use case lists actors,
> preconditions, main flow, alternative/exception flows, postconditions, and its
> **implementation status** in the current prototype:
>
> - **Real** — fully functional with real logic/integrations (no mocks on the path).
> - **Simulated** — works interactively in the prototype with mocked data/logic.
> - **UI-only** — visually present but not functional.
> - **Spec-only** — described in the design spec, not yet in code.

## Actors

| Actor | Kind | Description |
|---|---|---|
| **Room creator (host)** | Human | Creates the room, sets its resolution policy (oracle committee, LLM per oracle, threshold, fallback), invites peers, creates markets, curates evidence (manual notes, rulebook excerpts) |
| **Participant** | Human | Logs in with a Tether wallet, joins via invite key, stakes test USDt |
| **Oracles (committee)** | AI (QVAC, local) | 1–5 interchangeable judges — count, model, and threshold chosen by the room creator; each reviews the locked evidence in an independent inference run |
| **Tiebreaker Oracle** | AI (QVAC, local) | Fallback judge invoked when the committee splits (UC-09) |
| **Evidence feed** | System | Match event source (goals, penalties, VAR, full time). Currently a hardcoded single-match replay played by the creator's client; live API feeds are the target |
| **Consensus engine** | System | Applies the threshold policy (e.g. 2-of-3) to oracle verdicts |
| **Settlement engine (WDK)** | System | Holds test-USDt balances, escrows stakes, distributes payouts |
| **P2P layer (Pears)** | System | Syncs room state across peers without a server |

---

## UC-01 — Create a watch-party room

**Primary actor:** Room creator · **Status: Simulated** (the create-room modal configures name, match, and the full room policy — committee LLMs, threshold, fallback — and creates a real, empty room via the engine; single peer, P2P topic pending)

**Goal:** Start a private, serverless room for one match and get an invite key to share.

**Preconditions:** App is running; user is logged in with a Tether wallet (UC-16); user is
on the Landing screen.

**Main flow:**
1. User clicks **"Create a room"** (nav bar, hero, or CTA footer).
2. System creates a room bound to a match context (e.g. "Ukraine vs Spain Watch Party").
3. User configures the **room resolution policy** that governs every market created in
   the room:
   - sets the **committee size** (1–5 oracles) and the local LLM model they run on;
   - sets the **threshold** with a stepper (e.g. "2 of 3");
   - selects the **no-consensus tiebreaker model** (an extra LLM, see UC-09).
4. System generates a short invite key (e.g. `room_7KQ9`) and a P2P topic for the room.
5. System credits the creator with a demo balance (120 test USDt) and shows the Room home
   screen with an empty market grid and the evidence timeline.

**Alternative flows:**
- 5a. *No markets yet* — room shows the empty state "No markets yet — create the first one
  for this match" with a **Create market** button (implemented).

**Postconditions:** Room exists and is joinable by key; creator is its first participant;
the room resolution policy is fixed and visible to all peers.

**Related implemented detail (UI-only):** Room home displays a "Room resolution policy"
strip — threshold, committee members with their LLMs, fallback — captioned "Set by room
creator"; every market card shows the inherited policy.

---

## UC-02 — Join a room with an invite key

**Primary actor:** Participant · **Status: Real** (unknown keys search the Hyperswarm
topic derived from the key and sync the room's op log from its peers — cross-device join
works when both sides run the sidecar; the joining guest announces itself via PEER_JOIN
and appears in every peer's avatar stack. Without a sidecar, a BroadcastChannel fallback
still syncs tabs on the same machine; keys with no reachable peers show the not-found
state)

**Goal:** Enter a friend's room and participate in its markets.

**Preconditions:** A room exists; the participant is logged in with a Tether wallet
(UC-16) and has received the invite key out-of-band.

**Main flow:**
1. User clicks **"Join with invite key"** on the Landing screen.
2. User enters the key (e.g. `room_7KQ9`).
3. P2P layer locates the room swarm and syncs current room state (markets, stakes,
   timeline, statuses).
4. User appears in the room's peer avatar stack; the top bar shows "P2P · synced".
5. User is credited a demo test-USDt balance and lands on Room home.

**Exception flows:**
- 3a. *Key not found / no peers online* — the join modal shows "Room not found — no peers
  are online for this key." (implemented).

**Postconditions:** Participant is a live peer; all subsequent room mutations replicate to
them.

**Related implemented detail (Simulated):** the invite key is displayed on Room home with a
one-click **copy** control that flashes a check icon for ~1.8 s.

---

## UC-03 — Create a prediction market

**Primary actor:** Room creator · **Status: Simulated** (the create-market modal — question, Objective/Interpretive category, room policy shown read-only — creates the market through the engine; it appears OPEN in the grid)

**Goal:** Pose a YES/NO question about the match and define how it will be resolved.

**Preconditions:** User is in a room.

**Main flow (per the create-market modal spec):**
1. User clicks **"Create market"** on Room home.
2. User enters the question (e.g. "Was the penalty decision correct?").
3. User picks a **category** via segmented control: Objective / Interpretive.
4. The modal shows the **room resolution policy** (committee members, their LLMs,
   threshold, fallback) read-only — it was set by the room creator at room creation
   (UC-01) and cannot be changed per market.
5. User clicks **Create market**. The market appears in the room grid in **DRAFT/OPEN**
   status and replicates to all peers.

**Business rules:**
- Categories (Objective / Interpretive) are descriptive tags; every market resolves
  through the oracle committee (see UC-14). The Social category is removed from scope.
- The room policy is permanently displayed on the market card ("2-of-3 LLM consensus",
  "Fallback: Tiebreaker LLM") so the resolution rule is visible **before** anyone stakes.

**Postconditions:** Market is open for staking; it resolves under the room's immutable,
visible policy.

---

## UC-04 — Stake test USDt on a market

**Primary actors:** Participant, Settlement engine · **Status: Real** (side + amount controls on OPEN markets; the engine validates balance, escrows the stake, and replicates it to every peer. With a funded WDK wallet, each stake also executes as a real Sepolia transfer from the staker to the host's escrow wallet — the tx hash attaches to the stake and shows as an Etherscan link)

**Goal:** Back YES or NO on an open market with demo funds.

**Preconditions:** Market status is OPEN; participant balance ≥ stake.

**Main flow:**
1. Participant opens a market and chooses a side (YES or NO) and an amount.
2. Settlement engine escrows the amount from the participant's test-USDt balance.
3. Market card and stake panel update the per-side totals and total pot for all peers
   (e.g. YES: Oleksandr 5 + Marco 10; NO: Ivan 15; pot 30 test USDt).

**Exception flows:**
- 2a. *Insufficient balance* — stake is rejected.
- 1a. *Market already LOCKED / past staking window* — staking controls are disabled.

**Business rules:**
- All money-like values are labeled "test USDt"; the amber **TESTNET USDt** badge is
  always visible in the top bar.
- USDt-teal styling is reserved exclusively for wallet/settlement elements.

**Postconditions:** Stakes are escrowed; pot reflects both sides.

---

## UC-05 — Receive match evidence from the feed

**Primary actors:** Evidence feed (replay of a bound fixture) · **Status: Real** (a hardcoded single match plays back automatically on an accelerated clock — a full match in ~6 minutes; the room creator's client drives the feed and events replicate to every peer. Manual event entry was deliberately removed: facts come from the feed, not from a participant's keyboard)

**Goal:** Put match events onto the room's shared evidence timeline so markets can
gather evidence, without any participant being able to author facts.

**Preconditions:** Room was created (rooms bind to the one available fixture,
"Ukraine vs Spain (replay feed)"); the creator's client is online.

**Main flow:**
1. On room creation, the creator's client starts replaying the fixture
   (`frontend/src/engine/feed.ts`): goals, cards, a VAR-confirmed penalty, full time.
2. Each event lands minute-sorted on every peer's timeline with a pulsing **REPLAY
   FEED** badge; the global live-minute chip advances; at the last event the badge
   flips to **FULL TIME**.
3. Feed events carry fixed ids, so replays deduplicate across peers, and a creator
   reload resumes the remaining events instead of duplicating history.
4. Any feed event can be pulled into a market's evidence bundle as PRIMARY evidence
   (UC-06).

**Alternative flows (target product):**
- 1a. A licensed live sports-data API replaces the hardcoded fixture (same feed seam).
- 1b. Multiple fixtures to choose from at room creation.

**Postconditions:** Events are part of room history, visible to all peers, and available
as market evidence.

---

## UC-06 — Lock the match feed as evidence

**Primary actors:** Room creator, System · **Status: Real** (the jury judges the **whole match feed**. The creator clicks "Lock the match feed & start jury"; the engine snapshots every feed event so far, canonical-JSON-hashes it, and freezes it — one click, no selection. Re-locking is rejected by the reducer. Evidence is feed-only by design: participants cannot author facts, and the jury sees the entire feed, not a curated subset. The hash binds every juror's verdict to exactly this evidence.)

**Goal:** Fix the exact evidence the oracles will judge, so the verdict is verifiable and
cannot be gamed by re-rolling evidence.

**Preconditions:** Market exists; relevant evidence is available.

**Main flow:**
1. The primary feed event is attached as **PRIMARY** evidence (e.g. "67' — Penalty awarded
   to Ukraine · VAR: Confirmed").
2. The room creator optionally adds a **SECONDARY** manual note, labeled with its author
   (e.g. "Defender made leg contact with attacker inside the box before touching the ball."
   — added by Room creator).
3. A **CONTEXT** item is attached (e.g. rulebook excerpt: "A direct free kick is awarded if
   a player trips or attempts to trip an opponent…").
4. System versions the bundle (v1) and computes its SHA-256 hash over canonical JSON.
5. System **locks** the bundle — UI shows a lock icon and the caption "Evidence locked
   before voting".

**Business rules (transparency guarantees):**
- The bundle is hashed and locked **before any oracle sees it**.
- No oracle can be retried with different evidence after a verdict is issued.
- The evidence hash appears in the final audit log (UC-12) so peers can verify what was
  judged.

**Postconditions:** An immutable, hash-identified evidence packet exists; oracle run is
permitted.

---

## UC-07 — The distributed jury judges the evidence

**Primary actors:** Every participant's device (juror), QVAC · **Status: Real** (the resolution flow is a **distributed jury** — the only mode: when the evidence bundle locks, *each* participant's own device runs the juror model over the locked evidence and signs one verdict bound to the evidence hash. The market resolves once **quorum** jurors agree on a side; the room creator tallies the replicated signed verdicts and publishes the resolution, which any peer can verify. No committee runs on a single node. If the jury never reaches quorum, a tiebreaker LLM decides — or the market cancels with refunds. Verdicts come from a local LLM via the QVAC sidecar; scripted mock fallback without it. The committee-on-one-node path remains in the engine as internal legacy but is not user-reachable.)

> Set the quorum, juror model, and tiebreaker model at room creation (UC-01). Each
> device auto-casts its verdict on a locked market; the market screen shows every juror
> voting live and a quorum meter. Verified by `pnpm jury:test` (three peers, one dropping
> off mid-tournament, quorum still reached).

**Goal:** Have three independent local AI oracles review the locked evidence and issue
verdicts.

**Preconditions:** Evidence bundle is READY and locked; evidence event has been emitted
(the "Run oracles" button is disabled otherwise); oracles have not already run.

**Main flow (as implemented):**
1. User clicks **"Run oracles"** in the Oracle committee panel.
2. Oracles enter the **analyzing** state sequentially (~0.9 s stagger), each showing a
   shimmer and "Analyzing evidence…".
3. Verdicts **reveal** sequentially, stamped in like referee cards (example run):
   - **Oracle 1** → YES — "The recorded contact in the box plus the VAR confirmation
     support the decision."
   - **Oracle 2** → YES — "The feed confirms a penalty was awarded and VAR upheld it."
   - **Oracle 3** → NO — "Without video, the severity of the contact cannot be verified."
4. Each reveal shows the verdict, a confidence bar (visually secondary), and the reason.
5. The button state changes to "Oracles revealed"; a reset control appears (demo utility,
   UC-15).

**Business rules:**
- Each oracle reviews the bundle **independently**; possible verdicts are
  **YES | NO | INSUFFICIENT_EVIDENCE**.
- Confidence is informational only — it never overrides the threshold count.
- Oracles run **locally via QVAC**; no data leaves the machine.
- Each oracle runs on the local LLM model the room creator selected at room setup (UC-01).

**Postconditions:** Three verdicts with reasons are recorded; consensus evaluation (UC-08)
proceeds.

---

## UC-08 — Resolve a market by threshold consensus

**Primary actor:** Consensus engine · **Status: Simulated** (real threshold tally over recorded verdicts; the 2-YES/1-NO outcome comes from the mock oracle scripts, not hard-wiring)

**Goal:** Convert oracle verdicts into a market resolution, but only when the pre-agreed
threshold is met.

**Preconditions:** All committee verdicts are in; the room policy defines the threshold
(2-of-3).

**Main flow (as implemented):**
1. The threshold meter fills slot by slot: two green **YES** slots, one red **NO** slot.
2. The label **"2 OF 3 REACHED"** appears.
3. The resolution banner shows **"Market resolved: YES"** with the breakdown
   "YES votes: 2 · NO votes: 1 · Insufficient: 0".
4. The market status chip becomes **RESOLVED** (green, filled).
5. A **"View settlement"** action appears, leading to UC-10.

**Alternative flow:**
- 1a. *Threshold not met* — no verdict reaches 2 votes (e.g. YES / INSUFFICIENT_EVIDENCE /
  NO). Market enters **NO CONSENSUS** and the fallback policy triggers → UC-09.

**Postconditions:** Outcome is final and replicated to all peers; settlement is unlocked.

---
## UC-09 — No-consensus fallback: tiebreaker LLM

**Primary actors:** Consensus engine, Tiebreaker Oracle · **Status: Real** (a market whose committee splits enters NO_CONSENSUS; **Run fallback** on the market detail screen executes the tiebreaker — a real local LLM when the QVAC sidecar runs — and resolves, or cancels with refunds on INSUFFICIENT_EVIDENCE)

**Goal:** Ensure a split committee never forces a resolution on weak evidence — the market
falls back to hard facts or a dedicated tiebreaker LLM, per the room policy.

**Preconditions:** Oracle committee split without reaching threshold (e.g. verdicts
YES / INSUFFICIENT_EVIDENCE / NO). The room policy (UC-01) names the tiebreaker model.

**Main flow:**
1. System displays the banner **"No consensus — fallback: Tiebreaker LLM"** on the market.
2. The tiebreaker oracle (an LLM chosen by the room creator at room setup, may differ
   from the committee models) judges the same locked evidence bundle; its verdict
   resolves the market. Only LLMs make decisions — there is no automatic facts-based
   resolution path.
3. The market proceeds to settlement (UC-10); the audit log records the fallback path.

**Exception flows:**
- 2a. *The tiebreaker returns INSUFFICIENT_EVIDENCE* — the market is **CANCELLED**
  (UC-13) and stakes are returned.

**Postconditions:** Market resolves via the configured fallback, or is cancelled; the audit
log records the fallback path.

---

## UC-10 — Settle the market and distribute payouts

**Primary actor:** Settlement engine (WDK) · **Status: Real** (pro-rata payouts computed by the engine in bigint minor units and — when the resolving peer's WDK wallet is funded — executed as real Sepolia transactions, with per-winner Etherscan links on the settlement screen and tx rows in the audit log; unfunded wallets settle on the ledger only)

**Goal:** Pay the pot to the winning side proportionally to stakes, in test USDt.

**Preconditions:** Market is RESOLVED (via consensus or fallback); pot is escrowed.

**Main flow (demo values):**
1. Settlement panel shows **Mode: Test USDt**, total pot **30 test USDt**, winning side
   **YES**.
2. Payouts distribute the pot to YES stakers pro-rata to their stakes:
   - Oleksandr (staked 5) receives **10 test USDt**;
   - Marco (staked 10) receives **20 test USDt**;
   - Ivan (staked 15 on NO) receives nothing.
3. The state shows **"Settlement confirmed"** with a check.
4. Participant wallet balances update (target behavior; static in the demo).

**Business rules:**
- Payout = stake × pot ÷ winning-side total (2× multiplier in the demo since sides were
  equal).
- Settlement UI is the only place (besides the wallet chip) using USDt teal.

**Postconditions:** Pot is fully distributed; market is closed.

---

## UC-11 — Read the QVAC resolution explanation

**Primary actors:** Participant, QVAC · **Status: Real** (generated by the local LLM via the QVAC sidecar from the actual resolution — outcome, votes, evidence, dissent; template fallback without the sidecar)

**Goal:** Understand *why* the market resolved the way it did, in plain language.

**Main flow:**
1. After settlement, the participant reads the quote-style explanation card:
   > "The market resolved YES after 2 of 3 oracles agreed that the penalty decision was
   > justified. The key evidence was defender contact inside the box before the ball. The
   > skeptical oracle disagreed because no video evidence was provided."
2. The caption confirms provenance: **"Generated locally by QVAC"**.

**Business rules:** The explanation must name the outcome, the threshold result, the key
evidence, and any dissent — making the AI decision auditable by non-technical users.

---

## UC-12 — Verify the audit log

**Primary actor:** Participant · **Status: Simulated** (rendered receipt with working copy-to-clipboard; hashes are real SHA-256 digests over canonical JSON)

**Goal:** Independently verify what was judged, by whom, under what rule, and when.

**Main flow:**
1. Participant opens the Settlement screen's **Audit log** — a receipt-style mono list:
   - Market: Was the penalty decision correct?
   - Evidence hash: real SHA-256 digest of the locked bundle
   - Oracle vote hash: real SHA-256 digest of the ordered verdicts
   - Threshold: `2_of_3`
   - Final outcome: `YES`
   - Resolved via: `CONSENSUS`
   - Settlement mode: `TEST_USDT`
   - Timestamp: `67' event / resolved at <wall-clock time>`
2. Participant hovers any row and clicks the copy icon to copy a value (check-icon
   feedback, ~1.5 s).
3. (Target) Participant recomputes/compares hashes against the locked evidence bundle and
   recorded votes to verify integrity.

**Postconditions:** A tamper-evident record of the full resolution chain is available to
every peer.

---

## UC-13 — Cancel a market

**Primary actor:** Room creator / System · **Status: UI-only** (CANCELLED chip exists and the engine implements cancellation with full stake refunds — including on failed fallbacks — but there is no UI flow to trigger it)

**Goal:** Void a market that becomes unresolvable (e.g. match abandoned, malformed
question, failed fallback resolution).

**Expected flow:** Market moves to **CANCELLED** (muted gray, struck-through chip — styled
distinctly from a NO verdict); escrowed stakes are returned to stakers; the audit log
records the cancellation.

---

## UC-14 — Market categories

**Status: Real** (categories are descriptive tags only — every market resolves through
the oracle committee; the automatic facts-based resolution path was removed by design:
only LLMs make decisions)

- **Objective market** — "Will Spain score a second goal before 80'?" — clear-cut from
  the feed evidence, so committee verdicts are expected to be near-unanimous.
- **Interpretive market** — "Was the penalty decision correct?" — requires weighing the
  evidence; splits and the tiebreaker (UC-09) are more likely.

> The former **Social** category ("Best player on the pitch so far?", room-vote-only) is
> removed from scope for now; its card has been removed from Room home.

---

## UC-15 — Demo/presentation utilities

**Status: Removed** (production posture)

The screen nav pill, the oracle reset control, the scripted "Emit next event" button,
manual event entry, and the pre-seeded demo room were removed when the app moved to its
production flow. Rooms exist only when created or joined; evidence arrives from the
match feed (UC-05); the old demo seed survives solely as an engine test fixture
(`frontend/src/engine/demo.ts`, used by `pnpm engine:test`).

---

## UC-16 — Log in with a Tether wallet

**Primary actors:** Participant, Settlement engine (WDK) · **Status: Real** ("Log in with wallet" opens a self-custodial onboarding modal: **create a new wallet** (the sidecar generates a BIP-39 seed via `@tetherto/wdk`, the UI shows the recovery phrase for the user to back up before continuing), **import an existing wallet** (paste a 12–24-word phrase — re-derives the same address deterministically), or **use this device's wallet**. The chosen wallet's Sepolia address becomes the identity every op is authored under, and stakes/payouts sign from it on-chain. Seed is held only on-device in `sidecar/.wallet.json`; without the sidecar the user plays as a local guest.)

**Goal:** Authenticate with a Tether wallet so identity, stakes, and payouts are bound to a
real wallet address instead of an ad-hoc demo profile.

**Preconditions:** App is running; user is on the Landing screen and not yet logged in.

**Main flow:**
1. User clicks **"Log in with wallet"** on the Landing screen.
2. WDK connects to (or derives) the user's Tether wallet and returns the wallet address.
3. The app derives the user's room identity (display name, avatar) from the wallet address.
4. The wallet chip in the top bar shows the wallet's test-USDt balance; all stakes (UC-04)
   and payouts (UC-10) settle against this wallet.

**Alternative flows:**
- 2a. *No wallet yet* — user creates a new wallet in-app via WDK, then continues at step 3.

**Exception flows:**
- 2b. *Connection rejected / fails* — user stays logged out; creating (UC-01) or joining
  (UC-02) rooms is disabled until login succeeds.

**Postconditions:** User is authenticated; the wallet address is the settlement identity
for every subsequent stake and payout.

---

## End-to-end walkthrough (production flow)

The full lifecycle, exactly as the app runs it today:

1. **Landing** — the user logs in with their wallet (a real WDK self-custodial address
   when the sidecar runs) *(UC-16)*, then clicks **Create a room**: names the watch
   party and sets the room resolution policy — oracle committee, LLM per oracle,
   threshold, and fallback *(UC-01)*.
2. **Invite** — the creator copies the `room_XXXX` invite key; friends join from their
   own machines over Hyperswarm and appear in the avatar stack *(UC-02)*.
3. **Markets & stakes** — anyone creates YES/NO markets under the room policy
   *(UC-03)*; participants stake test USDt while markets are **OPEN** *(UC-04)*.
4. **Match time** — events arrive automatically from the match feed as the fixture
   replays *(UC-05)*. The creator clicks **Close staking** on a market, then **Attach
   evidence & lock bundle**: feed events (PRIMARY), an optional note (SECONDARY), and a
   rulebook excerpt (CONTEXT), locked under a real SHA-256 hash *(UC-06)*.
5. **Resolution** — **Run oracles**: the committee judges the locked bundle in
   independent local inference runs *(UC-07)*. Threshold consensus resolves the market *(UC-08)*; a split
   committee falls back to facts or the tiebreaker LLM, or cancels with refunds
   *(UC-09, UC-13)*.
6. **Settlement** — pro-rata payouts in test USDt, the model-written plain-language
   explanation *(UC-10, UC-11)*.
7. **Audit log** — the receipt of hashes, threshold, outcome, and timestamp closes the
   loop: the whole resolution is verifiable on every peer *(UC-12)*.

---

## Traceability: demo checklist → use cases

| Demo checklist item (from the design spec) | Use case |
|---|---|
| Resolution policy visible | UC-01 (set per room), UC-03 (shown on market) |
| Emit-event control visible | UC-05 |
| Evidence bundle visible | UC-06 |
| Three oracle votes visible | UC-07 |
| 2-of-3 resolution visible | UC-08 |
| No-consensus fallback | UC-09 |
| Settlement payouts visible | UC-10 |
| QVAC explanation visible | UC-11 |
| Audit log visible | UC-12 |
| Testnet USDt labeling everywhere | UC-04, UC-10 (business rules) |
| No sportsbook language | Platform principle (see analysis §6) |