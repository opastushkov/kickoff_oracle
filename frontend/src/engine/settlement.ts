// Pro-rata payout math in bigint minor units (doc/backend-design.md §9).
// payout_i = floor(stake_i × pot / winnersTotal); the rounding remainder is
// distributed one unit at a time by largest fractional part, ties broken by
// wallet address order — deterministic on every peer.

import type { Side, Stake } from "./types";

export interface Payout {
  wallet: string;
  amount: bigint;
}

export function computePayouts(stakes: Stake[], winningSide: Side): Payout[] {
  const pot = stakes.reduce((a, s) => a + s.amount, 0n);
  // Merge multiple stakes by the same wallet on the winning side.
  const winners = new Map<string, bigint>();
  for (const s of stakes) {
    if (s.side === winningSide) winners.set(s.wallet, (winners.get(s.wallet) ?? 0n) + s.amount);
  }
  const winnersTotal = [...winners.values()].reduce((a, v) => a + v, 0n);
  if (winnersTotal === 0n) {
    // Nobody on the winning side → treat as cancellation: refund everyone.
    const refunds = new Map<string, bigint>();
    for (const s of stakes) refunds.set(s.wallet, (refunds.get(s.wallet) ?? 0n) + s.amount);
    return [...refunds.entries()]
      .map(([wallet, amount]) => ({ wallet, amount }))
      .sort((a, b) => (a.wallet < b.wallet ? -1 : 1));
  }

  const entries = [...winners.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
  const payouts = entries.map(([wallet, stake]) => ({
    wallet,
    amount: (stake * pot) / winnersTotal,
    remainder: (stake * pot) % winnersTotal, // fractional part × winnersTotal
  }));

  let leftover = pot - payouts.reduce((a, p) => a + p.amount, 0n);
  const byRemainder = [...payouts].sort(
    (a, b) => (b.remainder > a.remainder ? 1 : b.remainder < a.remainder ? -1 : a.wallet < b.wallet ? -1 : 1),
  );
  for (const p of byRemainder) {
    if (leftover === 0n) break;
    p.amount += 1n;
    leftover -= 1n;
  }
  return payouts.map(({ wallet, amount }) => ({ wallet, amount }));
}

/** 12345n minor units → "123.45", trimming trailing zeros ("12000" → "120"). */
export function formatUSDt(minor: bigint): string {
  const sign = minor < 0n ? "-" : "";
  const abs = minor < 0n ? -minor : minor;
  const whole = abs / 100n;
  const cents = abs % 100n;
  if (cents === 0n) return `${sign}${whole}`;
  return `${sign}${whole}.${cents.toString().padStart(2, "0").replace(/0$/, "")}`;
}
