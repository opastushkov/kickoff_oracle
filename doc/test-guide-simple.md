# Kickoff Oracle — Simple Test Guide (two laptops)

> ⚠️ **PARTIALLY OUTDATED — written against the demo build.** The ready-made demo room
> (`room_7KQ9`) and the "Emit next event" button have been removed — the app is now the
> real product. The new flow: Laptop A **creates a room** (the match feed then plays
> by itself — goals and cards appear over ~6 minutes) and shares its key with Laptop B;
> markets are created with **Create market**; then **Close staking** → **Attach
> evidence & lock bundle** → **Run oracles**. The setup instructions (Parts 1–2) and
> the "not a bug" table still apply. An updated guide is pending.
>
> **This guide is for anyone — no technical knowledge needed.**
> All tests use **two laptops side by side**, because the whole point of the platform
> is that two computers share one betting room directly, with no server in between.
> Follow the tests in order and check that what you see matches the ✅ lines.
> If something doesn't match, write down the test number and what you saw.
> (Developers: the detailed version is [test-plan.md](test-plan.md).)

**What this app is:** a private "watch party" for a football match where friends bet
play-money on questions like "Was the penalty decision correct?" — judged by an AI
that runs on the laptop itself, not in the cloud.

**The one rule to remember:** only **Laptop A** has the AI installed. Anything about
running the AI judges happens on Laptop A. Laptop B bets and watches — that's the point.

---

## Part 1 — Set up Laptop A (the main laptop)

Open **two black command windows** (press the Windows key, type `powershell`, Enter)
and leave both running the whole time.

**Window 1 — the "helper" (runs the AI):**
```
cd c:\Users\oleks\Tether_Hackathon\frontend\sidecar; npm start
```
Wait for the words **model ready** (the very first time it may download a large file
for a few minutes — normal).

**Window 2 — the app:**
```
cd c:\Users\oleks\Tether_Hackathon\frontend; npx pnpm@11 dev
```
When a line shows **http://localhost:5173**, open that address in Chrome or Edge.

✅ **Check:** a green-and-white page titled **Kickoff Oracle**.

---

## Part 2 — Set up Laptop B (the second laptop)

Ask the developer to do steps 1–2 once; after that anyone can start it.

1. Copy the project folder onto Laptop B (for example to `C:\KickoffOracle`).
   ⚠️ **Never copy the file `frontend\sidecar\.wallet.json`** — it's a private key.
   If Laptop B runs Windows, "Smart App Control" must be turned off (a developer step).
2. One-time install, in PowerShell (replace the path if you used a different folder):
   ```
   cd C:\KickoffOracle\frontend\sidecar; npm install
   cd C:\KickoffOracle\frontend; npx pnpm@11 install
   ```
