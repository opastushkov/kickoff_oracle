# Kickoff Oracle — Test Plan

> ⚠️ **PARTIALLY OUTDATED — written against the demo build.** The platform has since
> moved to its production flow: the pre-seeded demo room (`room_7KQ9`), the scripted
> "Emit next event" button, the nav pill, and the oracle reset **no longer exist**.
> Any step referencing them is superseded by the production flow: *create a room
> (bound to the replay fixture; feed events then arrive automatically) → create a
> market → stake → Close staking → "Attach evidence & lock bundle" → Run oracles →
> settlement*. The automated checks (§1), service checks (§2), and the general
> expectations remain valid. A full rewrite is pending.
>
> **Non-technical testers:** use the plain-language
> [Simple Test Guide](test-guide-simple.md) instead of this document.
>
> Companion to [platform-analysis.md](platform-analysis.md),
> [use-case-scenarios.md](use-case-scenarios.md), and [backend-design.md](backend-design.md).
> Covers automated checks, service checks, single-machine UI scenarios, multi-peer
> scenarios, and failure paths. Each test lists **steps** and **expected** results;
> the traceability matrix at the end maps tests to use cases.

## 0. Prerequisites

| Requirement | Why |
|---|---|
| Node.js ≥ 20 (tested on 24) | app tooling and sidecar |
| Internet access | one-time model download (~770 MB), Hyperswarm DHT, Sepolia RPC |
| Windows: **Smart App Control OFF** | QVAC/Bare native binaries are unsigned and get blocked otherwise |
| ~2 GB free RAM while the sidecar runs | Llama 3.2 1B inference |

Setup (two terminals):

```bash
# Terminal 1 — app
cd frontend
npx pnpm@11 install
npx pnpm@11 dev            # → http://localhost:5173

# Terminal 2 — sidecar (QVAC + P2P rooms + WDK wallet)
cd frontend/sidecar
npm install                # npm on purpose (pnpm breaks QVAC binaries, qvac#1492)
npm start                  # → http://127.0.0.1:8791
```

Sidecar startup lines to expect:
`[rooms] WebSocket room bridge attached`, `[sidecar] QVAC bridge on http://127.0.0.1:8791`,
`[sidecar] warming model…`, then `[sidecar] model ready` (first ever run: download
progress lines first).

### Resetting between test runs

Room history **persists** in the sidecar (`sidecar/.rooms/*.jsonl`). The demo room
therefore keeps its state across page reloads and sidecar restarts. To reset the demo
to its pristine state:

1. Stop the sidecar.
2. Delete `frontend/sidecar/.rooms/`.
3. Restart the sidecar, reload the app.

To reset your local identity: DevTools → Application → Local Storage → remove
`kickoff.identity` (a new Fan-XXXX / WDK identity is created on reload).

---

## 1. Automated checks

### T-A1 · Engine selftest (op log, consensus, fallback, settlement math)

```bash
cd frontend && npx pnpm@11 engine:test
```

**Expected:** 23 `ok — …` lines, ending `All engine selftests passed.` Covers: seeding,
evidence hash is real SHA-256, 2-of-3 consensus, pro-rata payouts (10/20 of a 30 pot),
balance mutation, audit hashes, bundle re-lock rejection, tiebreaker cancellation with
refunds, objective facts short-circuit, largest-remainder rounding.

### T-A2 · P2P replication over Hyperswarm

```bash
cd frontend/sidecar && node p2ptest.mjs
```

**Expected:** two sidecars spawn (ports 8794/8795), both log
`joined swarm topic …`, then `peer connected`, ending
`P2P TEST OK — op replicated 8794 → Hyperswarm → 8795`. Requires internet (DHT).
First-ever run can take up to ~2 min (DHT warm-up); reruns are fast.

### T-A3 · Production build

```bash
cd frontend && npx pnpm@11 build
```

**Expected:** `✓ built` with no errors.

---

## 2. Service checks (sidecar running)

### T-S1 · QVAC health
`curl http://127.0.0.1:8791/health` →
`{"ok":true,"engine":"qvac","loaded":true,"model":"Llama 3.2 1B"}`
(`loaded:false` right after start = model still warming; retry in ~15 s.)

