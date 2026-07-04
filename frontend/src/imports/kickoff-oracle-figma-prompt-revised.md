# Kickoff Oracle — Revised Figma AI Prompt

Use this version in **Figma Make** / **Figma First Draft**. It is optimized for a stronger first generation: fewer primary frames, clearer layout constraints, and stronger emphasis on the core demo mechanism.

Core mechanism the design must communicate in 10 seconds:

> Evidence comes in → three oracles vote → threshold consensus resolves the market.

---

## First-pass prompt

Paste this block first. It asks Figma to generate the most important polished frames instead of trying to produce the entire app at once.

```text
Design a dark-themed desktop web app at 1440px called "Kickoff Oracle".

Kickoff Oracle is a private football prediction room where live/replay match evidence is reviewed by a committee of local AI oracles. A market resolves only when a threshold is reached, for example 2 of 3 oracles agreeing.

This is a watch-party and oracle-consensus tool with demo/test stakes, NOT a sportsbook. Do not use odds tickers, casino styling, betting language, real club crests, real player likenesses, or anything that looks like a gambling product. Tone: part live-match broadcast graphics, part evidence audit tool. Every screen must feel transparent, verifiable, and evidence-driven.

The user should understand the product in 10 seconds:
1. Live/replay feed provides evidence.
2. Three AI oracles review the evidence.
3. A 2-of-3 threshold resolves the market.
4. Settlement uses demo/test USDt only.

PRIORITY FOR FIRST GENERATION
Generate 4 polished desktop frames only:
1. Landing
2. Room home
3. Market detail hero screen
4. Settlement + QVAC explanation + audit log

Use the other screens and states as components or sections inside these frames, not as 11 separate full pages. The Market detail hero screen is the most important frame and should be the most polished.

ART DIRECTION
Palette: "floodlit pitch at night".
- Background: #0C120F, green-tinted near-black.
- Panels/cards: #111A15.
- Text: chalk white #EDEFE9.
- Secondary text: #8A948C.
- Hairline dividers: chalk white at 12% opacity, like pitch markings.
- YES / resolved: turf green #2F9E63.
- NO verdict: red-card red #D24141.
- Cancelled: muted gray with subtle red outline, not the same as a NO verdict.
- INSUFFICIENT_EVIDENCE / pending / locked: yellow-card amber #E4B63C.
- USDt teal #009393 is reserved exclusively for wallet and settlement elements.

Typography:
- Display and big numbers: Barlow Condensed SemiBold. Use it for match minutes like 67', thresholds like 2 OF 3, verdicts, and scoreboard-style numbers.
- Body/UI: Archivo. Use sentence case and plain verbs.
- Mono: IBM Plex Mono. Use it for hashes, JSON fragments, invite keys, and audit entries.

LAYOUT SYSTEM
Use a 12-column desktop grid with 80px outer margins and 24px gutters.
For room and market screens, use a 70/30 split:
- main product content on the left;
- evidence timeline on the right.
Keep card padding generous. Avoid dense crypto-dashboard clutter. The demo path should read left-to-right and top-to-bottom.

SIGNATURE ELEMENT
Create a vertical minute-marked Evidence timeline on the right rail of the room and market screens.
It should look like a chalk pitch marking with tick marks:
- 12' — Goal — Spain
- 67' — Penalty — Ukraine · VAR confirmed
- 90' — Full time

At the top of the timeline, add a button labeled "Emit next event". This is the demo control. Feed events attach to the timeline as cards.

GLOBAL TOP BAR
Use this top bar on app screens:
- Room name: "Ukraine vs Spain Watch Party"
- Live minute chip: "67'"
- Overlapping peer avatars: Oleksandr, Marco, Ivan
- Small indicator: "P2P · synced"
- Persistent amber badge: "DEMO / TEST USDt"
- Wallet chip in USDt teal: "Balance: 120 test USDt"

FRAME 1 — LANDING
Hero headline: "Kickoff Oracle".
Subhead: "Serverless football prediction rooms resolved by LLM oracle consensus."
Three value lines:
- "Live feeds provide evidence"
- "LLM oracles interpret"
- "Markets resolve by threshold consensus"
Primary button: "Create a room".
Secondary button: "Join with invite key".
Add a small visual preview showing the three-step mechanism: Evidence → Oracles → Consensus.

FRAME 2 — ROOM HOME
Left side: market cards grid.
Each market card includes:
- question;
- category tag: Objective / Interpretive / Social;
- status chip;
- YES/NO stake totals;
- oracle policy summary: "2-of-3 LLM consensus";
- demo/test label if money-like values appear.

Primary market card:
Question: "Was the penalty decision correct?"
Category: Interpretive.
Status: Awaiting evidence or Resolving.
YES stake: 15 test USDt.
NO stake: 15 test USDt.
Policy: "2-of-3 LLM consensus".

Secondary market card:
Question: "Was the red card deserved?"
Category: Interpretive.
Status: No consensus.
Policy: "Fallback: Room vote".

Right side: the vertical Evidence timeline with the 12', 67', and 90' events.
Header row: participants and a copyable invite key in mono, e.g. "room_7KQ9".

FRAME 3 — MARKET DETAIL HERO SCREEN
This is the most important demo frame. It must show the full product logic at once.

Top section:
- Big question headline: "Was the penalty decision correct?"
- Status chip: "Resolved"
- Category tag: "Interpretive"
- Resolution policy chip: "2-of-3 LLM consensus"

Stake panel:
- YES side: Oleksandr 5 test USDt, Marco 10 test USDt.
- NO side: Ivan 15 test USDt.
- Total pot: 30 test USDt.
- Use USDt teal only in this money/settlement area.

Main content below: three clear columns or stacked panels:

A. Evidence bundle panel
Header: "Status: READY · v1 · hash: hash_evidence_penalty_001" in mono.
Three evidence cards with weight tags:
- PRIMARY: Replay feed — "67' — Penalty awarded to Ukraine · VAR: Confirmed"
- SECONDARY: Manual note, labeled "added by Room creator" — "Defender made leg contact with attacker inside the box before touching the ball."
- CONTEXT: Rulebook excerpt — "A direct free kick is awarded if a player trips or attempts to trip an opponent…"
Add a lock icon and caption: "Evidence locked before voting".

B. Oracle committee panel
Three oracle cards with distinct identities:
- Rules Oracle, gavel icon, verdict YES, confidence indicator 86%, reason: "The rule excerpt supports a penalty when a defender trips an opponent."
- Evidence Oracle, magnifier icon, verdict YES, confidence indicator 82%, reason: "The feed confirms a penalty and VAR confirmation."
- Skeptic Oracle, shield-question icon, verdict NO, confidence indicator 58%, reason: "The evidence does not include video, so the contact may not be enough to prove the penalty was correct."

The confidence indicator must be visually secondary to the verdict. It should not imply that confidence overrides the 2-of-3 threshold.
Caption under panel: "Runs locally via QVAC".

C. Consensus result panel
Big threshold meter: three slots, two filled green, one red.
Label: "2 OF 3 REACHED".
Resolution banner in turf green: "Market resolved: YES".
Secondary line: "YES votes: 2 · NO votes: 1 · Insufficient: 0".

Status chip component set must include:
- DRAFT: gray outline
- OPEN: green outline
- LOCKED: amber
- AWAITING EVIDENCE: amber with pulsing dot
- RESOLVING: white shimmer
- RESOLVED: green filled
- NO CONSENSUS: amber/red split
- CANCELLED: muted gray, struck through

FRAME 4 — SETTLEMENT + QVAC EXPLANATION + AUDIT LOG
Design this as the final demo result screen.

Top: Settlement panel with teal accents.
- Label: "Mode: Test USDt"
- Total pot: 30 test USDt
- Winning side: YES
- Payout rows:
  - "Oleksandr receives 10 test USDt"
  - "Marco receives 20 test USDt"
- Primary button state: "Settlement confirmed" with check.

Middle: QVAC explanation card.
Quote-style card:
"The market resolved YES after 2 of 3 oracles agreed that the penalty decision was justified. The key evidence was defender contact inside the box before the ball. The skeptical oracle disagreed because no video evidence was provided."
Caption: "Generated locally by QVAC".

Bottom: Audit log.
Receipt-style mono list:
- Market: Was the penalty decision correct?
- Evidence hash: hash_evidence_penalty_001
- Oracle vote hash: hash_votes_penalty_001
- Threshold: 2_of_3
- Final outcome: YES
- Settlement mode: TEST_USDT
- Timestamp: 67' event / resolved at 67:42
Make this feel verifiable, like a terminal receipt or match official record.

NO-CONSENSUS COMPONENT VARIANT
Include a compact variant somewhere in the design system or as a secondary card:
Market: "Was the red card deserved?"
Votes: YES / INSUFFICIENT_EVIDENCE / NO.
Banner: "No consensus — fallback: Room vote".
Add simple room-vote UI: YES / NO buttons with participant tallies.
This should prove the system does not force AI resolution when evidence is weak.

COPY RULES
Use sentence case everywhere.
Use these words: "stake", "market", "resolve", "evidence", "oracle", "threshold", "consensus".
Never use: "bet", "odds", "gambling", "casino", "bookmaker", "payout guaranteed".
Demo/test labeling must be visible on every screen with money-like values.
Do not make the UI look like a trading exchange or sportsbook.
```

