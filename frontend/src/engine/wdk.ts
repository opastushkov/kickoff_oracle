// WDK wallet client (UC-16): asks the sidecar for the local self-custodial
// wallet. When present, the app's identity becomes the real EVM address.

export interface WdkWalletInfo {
  address: string;
  network: string;
  balance: string | null; // native balance in wei, best-effort
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