### T-S2 · WDK wallet
`curl http://127.0.0.1:8791/wallet` →
`{"ok":true,"address":"0x…","network":"sepolia","balance":"0"}`.
The address is stable across restarts (seed in `sidecar/.wallet.json`). If you fund it
from a Sepolia faucet, `balance` becomes non-zero.

### T-S3 · Real inference
Watch the sidecar console while running T-10: each oracle logs
`[sidecar] completion <ms>ms, <n> chars` (typically 3–15 s per completion on CPU).

---

## 3. Single-machine UI scenarios

> Start state for T-01…T-15: fresh reset (see §0), sidecar running, app reloaded.

### T-01 · Identity & landing
1. Open http://localhost:5173.
2. Click **Log in with wallet** (top nav).

**Expected:** the button flips to a chip with your display name (`Fan-XXXX`), a
shortened wallet address, and a teal **WDK · Sepolia** badge (badge present only when
the sidecar is up; the address then matches T-S2's `0x…`).

### T-02 · Create-room modal (UC-01)
1. Click **Create a room**.
2. Inspect the modal.

**Expected:** room name + match fields; three oracle rows (Rules/Evidence/Skeptic),
each with a checkbox and model dropdown; threshold stepper showing `2 of 3`; fallback
segmented control (Facts / Tiebreaker LLM). Unchecking an oracle drops the stepper
maximum (e.g. `2 of 2`); unchecking all disables **Create room**.

3. Create the room.

**Expected:** an empty room — your name in the top bar, a fresh `room_XXXX` invite key,
a "Room resolution policy" strip matching what you configured, and the empty state
"No markets yet — create the first one for this match."

### T-03 · Create-market modal (UC-03)
1. In your new room, click **Create market**; enter a question, pick a category.

**Expected:** the modal shows the room policy read-only ("set by the room creator").
After creating: the market card appears with status **OPEN**, `0 / 0` stakes, and the
room policy string. *(Known limitation: markets in self-created rooms cannot receive
evidence yet — see §6.)*

### T-04 · Join the demo room (UC-02)
1. Landing → **Join with invite key** → enter `room_7KQ9`.

**Expected:** "Ukraine vs Spain Watch Party": **4 participants** (Oleksandr, Marco,
Ivan + you), avatar stack shows 4 initials including yours, top-bar balance
**120 test USDt** (yours — the fictional three have their own), three market cards
(penalty AWAITING EVIDENCE 15/15, red card NO CONSENSUS 8/12, second-goal OPEN 20/10),
policy strip `2-of-3 threshold · Rules (Llama 3.2 1B) / … · Fallback: Tiebreaker LLM`.

### T-05 · Wrong invite key (UC-02 exception)
1. **Join with invite key** → enter `room_ZZZZ`.

**Expected:** button shows "Searching the swarm…" for ~6 s, then the error
"Room not found — no peers are online for this key." Modal stays open.

### T-06 · Invite key copy
1. In the demo room, click the copy icon next to the invite key.

**Expected:** icon flips to a check for ~2 s; clipboard contains `room_7KQ9`.

### T-07 · Staking (UC-04)
1. Open the OPEN market "Will Spain score a second goal before 80'?".
2. In the stake panel: pick **YES**, amount `10`, click **Stake**.

**Expected:** your name appears under YES stakes with `10 test USDt`; YES total 30,
pot **40 test USDt**; top-bar balance drops to **110**.

3. Try amount `0` → error "Enter a positive whole amount…".
4. Try amount `9999` → error "Insufficient balance — you have 110 test USDt."
5. The stake box appears **only** on OPEN markets (not on the penalty/red-card ones).

### T-08 · Emit evidence (UC-05)
1. Demo room → **Emit next event** (top of the timeline rail).

**Expected:** `67' Penalty — Ukraine · VAR confirmed` slides into the timeline
(green); match-minute chip jumps `12'` → `67'`; penalty market flips to **RESOLVING**;
the button grays out (fires once).

### T-09 · Evidence bundle (UC-06)
1. Open the penalty market.

**Expected:** bundle panel shows `Status: LOCKED · v1 · hash: <8 hex>…<8 hex>` (a real
SHA-256, not a placeholder), three items (PRIMARY feed event / SECONDARY manual note ·
Oleksandr / CONTEXT rulebook), and "Evidence locked before voting". Before T-08 it
showed "PENDING — assembles when evidence arrives".

### T-10 · Run the oracle committee (UC-07) — real QVAC
1. Penalty market → **Run oracles** (green button, Oracle committee panel).

**Expected:** caption under the cards reads **"Runs locally via QVAC · Llama 3.2 1B —
no cloud"**. All three cards shimmer "Analyzing evidence…"; verdicts reveal one at a
time, ~3–15 s apart (real inference — watch T-S3 in the sidecar console). Each reveal
shows YES / NO / INSUFFICIENT, a confidence bar, and a model-written reason.

> **Real-LLM nondeterminism:** verdicts vary between runs. The penalty evidence leans
> YES, so 2-of-3 YES is the *common* outcome — but a split (NO CONSENSUS → fallback
> banner) is **correct behavior**, not a bug. Only reproducible-verdict testing should
> use the mock (T-20).

### T-11 · Consensus & resolution (UC-08)
**Expected (when threshold reached):** meter slots fill colored per verdict as each
lands; `2 OF 3 REACHED`; banner `Market resolved: YES` with vote breakdown; market chip
→ **SETTLED**; **View settlement** appears.

### T-12 · Settlement, explanation, audit (UC-10/11/12)
1. Click **View settlement**.

**Expected:** pot 30 test USDt, winning side, pro-rata payouts (YES resolution:
Oleksandr receives 10, Marco 20; your balance unchanged unless you staked); a 2–3
sentence explanation generated by the local model naming outcome, votes, evidence, and
dissent; audit log with **real hashes** (hover a row → copy icon → clipboard gets the
full 64-char digest), threshold `2_of_3`, outcome, `Resolved via`, timestamp.

### T-13 · No-consensus fallback (UC-09)
1. Room → open "Was the red card deserved?" (NO CONSENSUS).

**Expected:** split verdicts in the meter (YES / INSUFF / NO — seeded deterministic),
amber banner "No consensus — fallback: Tiebreaker LLM", **Run fallback** button.

2. Click **Run fallback**.

**Expected:** button shows "Tiebreaker analyzing…", then either (a) the market resolves
per the tiebreaker's verdict and settles, or (b) the tiebreaker returns
INSUFFICIENT_EVIDENCE → market → **CANCELLED**, "stakes refunded" note, and Marco/Ivan
balances recover 8/12. Both outcomes are correct (real LLM decides).

### T-14 · Oracle reset demo utility (UC-15)
1. After a completed run on the penalty market, click the ↺ icon.

**Expected:** committee returns to idle, RESOLVING chip restored, run repeatable.
*(Known quirk under P2P: truncated ops can return from the sidecar on reconnect —
reset is reliable only for immediate replay, not as a state rollback.)*

### T-15 · Nav pill
**Expected:** the floating pill (bottom center, hidden on Landing) jumps between
screens; visiting Settlement before resolution shows the "No settlement yet" empty
state; visiting Market with no market selected (fresh custom room) shows "No market
selected".

---

## 4. Multi-peer scenarios

### T-20 · Two tabs, no sidecar (BroadcastChannel fallback)
1. Stop the sidecar. Reload the app in **two tabs**.
2. Tab A: demo room → stake 5 YES on the second-goal market.

**Expected:** both tabs show the mock caption ("Mock oracle runtime…"), no WDK badge.
The stake appears in tab B within ~a second (same identity in both tabs — same
localStorage). Emitting the event / running (mock) oracles in one tab mirrors in the
other. This proves replication without any networking.

---

## ⭐ TWO-LAPTOP TEST PLAN (T-21) — the live-pitch rehearsal

> **This is the critical test series.** It is the only configuration that proves real
> DHT discovery, NAT traversal, distinct identities, and live cross-machine replication
> — exactly what the judges see in the live pitch. Run all six tests in order; they
> build on each other. Laptop A = your main machine (full sidecar with QVAC).
> Laptop B = the second machine (lightweight sidecar, no model needed).

### T-21.0 · Preparation

**Laptop A (already set up):**
1. Reset the demo state (§0: stop sidecar, delete `frontend/sidecar/.rooms/`, restart).
2. Start the full sidecar: `cd frontend/sidecar && npm start`.
3. Wait for `[sidecar] model ready`, then start the app: `cd frontend && npx pnpm@11 dev`.
4. Open http://localhost:5173 and confirm the WDK badge on the Landing wallet chip.

**Laptop B (one-time setup):**
1. Get the code onto B. If git is set up, clone; if copying the folder instead,
   **exclude** `node_modules/`, `dist/`, `sidecar/.rooms/`, and — critically —
   `sidecar/.wallet.json` (it is a seed phrase; copying it would make both laptops the
   same wallet and invalidate the identity tests).
2. If B runs Windows: turn Smart App Control **off** (Settings → App & browser control;
   one-way toggle — confirm with the machine's owner). Linux/macOS: skip.
3. Install the app: `cd frontend && npx pnpm@11 install`.
4. Install the sidecar: `cd frontend/sidecar && npm install`.
5. Start a **rooms-only** sidecar (skips the 770 MB model — inference runs on A):
   - PowerShell: `$env:QVAC_DISABLE_LLM = "1"; npm start`
   - bash: `QVAC_DISABLE_LLM=1 npm start`
6. Expected sidecar lines on B: `[rooms] WebSocket room bridge attached`,
   `[sidecar] LLM disabled via QVAC_DISABLE_LLM (rooms-only mode)`.
7. Start the app on B: `cd frontend && npx pnpm@11 dev` → http://localhost:5173.
8. On B's Landing, click **Log in with wallet**. Expected: a *different* display name
   than A's, and (since B's sidecar runs the wallet module) B's own WDK address.

Both laptops need internet. Start on the **same Wi-Fi** for T-21.1–T-21.5; T-21.6
switches networks.

### T-21.1 · Cross-machine join of the demo room
1. **A:** join the demo room (`Join with invite key` → `room_7KQ9`). Confirm the room
   loads (4 participants: Oleksandr, Marco, Ivan, you).
2. **B:** `Join with invite key` → type `room_7KQ9` → **Join room**.
3. Watch both sidecar consoles.

**Expected:**
- B enters the room within a few seconds (first ever DHT contact can take ~30–60 s).
- Both sidecar consoles log `[rooms] room_7kq9: peer connected (1 peers)`.
- Both screens show **5 participants** — A's and B's names/avatars both present.
- B sees the full seeded state: three market cards with the same stakes A sees.

### T-21.2 · Remote staking (UC-04 over P2P)
1. **B:** open "Will Spain score a second goal before 80'?" (OPEN).
2. **B:** stake `10` on **NO**.
3. **A:** open the same market (or watch its card on Room home).

**Expected:**
- On B: B's name under NO stakes, B's top-bar balance 120 → 110.
- On A, within ~2 s: NO total rises by 10, pot rises by 10, B's name listed.
- A's own balance unchanged (stakes are per-wallet).

### T-21.3 · Remote evidence + oracle run (UC-05/07/08/10 over P2P)
1. **A:** in the demo room, click **Emit next event**.
2. **B:** watch the timeline and the penalty market card — no clicks.
3. **A:** open the penalty market → **Run oracles** (real QVAC on A).
4. **B:** open the penalty market and watch.

**Expected on B, all without touching anything:**
- The 67' penalty event appears in the timeline; minute chip jumps to 67'.
- Penalty market flips to RESOLVING; bundle shows LOCKED with the same hash A sees.
- Verdicts appear one at a time as A's model finishes each oracle (3–15 s apart).
- On consensus: same resolution banner, same settlement, same audit hashes as A.
- Compare one audit hash on both laptops (copy icon): they must be **identical**.

### T-21.4 · Custom room across machines (UC-01/02/03)
1. **A:** Landing → **Create a room** (any policy) → note the new `room_XXXX` key.
2. **A:** create a market in it (any question).
3. **B:** `Join with invite key` → enter that `room_XXXX` key.

**Expected:**
- B shows "Searching the swarm…" briefly, then enters A's room.
- B sees the room name, A's policy strip, A's market card, and both participants.
- B can stake on the market (if OPEN) and A sees it live.
- Negative check — **B:** join `room_NOPE` → "Room not found" after ~6 s.

### T-21.5 · Restart resilience
1. **B:** stop B's sidecar (Ctrl+C), wait ~5 s, start it again (same env var).
2. **B:** watch the app (do not reload).

**Expected:** the app reconnects automatically (WS retry every 2 s); room state
resyncs; any ops made on A during the outage appear on B after reconnect.

### T-21.6 · Different networks (the venue-Wi-Fi rehearsal)
1. **B:** connect to a different network (phone hotspot is ideal).
2. **B:** reload the app, join `room_7KQ9` again.
3. Repeat T-21.2 (a stake from B).

**Expected:** join succeeds (may take up to ~60 s — cross-NAT holepunching) and the
stake replicates to A. **This is the single most important pass/fail for the live
pitch** — if it fails on your networks, tell the timings/symptoms to your assistant;
fallback strategies (same-hotspot demo) should be decided before pitch day, not during.

### T-22 · Room persistence across reload/restart
1. (Sidecar on) In the demo room, emit the event and run oracles to settlement.
2. Reload the page.

**Expected:** the demo room **retains** the settled state (ops came back from the
sidecar; the deterministic seed dedups). The emit button stays disabled — this is
persistence working, not a bug. Use §0's reset procedure to start over.

3. Restart the sidecar; reload again.

**Expected:** same state — `[rooms] … restored N ops` in the sidecar console.

---

## 5. Failure & degradation paths

| Test | Action | Expected |
|---|---|---|
| T-30 | Run app with sidecar **off** | Everything works on mocks: caption says mock, verdicts are scripted (YES/YES/NO), identity is local `Fan-XXXX` without WDK badge, cross-machine join reports not-found |
| T-31 | Start sidecar, then reload app | App upgrades: QVAC caption + WDK badge appear (detection runs at page load — reload after starting the sidecar) |
| T-32 | Kill sidecar mid-session | Oracle runs fail silently (known gap — no UI error yet); WS adapter retries every 2 s; restarting the sidecar reconnects and resyncs automatically |
| T-33 | Stake more than balance | Rejected client-side with the exact balance in the error; even if forced, the reducer ignores over-balance stakes on every peer |
| T-34 | Both peers click **Run oracles** simultaneously | Harmless race: one set of verdicts wins deterministically (one per role); no duplicate settlement |

---

## 6. Known limitations (expected "failures" — do not file as bugs)

1. **User-created rooms have no evidence path yet**: their markets stay OPEN forever
   ("Emit next event" is demo-room-only). Manual evidence entry is the next work item.
2. **Settlement is engine-ledger only**: the WDK wallet provides identity (real Sepolia
   address, locally held seed), but payouts do not move on-chain yet.
3. **Objective facts short-circuit** has no UI trigger (needs a second Spain goal
   event); it is covered by T-A1 assertions only.
4. **Ops are unsigned**: any peer could author ops under another's address (planned:
   WDK-key signing).