---

## Full-screen expansion prompt

Use this after the first generation if you want Figma to expand the prototype into more screens.

```text
Expand the Kickoff Oracle design into a fuller prototype using the same visual system.

Add these additional desktop frames:
1. Create market modal
2. Evidence bundle detail
3. Oracle committee detail
4. Consensus result detail
5. No-consensus fallback flow

Keep the same 12-column grid, dark floodlit-pitch palette, right-side evidence timeline, and demo/test USDt labeling.

CREATE MARKET MODAL
Question field prefilled: "Was the penalty decision correct?"
Category segmented control: Objective / Interpretive / Social, with Interpretive selected.
Resolution policy section:
- Oracle committee checklist: Rules Oracle, Evidence Oracle, Skeptic Oracle.
- Threshold stepper: "2 of 3".
- Fallback select: "Room vote".
Primary button: "Create market".

EVIDENCE BUNDLE DETAIL
Show the evidence packet as a clean audit object, not a developer-only JSON dump.
Include:
- Status: READY
- Version: v1
- Evidence hash
- Primary feed event
- Manual note
- Rulebook excerpt
- Lock state: "Evidence locked before voting"

ORACLE COMMITTEE DETAIL
Show three oracle states:
- Idle
- Analyzing evidence…
- Revealed verdict
Use shimmer while analyzing. Verdicts should stamp in like referee cards.

CONSENSUS RESULT DETAIL
Show threshold meter, final outcome, vote breakdown, timestamp, and a short explanation.

NO-CONSENSUS FALLBACK FLOW
Market: "Was the red card deserved?"
Votes:
- Rules Oracle: YES
- Evidence Oracle: INSUFFICIENT_EVIDENCE
- Skeptic Oracle: NO
Result: "No consensus — fallback: Room vote".
Show room vote buttons and participant tallies.
```