3. Every time you test — **Window 1** (helper *without* the AI; Laptop B doesn't need it):
   ```
   cd C:\KickoffOracle\frontend\sidecar; $env:QVAC_DISABLE_LLM = "1"; npm start
   ```
4. **Window 2** (the app):
   ```
   cd C:\KickoffOracle\frontend; npx pnpm@11 dev
   ```
5. Open **http://localhost:5173** in the browser **on Laptop B**.

✅ **Check:** the same green start page appears on Laptop B.

Both laptops must be connected to the internet (same Wi-Fi is fine to start).

---

## Part 3 — The tests

### Test 1 — Two different people
1. **Laptop A:** on the start page, click **Log in with wallet** (top right).
2. **Laptop B:** do the same.

✅ Each laptop shows its own name (like **Fan-A3K2**), its own code starting with
**0x…**, and a badge **WDK · Sepolia**. The names and codes are **different** on the
two laptops — you are two different people.

> Badge missing? The helper window on that laptop isn't running. Start it, refresh (F5).

### Test 2 — Both laptops enter the same room
1. **Laptop A:** click **Join with invite key**, type `room_7KQ9`, click **Join room**.
2. **Laptop B:** do exactly the same. (The very first join can take up to a minute
   while the laptops find each other — later it's seconds.)

✅ Both laptops show **Ukraine vs Spain Watch Party** with:
- "**5 participants**" (three demo characters + both of you),
- **each laptop's screen shows the other laptop's name** in the row of avatars,
- balance **120 test USDt** at the top right of each,
- three white question cards and a match timeline on the right.

**This is the no-server moment:** the room exists only on your two laptops.

### Test 3 — A bet travels between laptops
1. **Laptop B:** click the card **"Will Spain score a second goal before 80'?"**,
   click **YES**, type **10**, click **Stake**.
2. **Laptop A:** open the same card and just look.

✅ On B: balance drops 120 → **110**. On A, **within a couple of seconds and without
touching anything**: the Total pot grows by 10 and Laptop B's name appears under
"YES stakes".

### Test 4 — Over-betting is blocked
1. **Laptop B:** same box — type **9999**, click **Stake**.

✅ A red message says the balance isn't enough. Nothing is deducted, and nothing
changes on Laptop A.

### Test 5 — A match event appears on both screens
1. **Laptop A:** go back to the room (bottom pill → **room**) and click the green
   **Emit next event** button on the right.
2. **Laptop B:** just watch the room screen.

✅ On **both** laptops: a green **67' Penalty — Ukraine** entry slides into the
timeline, the match clock jumps 12' → **67'**, and the penalty card changes to
**RESOLVING**. Laptop B updated by itself.

### Test 6 — The AI judges (watch from both sides)
1. **Laptop A:** open **"Was the penalty decision correct?"**. The left panel should
   say **LOCKED** with a long code — the tamper-proof evidence envelope.
2. **Laptop B:** open the same card and keep it visible.
3. **Laptop A:** click **Run oracles**. **Be patient** — three cards think
   ("Analyzing evidence…") and reveal answers one at a time, up to ~15 seconds each.
   A real AI is working on Laptop A — nothing is faked.

✅ Answers (like YES / YES / NO) appear with written reasons **on both laptops at the
same moments**. Under the cards on A: "**Runs locally via QVAC · Llama 3.2 1B — no
cloud**". Usually you then see **"Market resolved: YES"** and **"2 OF 3 REACHED"**.

> ⚠️ Sometimes the AIs disagree → **"No consensus"**. **Not a bug** — real AIs think
> for themselves. If so, click **Run fallback** on **Laptop A** (a fourth AI decides,
> or all bets are refunded) and continue.

### Test 7 — The receipt matches on both laptops
1. **Both laptops:** click **View settlement**.
2. Find the receipt line **"Evidence hash"**. Hover over it and click the little copy
   icon on each laptop, then paste both into any notes app and compare.

✅ Both laptops show the same pot, the same payouts, the same AI-written explanation —
and the two copied codes are **exactly identical, character for character**. That's
the proof neither laptop can secretly change history.

### Test 8 — When the AI disagrees on purpose
1. **Laptop A:** go to the room and open **"Was the red card deserved?"** — it's
   pre-loaded with a disagreement (YES / INSUFF / NO) and an orange box:
   **"No consensus — fallback: Tiebreaker LLM"**.
2. **Laptop B:** open the same card to watch.
3. **Laptop A:** click **Run fallback** and wait.

✅ One of two correct outcomes, shown on **both** screens: the question resolves and
pays out, **or** it turns **CANCELLED** with "stakes refunded" — the AI decided the
evidence wasn't enough and everyone got their money back. Both are correct.

### Test 9 — Your own room, shared across laptops
1. **Laptop A:** bottom pill → **landing** → **Create a room**. Give it any name,
   click **Create room**. Note the room's key at the top (like `room_8XK2`).
2. **Laptop A:** click **Create market**, type any yes/no question, click Create.
3. **Laptop B:** landing → **Join with invite key** → type that key → Join.

✅ Laptop B says "Searching the swarm…" for a few seconds, then enters Laptop A's
room, showing the same room name and the question card. Laptop B can bet on it and
Laptop A sees the bet appear. *(Match events can't be sent in your own rooms yet —
that feature is coming.)*

### Test 10 — Wrong key
1. **Laptop B:** landing → **Join with invite key** → type `room_FAKE` → Join.

✅ It searches for a few seconds, then: **"Room not found — no peers are online for
this key."**

### Test 11 — Unplug and recover
1. **Laptop B:** click on its helper window (Window 1) and press **Ctrl+C** to stop it.
2. **Laptop A:** place a bet of 5 on any open question.
3. **Laptop B:** wait ~10 seconds, then start the helper again (Part 2, step 3).
   Don't touch the browser.

✅ Within a few seconds Laptop B's browser catches up **by itself** — Laptop A's bet
from step 2 appears, no refresh needed.

### Test 12 — Different networks (the big one)
1. **Laptop B:** disconnect from the shared Wi-Fi and connect to a **phone hotspot**.
2. **Laptop B:** refresh the browser (F5), then join `room_7KQ9` again.
3. **Laptop B:** place a bet.

✅ The join works (may take up to a minute) and the bet appears on Laptop A — even
though the laptops are now on completely different networks. **This is the most
important test of all**: if it passes, the live demo setup is safe.

---

## Starting over (reset)

The room **remembers** everything — even across restarts, on **both** laptops. To
wipe the demo clean:

1. Stop the helper window on **both** laptops (click it, press **Ctrl+C**).
2. Delete this folder on **both** laptops:
   `…\frontend\sidecar\.rooms`
3. Start both helpers again and refresh both browsers (F5).

(If you skip one laptop, it will politely "remind" the other of the old history —
that's the sync working against you.)

---

## Things that look like bugs but are NOT

| What you see | Why it's fine |
|---|---|
| The AI gives different answers than last time | Real AI — it thinks fresh every run |
| A confidence bar shows 0% | The AI skipped that field; the answer still counts |
| After refreshing, the room is exactly as you left it | Memory is a feature (the helpers save it) |
| "Emit next event" turns grey on both laptops after Test 5 | The scripted event fires once per match — whichever laptop clicks first |
| "Emit next event" is grey in a room you created | Match events only exist in the demo room for now |
| The first AI answer takes 15+ seconds | It runs on the laptop, not in a datacenter |
| The first cross-laptop join takes a minute | The laptops are finding each other worldwide |
| The page says "Mock oracle runtime…" | That laptop's helper isn't running — start it, refresh |

**If a test fails:** write down the test number, what you expected, what you actually
saw, and copy the last few lines from the black helper window on **both** laptops.
That's everything a developer needs.
