// WDK wallet client (UC-16): asks the sidecar for the local self-custodial
// wallet. When present, the app's identity becomes the real EVM address.

export interface WdkWalletInfo {
  address: string;
  network: string;
  balance: string | null; // native balance in wei, best-effort
}

/**
 * Send one on-chain stake transfer (staker → host escrow wallet) via the
 * local sidecar's WDK wallet. Throws with a human-readable message on failure
 * (e.g. unfunded wallet) so the stake UI can surface it.
 */
export async function executeStakeTransfer(
  to: string,
  amount: bigint,
  baseUrl = "http://127.0.0.1:8791",
): Promise<string> {
  const res = await fetch(`${baseUrl}/wallet/transfer`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ to, amountMinor: amount.toString() }),
    signal: AbortSignal.timeout(90_000),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.ok) {
    const raw = String(j.error ?? `transfer failed (${res.status})`);
    throw new Error(raw.includes("insufficient funds") ? "insufficient Sepolia funds in your wallet" : raw);
  }
  return String(j.txHash);
}

/**
 * Execute settlement payouts as real Sepolia transactions via the sidecar's
 * WDK wallet (runner-as-paymaster). Non-0x recipients (local placeholder
 * identities) are skipped. Returns tx receipts, or null when nothing was sent.
 */
export async function executeOnChainSettlement(
  settlement: { payouts: { wallet: string; amount: bigint }[] },
  baseUrl = "http://127.0.0.1:8791",
): Promise<{ wallet: string; txHash: string }[] | null> {
  try {
    const payouts = settlement.payouts
      .filter((p) => p.wallet.startsWith("0x") && p.amount > 0n)
      .map((p) => ({ to: p.wallet, amountMinor: p.amount.toString() }));
    if (payouts.length === 0) return null;
    const res = await fetch(`${baseUrl}/wallet/settle`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ payouts }),
      signal: AbortSignal.timeout(180_000),
    });
    if (!res.ok) return null;
    const j = await res.json();
    return Array.isArray(j.txs) && j.txs.length > 0 ? j.txs : null;
  } catch {
    return null;
  }
}

/** Create a brand-new self-custodial wallet; returns its address + the seed to back up. */
export async function createWdkWallet(
  baseUrl = "http://127.0.0.1:8791",
): Promise<{ address: string; seedPhrase: string }> {
  const res = await fetch(`${baseUrl}/wallet/create`, { method: "POST", signal: AbortSignal.timeout(30_000) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.ok) throw new Error(String(j.error ?? `create failed (${res.status})`));
  return { address: String(j.address), seedPhrase: String(j.seedPhrase) };
}

/** Import an existing wallet from a seed phrase; returns its address. */
export async function importWdkWallet(
  seedPhrase: string,
  baseUrl = "http://127.0.0.1:8791",
): Promise<string> {
  const res = await fetch(`${baseUrl}/wallet/import`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ seedPhrase }),
    signal: AbortSignal.timeout(30_000),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.ok) throw new Error(String(j.error ?? `import failed (${res.status})`));
  return String(j.address);
}

export async function detectWdkWallet(
  baseUrl = "http://127.0.0.1:8791",
): Promise<WdkWalletInfo | null> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000); // first call may create the wallet
    const res = await fetch(`${baseUrl}/wallet`, { signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) return null;
    const j = await res.json();
    return j?.ok && j.address
      ? { address: String(j.address), network: String(j.network ?? "sepolia"), balance: j.balance ?? null }
      : null;
  } catch {
    return null;
  }
}
