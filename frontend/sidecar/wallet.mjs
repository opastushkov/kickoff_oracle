// WDK wallet module (backend-design.md Phase 4, first cut: UC-16).
// A real self-custodial wallet: the seed phrase is generated once and stored
// ONLY in sidecar/.wallet.json on this machine (never leaves it, never commit
// it). The app's identity becomes the wallet's EVM address on Sepolia testnet.
// Engine-ledger test-USDt stays the room currency; on-chain settlement
// transfers are the remaining Phase-4 step.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const WALLET_FILE = join(dirname(fileURLToPath(import.meta.url)), ".wallet.json");
const SEPOLIA_RPC = process.env.WDK_EVM_RPC ?? "https://ethereum-sepolia-rpc.publicnode.com";

let cached = null; // { address, network }
let initPromise = null;

function pick(mod, ...names) {
  for (const n of names) if (mod?.[n]) return mod[n];
  return mod?.default ?? mod;
}

async function initWallet() {
  const wdkMod = await import("@tetherto/wdk");
  const evmMod = await import("@tetherto/wdk-wallet-evm");
  const WDK = pick(wdkMod, "WDK");
  const WalletManagerEvm = pick(evmMod, "WalletManagerEvm");

  let seedPhrase;
  if (existsSync(WALLET_FILE)) {
    seedPhrase = JSON.parse(readFileSync(WALLET_FILE, "utf8")).seedPhrase;
  } else {
    seedPhrase = WDK.getRandomSeedPhrase();
    writeFileSync(WALLET_FILE, JSON.stringify({ seedPhrase, createdAt: Date.now() }, null, 2));
    console.log("[wallet] new self-custodial wallet created (seed in sidecar/.wallet.json — do not commit)");
  }

  const wdk = new WDK(seedPhrase);
  wdk.registerWallet("ethereum", WalletManagerEvm, { provider: SEPOLIA_RPC });
  const account = await wdk.getAccount("ethereum", 0);
  const address = await account.getAddress();
  console.log(`[wallet] WDK account ready: ${address} (Sepolia)`);
  cached = { address, network: "sepolia", account };
  return cached;
}

// 1 test-USDt minor unit (cent) → wei. Default: 1 cent = 1e12 wei, so a
// 10-USDt payout is 0.001 Sepolia ETH — small enough for faucet balances.
const WEI_PER_MINOR = BigInt(process.env.WDK_WEI_PER_MINOR ?? "1000000000000");

/** Send one real Sepolia transfer from this wallet. Returns the tx hash. */
export async function sendTransfer(to, amountMinor) {
  initPromise ??= initWallet();
  const w = await initPromise;
  const value = BigInt(amountMinor) * WEI_PER_MINOR;
  const result = await w.account.sendTransaction({ to, value });
  const hash = result?.hash ?? result?.txHash ?? String(result);
  console.log(`[wallet] tx → ${to} (${amountMinor} minor): ${hash}`);
  return hash;
}

/**
 * Execute a batch of payouts (settlements, refunds) as real Sepolia
 * transactions. Failures are collected, not thrown — the room ledger must
 * degrade gracefully when this wallet is unfunded.
 */
export async function sendSettlement(payouts) {
  const txs = [];
  const errors = [];
  for (const p of payouts) {
    try {
      const hash = await sendTransfer(p.to, p.amountMinor);
      txs.push({ wallet: p.to, txHash: hash });
    } catch (err) {
      const msg = String(err?.message ?? err);
      console.error(`[wallet] tx to ${p.to} failed: ${msg}`);
      errors.push({ wallet: p.to, error: msg });
    }
  }
  return { txs, errors };
}

export async function getWalletInfo() {
  initPromise ??= initWallet();
  const w = await initPromise;
  // Balance is best-effort — public RPCs can be slow or flaky.
  let balance = null;
  try {
    const b = await Promise.race([
      w.account.getBalance(),
      new Promise((_, rej) => setTimeout(() => rej(new Error("balance timeout")), 5000)),
    ]);
    balance = b?.toString() ?? null;
  } catch {
    balance = null;
  }
  return { ok: true, address: w.address, network: w.network, balance };
}
