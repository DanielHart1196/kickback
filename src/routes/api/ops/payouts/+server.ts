import { json, type RequestHandler } from '@sveltejs/kit';
import { supabaseAdmin } from '$lib/server/supabaseAdmin';

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

type Aggregate = {
  user_id: string;
  amount: number;
  currency: string;
  claim_ids: Set<string>;
};

type ClaimPayoutStatus = 'pending' | 'approved' | 'paid' | 'guestpaid' | 'refpaid' | 'paidout' | 'denied' | null;

type ClaimSettleRow = {
  id: string;
  status: ClaimPayoutStatus;
  submitter_id: string | null;
  referrer_id: string | null;
};

function getNextClaimStatus(current: ClaimPayoutStatus, markGuestPaid: boolean, markRefPaid: boolean): ClaimPayoutStatus {
  if (current === 'denied') return 'denied';
  if (current === 'paidout') return 'paidout';

  let guestPaid = current === 'guestpaid';
  let refPaid = current === 'refpaid';

  if (markGuestPaid) guestPaid = true;
  if (markRefPaid) refPaid = true;

  if (guestPaid && refPaid) return 'paidout';
  if (guestPaid) return 'guestpaid';
  if (refPaid) return 'refpaid';

  return current ?? 'paid';
}

function addAmount(map: Map<string, Aggregate>, userId: string, amount: number, currency: string, claimIds: string[]) {
  const existing = map.get(userId);
  if (existing) {
    existing.amount += amount;
    for (const claimId of claimIds) {
      if (claimId) existing.claim_ids.add(claimId);
    }
    return;
  }
  map.set(userId, {
    user_id: userId,
    amount,
    currency,
    claim_ids: new Set(claimIds.filter(Boolean))
  });
}

