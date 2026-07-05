// Per-peer local identity (UC-16 stepping stone).
// Every browser gets a persistent identity: display name + wallet address.
// Until WDK provides a real self-custodial wallet, the address is a locally
// generated placeholder — the seam is `wallet: string`, which WDK replaces.

import type { Participant } from "./types";

const STORE_KEY = "kickoff.identity";

export interface LocalIdentity {
  wallet: string;
  displayName: string;
  /** "wdk" once the address comes from a real WDK wallet; "local" otherwise. */
  source: "local" | "wdk";
}

function randomToken(len: number): string {
  let s = "";
  while (s.length < len) s += Math.random().toString(36).slice(2);
  return s.slice(0, len);
}

export function loadOrCreateIdentity(): LocalIdentity {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as LocalIdentity;
      if (parsed.wallet && parsed.displayName) return parsed;
    }
  } catch {
    /* fall through to a fresh identity */
  }
  const identity: LocalIdentity = {
    wallet: `tb1q${randomToken(12)}`,
    displayName: `Fan-${randomToken(4).toUpperCase()}`,
    source: "local",
  };
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(identity));
  } catch {
    /* private mode etc. — identity is per-session then */
  }
  return identity;
}

/** Upgrade the stored identity to a real WDK wallet address. */
export function saveWdkIdentity(address: string, displayName?: string): LocalIdentity {
  const current = loadOrCreateIdentity();
  const identity: LocalIdentity = {
    wallet: address,
    displayName: displayName ?? current.displayName,
    source: "wdk",
  };
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(identity));
  } catch {
    /* best-effort */
  }
  return identity;
}

export function asParticipant(id: LocalIdentity): Participant {
  return { wallet: id.wallet, displayName: id.displayName, joinedAt: Date.now() };
}

export function shortWallet(wallet: string): string {
  return wallet.length > 14 ? `${wallet.slice(0, 8)}…${wallet.slice(-4)}` : wallet;
}
