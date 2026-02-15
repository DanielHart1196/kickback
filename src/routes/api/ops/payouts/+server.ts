import { json, type RequestHandler } from '@sveltejs/kit';
import { supabaseAdmin } from '$lib/server/supabaseAdmin';

type PaidClaim = {
  id: string;
  amount: number;
  kickback_guest_rate: number | null;
  kickback_referrer_rate: number | null;
  submitter_id: string | null;
  referrer_id: string | null;
};

type Aggregate = {
  user_id: string;
  amount: number;
  claim_ids: Set<string>;
};

function addAmount(map: Map<string, Aggregate>, userId: string, amount: number, claimId: string) {
  const existing = map.get(userId);
  if (existing) {
    existing.amount += amount;
    existing.claim_ids.add(claimId);
    return;
  }
  map.set(userId, { user_id: userId, amount, claim_ids: new Set([claimId]) });
}

function calculateClaimSplit(claim: PaidClaim) {
  const amount = Number(claim.amount ?? 0);
  const guestRate = Number(claim.kickback_guest_rate ?? 5) / 100;
  const refRate = Number(claim.kickback_referrer_rate ?? 5) / 100;
  return {
    guestAmount: Number((amount * guestRate).toFixed(2)),
    refAmount: Number((amount * refRate).toFixed(2))
  };
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

  const { data: paidClaims, error: claimsError } = await supabaseAdmin
    .from('claims')
    .select('id, amount, kickback_guest_rate, kickback_referrer_rate, submitter_id, referrer_id')
    .eq('status', 'paid');
  if (claimsError) {
    return json({ ok: false, error: claimsError.message }, { status: 500 });
  }

  const aggregates = new Map<string, Aggregate>();
  for (const claim of (paidClaims ?? []) as PaidClaim[]) {
    if (!claim?.id) continue;
    const { guestAmount, refAmount } = calculateClaimSplit(claim);
    if (claim.submitter_id && guestAmount > 0) {
      addAmount(aggregates, String(claim.submitter_id), guestAmount, String(claim.id));
    }
    if (claim.referrer_id && refAmount > 0) {
      addAmount(aggregates, String(claim.referrer_id), refAmount, String(claim.id));
    }
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
        pay_id: payIdByUser.get(userId) ?? null,
        total_amount: Number(agg.amount.toFixed(2)),
        claim_ids: Array.from(agg.claim_ids),
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
  const claimIds = Array.from(aggregate.claim_ids);
  const payoutAmount = Number(aggregate.amount.toFixed(2));
  const payoutPayId = payIdByUser.get(targetUserId) ?? '';
  const paidAt = new Date().toISOString();
  const batchId = `payout_${Date.now()}_${targetUserId.slice(0, 8)}`;

  const { error: markClaimsError } = await supabaseAdmin
    .from('claims')
    .update({ status: 'paidout' })
    .in('id', claimIds);
  if (markClaimsError) {
    return json({ ok: false, error: markClaimsError.message }, { status: 500 });
  }

  await supabaseAdmin
    .from('user_balances')
    .update({
      status: 'paidout',
      source_invoice_id: batchId,
      source_charge_id: payoutPayId || null,
      created_at: paidAt
    })
    .eq('user_id', targetUserId)
    .in('claim_id', claimIds);

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
    marked_claims: claimIds.length,
    amount: payoutAmount,
    pay_id: payoutPayId || null,
    paid_at: paidAt,
    claim_ids: claimIds
  });
};