5. **Oracle reset** under P2P is replay-only (see T-14).
6. Confidence may display 0% on real-LLM verdicts when the model omits the field.

---

## 7. Traceability

| Use case | Tests |
|---|---|
| UC-01 create room + policy | T-02 |
| UC-02 join by key | T-04, T-05, T-21 |
| UC-03 create market | T-03, T-21.4 |
| UC-04 staking | T-07, T-20, T-21.2, T-33 |
| UC-05 emit evidence | T-08, T-21.3 |
| UC-06 bundle lock + hash | T-09, T-A1 |
| UC-07 oracle committee (QVAC) | T-10, T-S3, T-30 |
| UC-08 threshold consensus | T-11, T-A1 |
| UC-09 fallback facts/LLM | T-13, T-A1 |
| UC-10 settlement | T-12, T-A1 |
| UC-11 explanation | T-12 |
| UC-12 audit log | T-12, T-A1 |
| UC-13 cancellation + refunds | T-13(b), T-A1 |
| UC-14 objective short-circuit | T-A1 (no UI trigger yet) |
| UC-15 demo utilities | T-14, T-15 |
| UC-16 wallet identity (WDK) | T-01, T-S2, T-31 |
| P2P replication (Phase 3) | T-A2, T-20, T-21, T-22 |
