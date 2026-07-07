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

let cached = null; // { address, network, account }
let initPromise = null;

function pick(mod, ...names) {
  for (const n of names) if (mod?.[n]) return mod[n];
  return mod?.default ?? mod;
}

/** Build a live WDK account from a seed phrase (does not persist it). */
async function buildWallet(seedPhrase) {
  const wdkMod = await import("@tetherto/wdk");
  const evmMod = await import("@tetherto/wdk-wallet-evm");
  const WDK = pick(wdkMod, "WDK");
  const WalletManagerEvm = pick(evmMod, "WalletManagerEvm");
  const wdk = new WDK(seedPhrase);
  wdk.registerWallet("ethereum", WalletManagerEvm, { provider: SEPOLIA_RPC });
  const account = await wdk.getAccount("ethereum", 0);
  const address = await account.getAddress();
  return { address, network: "sepolia", account };
}

function loadStoredSeed() {
  return existsSync(WALLET_FILE) ? JSON.parse(readFileSync(WALLET_FILE, "utf8")).seedPhrase : null;
}

function saveSeed(seedPhrase, how) {
  writeFileSync(WALLET_FILE, JSON.stringify({ seedPhrase, createdAt: Date.now() }, null, 2));
  console.log(`[wallet] wallet ${how} (seed in sidecar/.wallet.json — do not commit)`);
}

/** Load the stored wallet, or auto-create one on first ever run. */
async function initWallet() {
  const wdkMod = await import("@tetherto/wdk");
  const WDK = pick(wdkMod, "WDK");
  let seedPhrase = loadStoredSeed();
  if (!seedPhrase) {
    seedPhrase = WDK.getRandomSeedPhrase();
    saveSeed(seedPhrase, "auto-created");
  }
  cached = await buildWallet(seedPhrase);
  console.log(`[wallet] WDK account ready: ${cached.address} (Sepolia)`);
  return cached;
}

/** Rebind the sidecar to a wallet built from `seedPhrase` and persist it. */
async function useSeed(seedPhrase, how) {
  const w = await buildWallet(seedPhrase); // throws on an invalid phrase
  saveSeed(seedPhrase, how);
  cached = w;
  initPromise = Promise.resolve(w);
  console.log(`[wallet] active wallet is now ${w.address} (Sepolia)`);
  return w.address;
}

/** Create a brand-new self-custodial wallet; returns the seed to back up. */
export async function createWallet() {
  const wdkMod = await import("@tetherto/wdk");
  const WDK = pick(wdkMod, "WDK");
  const seedPhrase = WDK.getRandomSeedPhrase();
  const address = await useSeed(seedPhrase, "created");
  return { address, seedPhrase };
}

/** Import an existing wallet from a user-supplied seed phrase. */
export async function importWallet(seedPhrase) {
  const phrase = String(seedPhrase ?? "").trim().replace(/\s+/g, " ");
  const words = phrase.split(" ").filter(Boolean).length;
  if (words !== 12 && words !== 15 && words !== 18 && words !== 21 && words !== 24) {
    throw new Error("seed phrase must be 12, 15, 18, 21, or 24 words");
  }
  const address = await useSeed(phrase, "imported");
  return { address };
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
