import { supabaseAdmin } from '$lib/server/supabaseAdmin';

export type ClaimPayoutRow = {
  id: string;
  amount: number;
  kickback_guest_rate: number | null;
  kickback_referrer_rate: number | null;
  submitter_id: string | null;
  referrer_id: string | null;
};

type PayoutRow = {
  id: string;
  user_id: string | null;
  amount: number | null;
  currency: string | null;
  claim_ids: string[] | null;
  claim_count: number | null;
  status: 'unpaid' | 'paid' | null;
  created_at: string | null;
  paid_at: string | null;
  pay_id: string | null;
};

function claimSplit(claim: ClaimPayoutRow) {
  const amount = Number(claim.amount ?? 0);
  const guestRate = Number(claim.kickback_guest_rate ?? 5) / 100;
  const referrerRate = Number(claim.kickback_referrer_rate ?? 5) / 100;
  return {
    guestAmount: Number((amount * guestRate).toFixed(2)),
    referrerAmount: Number((amount * referrerRate).toFixed(2))
  };
}

function buildUserContributions(claims: ClaimPayoutRow[]) {
  const contributions = new Map<string, Map<string, number>>();
  for (const claim of claims) {
    if (!claim?.id) continue;
    const claimId = String(claim.id);
    const { guestAmount, referrerAmount } = claimSplit(claim);

    if (claim.submitter_id && guestAmount > 0) {
      const userId = String(claim.submitter_id);
      const byClaim = contributions.get(userId) ?? new Map<string, number>();
      byClaim.set(claimId, Number(((byClaim.get(claimId) ?? 0) + guestAmount).toFixed(2)));
      contributions.set(userId, byClaim);
    }
    if (claim.referrer_id && referrerAmount > 0) {
      const userId = String(claim.referrer_id);
      const byClaim = contributions.get(userId) ?? new Map<string, number>();
      byClaim.set(claimId, Number(((byClaim.get(claimId) ?? 0) + referrerAmount).toFixed(2)));
      contributions.set(userId, byClaim);
    }
  }
  return contributions;
}

export async function addClaimsToUnpaidPayouts(claims: ClaimPayoutRow[], currency = 'aud') {
  const contributions = buildUserContributions(claims);
  const nowIso = new Date().toISOString();
  let rowsInserted = 0;
  let rowsUpdated = 0;

  for (const [userId, byClaim] of contributions) {
    const { data: existingRows, error: existingError } = await supabaseAdmin
      .from('payouts')
      .select('id, user_id, amount, currency, claim_ids, claim_count, status, created_at, paid_at, pay_id')
      .eq('user_id', userId)
      .eq('status', 'unpaid')
      .eq('currency', currency)
      .order('created_at', { ascending: true });
    if (existingError) {
      throw new Error(existingError.message);
    }

    const openRows = (existingRows ?? []) as PayoutRow[];
    if (openRows.length === 0) {
      const claimIds = Array.from(byClaim.keys());
      const amount = Number(Array.from(byClaim.values()).reduce((sum, value) => sum + value, 0).toFixed(2));
      if (claimIds.length === 0 || amount <= 0) continue;
      const { error: insertError } = await supabaseAdmin.from('payouts').insert({
        user_id: userId,
        amount,
        currency,
        claim_ids: claimIds,
        claim_count: claimIds.length,
        status: 'unpaid',
        created_at: nowIso,
        updated_at: nowIso
      });
      if (insertError) {
        throw new Error(insertError.message);
      }
      rowsInserted += 1;
      continue;
    }

    const existingClaimIds = new Set(
      openRows.flatMap((row) => (Array.isArray(row.claim_ids) ? row.claim_ids : [])).map((id) => String(id))
    );
    const primary = openRows[0];
    const primaryClaimIds = new Set(
      (Array.isArray(primary.claim_ids) ? primary.claim_ids : []).map((id) => String(id))
    );
    let additionalAmount = 0;
    const addedClaimIds: string[] = [];
    for (const [claimId, amount] of byClaim) {
      if (existingClaimIds.has(claimId)) continue;
      additionalAmount += amount;
      addedClaimIds.push(claimId);
      primaryClaimIds.add(claimId);
    }
    if (addedClaimIds.length === 0 || additionalAmount <= 0) continue;

    const nextAmount = Number((Number(primary.amount ?? 0) + additionalAmount).toFixed(2));
    const nextClaimIds = Array.from(primaryClaimIds);

    const { error: updateError } = await supabaseAdmin
      .from('payouts')
      .update({
        amount: nextAmount,
        claim_ids: nextClaimIds,
        claim_count: nextClaimIds.length,
        updated_at: nowIso
      })
      .eq('id', primary.id);
    if (updateError) {
      throw new Error(updateError.message);
    }
    rowsUpdated += 1;
  }

  return {
    usersTouched: contributions.size,
    rowsInserted,
    rowsUpdated
  };
}

