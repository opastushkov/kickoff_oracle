# ⚽ Kickoff Oracle

**A serverless football watch-party where friends bet testnet USDt on match questions —
and a committee of local AI oracles, running entirely on your own hardware, judges the
evidence and settles the pot on-chain.**

No bookmaker. No server. No cloud AI. Evidence in, consensus out.

Built for the **Tether Developers Cup** (theme: football & the global tournament moment),
entering **all three tracks** — every one with a real, load-bearing integration:

| Track | How it's genuinely used |
|---|---|
| **QVAC** | All AI runs on-device through `@qvac/sdk`: a configurable committee of 1–5 LLM oracles (per-oracle model choice from a catalog — Llama 3.2 1B, Qwen3 1.7B/0.6B, SmolLM2 360M — downloaded on demand through QVAC's P2P registry with live progress), a tiebreaker LLM for split verdicts, and model-written plain-language settlement explanations. **No cloud AI anywhere**; oracle runs work in airplane mode. |
| **Pears** | All peer-to-peer networking goes through **Hyperswarm**: each room's invite key maps to a swarm topic; the room's operation log replicates between machines over encrypted Holepunch streams with disk persistence and late-joiner snapshot sync. Second laptops join live rooms by key across different networks. (The Hyperswarm node currently runs on Node.js; Bare packaging is the planned next step.) |
| **WDK** | Identity **is** a real self-custodial wallet (`@tetherto/wdk` + `wdk-wallet-evm`): the seed is generated and stored only on-device, and the wallet's Sepolia address authors every operation. **Every money movement is a real Sepolia transaction** — stakes transfer staker → host escrow, settlements pay winners, cancellations refund stakers — with Etherscan-linked receipts on stakes, payouts, and in the audit log. |

## How it works (90 seconds)

1. **Create a room** — set the resolution policy once: committee size (1–5), an LLM per
   oracle (downloadable in the modal), consensus threshold (e.g. 2-of-3), tiebreaker
   model. The policy is immutable and visible before anyone stakes.
2. **Friends join by invite key** — their sidecar finds yours over the Hyperswarm DHT;
   the room's append-only op log syncs; everyone appears with their own wallet identity.
3. **Stake while markets are OPEN** — each stake is a real Sepolia transfer into the
   host's escrow wallet (tx hash attached to the stake).
4. **The match feed plays** — events land on a shared evidence timeline. Facts are
   evidence, never judges.
5. **Close staking, lock the evidence bundle** — chosen events + notes + rulebook
   excerpt, SHA-256-hashed over canonical JSON. Verdicts must reference this exact hash;
   evidence can never be re-rolled.
6. **Run the oracles** — independent local inference runs, one per committee slot.
   Threshold met → resolved. Split → the tiebreaker LLM decides, or the market cancels
   with on-chain refunds.
7. **Settlement** — pro-rata payouts (integer math, deterministic rounding), paid as
   real Sepolia transactions, explained in plain language by a local model, and sealed
   in an audit log of hashes and tx receipts that is identical on every peer.

## Quickstart

Prerequisites: Node.js ≥ 20, internet (one-time ~770 MB model download, DHT, Sepolia
RPC). Runs on **Windows x64** and **Linux x64** (macOS: use the manual start below).

One launcher per machine, three roles:

| Role | Windows | Linux | What it does |
|---|---|---|---|
| **Host** | `.\start-host.cmd` | `./start-host.sh` | Main laptop: installs everything, starts the AI+P2P+wallet sidecar and the app, opens the browser (~20 s) |
| **Juror** | `.\start-juror.cmd` | `./start-juror.sh` | Second laptop that **also judges** with its own local model — the two-device, different-model jury. Joins the host's room by invite key |
| **Viewer** | `.\start-viewer.cmd` | `./start-viewer.sh` | Second laptop: joins rooms, stakes, watches — no AI model needed |

### Windows

```powershell
git clone https://github.com/opastushkov/kickoff_oracle.git
cd kickoff_oracle
.\start-host.cmd
```

**Windows 11 note:** Smart App Control must be OFF (QVAC/Bare native binaries are
unsigned). If a model download fails with "RPC initialization timed out", that's the
cause: Windows Security → App & browser control → Smart App Control → Off, reboot,
run the launcher again.

### Linux (x64)

```bash
git clone https://github.com/opastushkov/kickoff_oracle.git
cd kickoff_oracle
chmod +x start-host.sh start-juror.sh start-viewer.sh   # once
./start-host.sh
```

The sidecar runs in the background and logs to `sidecar.log` in the repo root;
**Ctrl+C stops both** the app and the sidecar. The browser opens via `xdg-open`
(or open `http://localhost:5173` yourself). The platform-native AI runtime
(`bare-runtime-linux-x64`) installs automatically as an optional dependency.

### Manual start (any OS, including macOS)

Terminal 1 — the sidecar:

```bash
cd frontend/sidecar
npm install
npm start                          # host / juror (runs the AI)
# viewer instead:  QVAC_DISABLE_LLM=1 npm start
```

Terminal 2 — the app:

```bash
cd frontend
npx pnpm@11 install
npx pnpm@11 dev                    # then open http://localhost:5173
```

Then in the browser: **Log in with wallet → Create a room** (host) or
**Join with invite key** (everyone else).

Manual setup, testing (engine selftest, P2P replication test), and detailed scenarios:
see [doc/test-plan.md](doc/test-plan.md).

**On-chain settlement:** fund each laptop's wallet with Sepolia ETH from any faucet
(the address is shown by `curl http://127.0.0.1:8791/wallet`; 0.05 ETH is plenty).
Unfunded wallets degrade gracefully to ledger-only play.

## Architecture

```
┌───────────────────── each participant's machine ─────────────────────┐
│  React app (browser) ── WebSocket/HTTP ──► sidecar (Node)            │
│    · engine: replicated op log            · QVAC: local LLM oracles  │
│      (Lamport-ordered, content-deduped,   · Hyperswarm: room P2P     │
│       pure reducers, SHA-256 evidence     · WDK: self-custodial      │
│       & vote hashing)                       Sepolia wallet           │
└────────────────────────────┬─────────────────────────────────────────┘
                             │ encrypted Hyperswarm streams (DHT discovery)
                             ▼
                     other participants' sidecars
```

Full design docs: [doc/backend-design.md](doc/backend-design.md),
[doc/platform-analysis.md](doc/platform-analysis.md),
[doc/use-case-scenarios.md](doc/use-case-scenarios.md).

## Disclosures (pre-existing / third-party components)

- **Tether stack:** `@qvac/sdk` (local inference + P2P model registry), `hyperswarm`
  (P2P transport), `@tetherto/wdk` + `@tetherto/wdk-wallet-evm` (self-custodial wallet;
  brings `ethers` v6).
- **UI:** the visual scaffold was generated with Figma Make during the hackathon period
  and includes the stock shadcn/Radix component kit (mostly unused by the app screens);
  app logic, engine, and sidecar are hand-written for this project.
- **Infra:** public Sepolia RPC (`ethereum-sepolia-rpc.publicnode.com`, configurable via
  `WDK_EVM_RPC`); Etherscan for receipt links; `ws` for the local browser↔sidecar bridge.
- **Match data:** every room binds to a **real match** (no built-in fixture) — the
  creator searches a team and picks one of its matches, and the sidecar fetches that
  match's true timeline (goals, cards, subs, team + player stats, final score) from
  **TheSportsDB** (free/dev API key by default; set `SPORTSDB_KEY` for a production key)
  and replays it on an accelerated clock. A match with no available timeline is refused
  at creation — the jury only ever judges real data. Richer per-player statistics
  (API-Football/Opta-class) plug into the same provider seam.
- **Known trust boundaries:** the host wallet is a custodial escrow (every movement
  on-chain and auditable; contract escrow is designed as the next step), and the oracle
  runner is trusted to execute models faithfully (verdicts are hash-bound to locked
  evidence; op signing planned).

## License

Apache License 2.0 — see [LICENSE](LICENSE). Copyright 2026 Oleksandr Pastushkov.
