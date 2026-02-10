import type { Claim } from './types';

export type SquarePaymentMatchInput = {
  id: string;
  created_at?: string;
  location_id?: string;
  amount_money?: { amount: number };
  card_details?: { card?: { last_4?: string; fingerprint?: string; card_fingerprint?: string } };
};

export type SquareClaimMatch = {
  claimId: string;
  paymentId: string;
  fingerprint: string;
  amount: number;
  last4: string;
  time: Date;
  locationId?: string | null;
};

export function matchClaimsToSquarePayments(
  pendingClaims: Claim[],
  payments: SquarePaymentMatchInput[],
  windowMinutes: number
): { matches: SquareClaimMatch[]; unmatchedClaimIds: string[] } {
  const matches: SquareClaimMatch[] = [];
  const unmatchedClaims = new Set(
    pendingClaims.map((claim) => claim.id).filter(Boolean) as string[]
  );

  for (const payment of payments) {
    const last4 = payment.card_details?.card?.last_4;
    const fingerprint =
      payment.card_details?.card?.fingerprint ??
      payment.card_details?.card?.card_fingerprint ??
      null;
    const amount = payment.amount_money?.amount;
    const createdAt = payment.created_at;
    if (!last4 || !fingerprint || amount == null || !createdAt) continue;

    const transactionTime = new Date(createdAt);
    if (Number.isNaN(transactionTime.getTime())) continue;

    const amountDollars = amount / 100;
    const candidateClaims: Claim[] = [];
    for (const claim of pendingClaims) {
      if (!claim.id || !unmatchedClaims.has(claim.id)) continue;
      if (String(claim.last_4 || '').trim() !== last4) continue;
      if (Number(claim.amount || 0).toFixed(2) !== amountDollars.toFixed(2)) continue;
      const claimTime = new Date(claim.purchased_at);
      const diffMs = Math.abs(claimTime.getTime() - transactionTime.getTime());
      if (diffMs <= windowMinutes * 60 * 1000) {
        candidateClaims.push(claim);
      }
    }

    let bestClaim: Claim | null = null;
    if (candidateClaims.length > 0) {
      bestClaim =
        candidateClaims
          .slice()
          .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())[0] ?? null;
    }

    if (bestClaim?.id) {
      unmatchedClaims.delete(bestClaim.id);
      matches.push({
        claimId: bestClaim.id,
        paymentId: payment.id,
        fingerprint,
        amount: amountDollars,
        last4,
        time: transactionTime,
        locationId: payment.location_id ?? null
      });
    }
  }

  return { matches, unmatchedClaimIds: Array.from(unmatchedClaims) };
}