---

## Animation prompt

```text
Animate the oracle reveal in the prototype.

The three oracle cards should resolve sequentially with a 0.4s stagger:
1. Shimmer state says "Analyzing evidence…"
2. Shimmer stops.
3. Verdict stamp appears like a referee card being shown.
4. Confidence indicator fills.
5. Reason text fades in.

After the third oracle reveals, animate the consensus meter:
- first green slot fills;
- second green slot fills;
- red slot fills;
- label changes to "2 OF 3 REACHED";
- resolution banner slides in: "Market resolved: YES".
```

---

## Interactive evidence timeline prompt

```text
Make the evidence timeline interactive in the prototype.

Clicking "Emit next event" should:
1. Add the 67' penalty card to the vertical evidence timeline with a slide-in animation.
2. Flip the market status chip from "Awaiting evidence" to "Resolving".
3. Populate the Evidence bundle panel with the primary feed event.
4. Enable the "Run oracles" action.

Use the same right-rail chalk timeline style and keep the event card compact but readable.
```

---

## Empty states prompt

```text
Add empty states using the same visual system.

Room with no markets:
"No markets yet — create the first one for this match."
Primary button: "Create market".

Market waiting for evidence:
"Waiting for the penalty event and an incident description."
Status chip: "Awaiting evidence" with amber pulsing dot.
Include a disabled oracle panel that says: "Oracles run only after evidence is ready."
```

---

## Mobile prompt

```text
Create a mobile version at 390px width for the Room Home and Market Detail screens.

Adapt the layout:
- Top bar becomes compact.
- Evidence timeline becomes a horizontal minute strip under the top bar.
- Market cards stack vertically.
- Evidence, Oracle, Consensus, Settlement, and QVAC Explanation become collapsible sections.
- Keep demo/test USDt labeling visible wherever money-like values appear.
- Keep the design dark, evidence-driven, and non-sportsbook.
```

---

## Demo video frames prompt

```text
Design a 16:9 title frame and closing frame for the demo video using the same Kickoff Oracle system.

Title frame:
"Kickoff Oracle"
Subtitle:
"Football markets resolved by evidence, consensus, and explainability"
Stack line:
"Pears + QVAC + WDK"

Closing frame:
"Live feeds provide evidence. Local oracles interpret. Markets resolve by threshold consensus."
Add the stack line again: "Pears + QVAC + WDK".
Keep the style dark, floodlit, and audit-like.
```

---

## Checks against the demo checklist

This revised prompt covers the demo checklist while reducing first-generation overload:

- Resolution policy visible.
- Emit-event control visible.
- Evidence bundle visible.
- Three oracle votes visible.
- 2-of-3 resolution visible.
- Settlement payouts visible.
- QVAC explanation visible.
- Audit log visible.
- No real-money sports-betting language.
- Demo/test USDt labeling visible.

The first-pass prompt intentionally focuses on 4 polished frames. Use the expansion prompts only after the first generated design has a strong visual direction.