export const POST: RequestHandler = async ({ request, fetch }) => {
  const authHeader = request.headers.get('authorization') ?? '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!token) {
    return json({ ok: false, error: 'missing_token' }, { status: 401 });
  }

  const { data: requesterData, error: requesterError } = await supabaseAdmin.auth.getUser(token);
  if (requesterError || !requesterData?.user) {
    return json({ ok: false, error: 'invalid_token' }, { status: 401 });
  }

  const { data: requesterProfile, error: profileError } = await supabaseAdmin
    .from('profiles')
    .select('role')
    .eq('id', requesterData.user.id)
    .maybeSingle();
  if (profileError) {
    return json({ ok: false, error: profileError.message }, { status: 500 });
  }
  if (requesterProfile?.role !== 'admin') {
    return json({ ok: false, error: 'forbidden' }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const action = typeof body?.action === 'string' ? body.action : 'calculate';
  const targetUserId = typeof body?.user_id === 'string' ? body.user_id : '';

  const { data: openRows, error: openRowsError } = await supabaseAdmin
    .from('payouts')
    .select('id, user_id, amount, currency, claim_ids, claim_count, status, created_at, paid_at, pay_id')
    .eq('status', 'unpaid')
    .order('created_at', { ascending: true });
  if (openRowsError) {
    return json({ ok: false, error: openRowsError.message }, { status: 500 });
  }

  const aggregates = new Map<string, Aggregate>();
  for (const row of (openRows ?? []) as PayoutRow[]) {
    const userId = String(row.user_id ?? '');
    if (!userId) continue;
    const amount = Number(row.amount ?? 0);
    if (amount <= 0) continue;
    const currency = String(row.currency ?? 'aud').toLowerCase();
    const claimIds = (Array.isArray(row.claim_ids) ? row.claim_ids : []).map((id) => String(id));
    addAmount(aggregates, userId, amount, currency, claimIds);
  }

  const userIds = Array.from(aggregates.keys());
  if (userIds.length === 0) {
    return json({ ok: true, payouts: [] });
  }

  const [{ data: profiles }, { data: payoutProfiles }] = await Promise.all([
    supabaseAdmin.from('profiles').select('id, referral_code, email, notify_payout_confirmation').in('id', userIds),
    supabaseAdmin.from('payout_profiles').select('user_id, pay_id').in('user_id', userIds)
  ]);

  const profileById = new Map((profiles ?? []).map((p) => [String(p.id), p]));
  const payIdByUser = new Map((payoutProfiles ?? []).map((p) => [String(p.user_id), String(p.pay_id ?? '')]));

  const payouts = userIds
    .map((userId) => {
      const agg = aggregates.get(userId)!;
      const profile = profileById.get(userId);
      return {
        user_id: userId,
        referral_code: profile?.referral_code ?? null,
        email: profile?.email ?? null,
        pay_id: payIdByUser.get(userId) ?? null,
        total_amount: Number(agg.amount.toFixed(2)),
        claim_ids: Array.from(agg.claim_ids),
        currency: agg.currency,
        claim_count: agg.claim_ids.size
      };
    })
    .sort((a, b) => b.total_amount - a.total_amount);

  if (action !== 'mark_paid') {
    return json({ ok: true, payouts });
  }

  if (!targetUserId || !aggregates.has(targetUserId)) {
    return json({ ok: false, error: 'user_not_eligible' }, { status: 400 });
  }

  const aggregate = aggregates.get(targetUserId)!;
  const claimIds = Array.from(aggregate.claim_ids).filter(Boolean);
  const payoutAmount = Number(aggregate.amount.toFixed(2));
  const payoutPayId = payIdByUser.get(targetUserId) ?? '';
  const paidAt = new Date().toISOString();
  const openRowIds = (openRows ?? [])
    .map((row) => row as PayoutRow)
    .filter((row) => String(row.user_id ?? '') === targetUserId)
    .map((row) => row.id);

  if (openRowIds.length === 0) {
    return json({ ok: false, error: 'user_not_eligible' }, { status: 400 });
  }

  const { error: updatePayoutsError } = await supabaseAdmin
    .from('payouts')
    .update({
      status: 'paid',
      pay_id: payoutPayId || null,
      paid_at: paidAt,
      updated_at: paidAt
    })
    .in('id', openRowIds);
  if (updatePayoutsError) {
    return json({ ok: false, error: updatePayoutsError.message }, { status: 500 });
  }

  let updatedClaimIds: string[] = [];
  const claimUpdates: { id: string; status: string }[] = [];
  if (claimIds.length > 0) {
    const { data: claimRows, error: claimRowsError } = await supabaseAdmin
      .from('claims')
      .select('id, status, submitter_id, referrer_id')
      .in('id', claimIds);
    if (claimRowsError) {
      return json({ ok: false, error: claimRowsError.message }, { status: 500 });
    }

    const byStatus = new Map<string, string[]>();
    for (const claim of (claimRows ?? []) as ClaimSettleRow[]) {
      const claimId = String(claim.id ?? '');
      if (!claimId) continue;
      const markGuestPaid = String(claim.submitter_id ?? '') === targetUserId;
      const markRefPaid = String(claim.referrer_id ?? '') === targetUserId;
      if (!markGuestPaid && !markRefPaid) continue;

      const currentStatus = (claim.status ?? 'paid') as ClaimPayoutStatus;
      const nextStatus = getNextClaimStatus(currentStatus, markGuestPaid, markRefPaid);
      if (!nextStatus || nextStatus === currentStatus) continue;

      const ids = byStatus.get(nextStatus) ?? [];
      ids.push(claimId);
      byStatus.set(nextStatus, ids);
      claimUpdates.push({ id: claimId, status: nextStatus });
    }

    for (const [status, ids] of byStatus) {
      const { error: updateClaimStatusError } = await supabaseAdmin
        .from('claims')
        .update({ status })
        .in('id', ids);
      if (updateClaimStatusError) {
        return json({ ok: false, error: updateClaimStatusError.message }, { status: 500 });
      }
      updatedClaimIds = [...updatedClaimIds, ...ids];
    }
  }

  try {
    await fetch('/api/notifications/payout-confirmation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: targetUserId,
        amount: payoutAmount,
        pay_id: payoutPayId,
        paid_at: paidAt
      })
    });
  } catch {}

  return json({
    ok: true,
    marked_user_id: targetUserId,
    marked_claims: updatedClaimIds.length,
    amount: payoutAmount,
    currency: aggregate.currency,
    pay_id: payoutPayId || null,
    paid_at: paidAt,
    claim_ids: updatedClaimIds,
    claim_updates: claimUpdates
  });
};
