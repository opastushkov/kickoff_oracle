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

## Quickstart (Windows)

Prerequisites: Node.js ≥ 20, internet (one-time ~770 MB model download, DHT, Sepolia
RPC). **Windows 11 note:** Smart App Control must be OFF (QVAC/Bare native binaries are
unsigned).

```powershell
git clone https://github.com/opastushkov/kickoff_oracle.git
cd kickoff_oracle
.\start-host.cmd     # main laptop: installs everything, starts the AI+P2P+wallet
                     # sidecar and the app, opens the browser (~20 s)
```

Second laptop (joins rooms, stakes, watches — no AI model needed):

```powershell
.\start-viewer.cmd
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
- **Match data:** rooms bind either to a built-in demo fixture ("Ukraine vs Spain") or
  to a **real match**: the sidecar fetches the match's true timeline (goals, cards,
  penalties, final score) from **TheSportsDB** (free/dev API key by default; set
  `SPORTSDB_KEY` for a production key) and replays it on an accelerated clock.
  Per-player stat events are derived strictly from the real timeline — nothing is
  invented. Richer per-player statistics (API-Football/Opta-class) plug into the same
  provider seam.
- **Known trust boundaries:** the host wallet is a custodial escrow (every movement
  on-chain and auditable; contract escrow is designed as the next step), and the oracle
  runner is trusted to execute models faithfully (verdicts are hash-bound to locked
  evidence; op signing planned).

## License

Apache License 2.0 — see [LICENSE](LICENSE). Copyright 2026 Oleksandr Pastushkov.
