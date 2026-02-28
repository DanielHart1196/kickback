import { json, type RequestHandler } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { supabaseAdmin } from '$lib/server/supabaseAdmin';

type EarningRow = {
  id: string;
  user_id: string | null;
  amount: number | null;
  status: string | null;
  claim_id: string | number | null;
  role: string | null;
  venue_id: string | null;
};

type Aggregate = {
  user_id: string;
  amount: number;
  currency: string;
  claim_ids: Set<string>;
  earning_ids: Set<string>;
};

type Breakdown = {
  cashback: number;
  referral_rewards: number;
  venue_totals: Map<string, number>;
};

function addAmount(
  map: Map<string, Aggregate>,
  userId: string,
  amount: number,
  currency: string,
  claimId: string,
  earningId: string
) {
  const existing = map.get(userId);
  if (existing) {
    existing.amount += amount;
    if (claimId) existing.claim_ids.add(claimId);
    if (earningId) existing.earning_ids.add(earningId);
    return;
  }
  map.set(userId, {
    user_id: userId,
    amount,
    currency,
    claim_ids: new Set(claimId ? [claimId] : []),
    earning_ids: new Set(earningId ? [earningId] : [])
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

  const { data: scheduledRows, error: scheduledError } = await supabaseAdmin
    .from('earnings')
    .select('id, user_id, amount, status, claim_id, role, venue_id')
    .eq('status', 'scheduled')
    .order('created_at', { ascending: true });
  if (scheduledError) {
    return json({ ok: false, error: scheduledError.message }, { status: 500 });
  }

  const aggregates = new Map<string, Aggregate>();
  const breakdownByUser = new Map<string, Breakdown>();
  const venueIds = new Set<string>();
  for (const row of (scheduledRows ?? []) as EarningRow[]) {
    const userId = String(row.user_id ?? '');
    if (!userId) continue;
    const amount = Number(row.amount ?? 0);
    if (!Number.isFinite(amount) || amount <= 0) continue;
    const claimId = row.claim_id != null ? String(row.claim_id) : '';
    const earningId = String(row.id ?? '');
    addAmount(aggregates, userId, amount, 'aud', claimId, earningId);
    const breakdown = breakdownByUser.get(userId) ?? {
      cashback: 0,
      referral_rewards: 0,
      venue_totals: new Map<string, number>()
    };
    if (row.role === 'guest') breakdown.cashback += amount;
    if (row.role === 'referrer') breakdown.referral_rewards += amount;
    if (row.venue_id) {
      const venueKey = String(row.venue_id);
      const current = breakdown.venue_totals.get(venueKey) ?? 0;
      breakdown.venue_totals.set(venueKey, current + amount);
      venueIds.add(venueKey);
    }
    breakdownByUser.set(userId, breakdown);
  }

  const userIds = Array.from(aggregates.keys());
  if (userIds.length === 0) {
    return json({ ok: true, payouts: [] });
  }

  const [{ data: profiles }, { data: payoutProfiles }, { data: venues }] = await Promise.all([
    supabaseAdmin.from('profiles').select('id, referral_code, email, notify_payout_confirmation').in('id', userIds),
    supabaseAdmin.from('payout_profiles').select('user_id, pay_id, bsb, account_number, payout_method').in('user_id', userIds)
    ,
    venueIds.size > 0
      ? supabaseAdmin.from('venues').select('id, name').in('id', Array.from(venueIds))
      : Promise.resolve({ data: [], error: null } as { data: any[]; error: any })
  ]);

  const profileById = new Map((profiles ?? []).map((p) => [String(p.id), p]));
  const payIdByUser = new Map((payoutProfiles ?? []).map((p) => [String(p.user_id), String(p.pay_id ?? '')]));
  const bsbByUser = new Map((payoutProfiles ?? []).map((p) => [String(p.user_id), String(p.bsb ?? '')]));
  const accountByUser = new Map((payoutProfiles ?? []).map((p) => [String(p.user_id), String(p.account_number ?? '')]));
  const methodByUser = new Map((payoutProfiles ?? []).map((p) => [String(p.user_id), String(p.payout_method ?? '')]));
  const venueNameById = new Map((venues ?? []).map((v: any) => [String(v.id), String(v.name ?? '')]));
  const payoutEmailsConfigured = Boolean(env.PRIVATE_SMTP_PASS);

  const payouts = userIds
    .map((userId) => {
      const agg = aggregates.get(userId)!;
      const profile = profileById.get(userId);
      const breakdown = breakdownByUser.get(userId);
      const payoutEmailEnabled = Boolean(
        payoutEmailsConfigured &&
        profile?.email &&
        profile?.notify_payout_confirmation
      );
      return {
        user_id: userId,
        referral_code: profile?.referral_code ?? null,
        email: profile?.email ?? null,
        notify_payout_confirmation: Boolean(profile?.notify_payout_confirmation),
        payout_email_enabled: payoutEmailEnabled,
        pay_id: payIdByUser.get(userId) ?? null,
        bsb: bsbByUser.get(userId) ?? null,
        account_number: accountByUser.get(userId) ?? null,
        payout_method: methodByUser.get(userId) ?? null,
        total_amount: Number(agg.amount.toFixed(2)),
        claim_ids: Array.from(agg.claim_ids),
        currency: agg.currency,
        claim_count: agg.claim_ids.size,
        breakdown: breakdown
          ? {
              cashback: Number(breakdown.cashback.toFixed(2)),
              referral_rewards: Number(breakdown.referral_rewards.toFixed(2)),
              venue_totals: Array.from(breakdown.venue_totals.entries())
                .map(([venue_id, total_amount]) => ({
                  venue_id,
                  venue_name: venueNameById.get(String(venue_id)) ?? null,
                  total_amount: Number(total_amount.toFixed(2))
                }))
                .sort((a, b) => b.total_amount - a.total_amount)
            }
          : null
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
  const payoutBsb = bsbByUser.get(targetUserId) ?? '';
  const payoutAccountNumber = accountByUser.get(targetUserId) ?? '';
  const payoutMethod = methodByUser.get(targetUserId) ?? '';
  const paidAt = new Date().toISOString();

  const { data: scheduledUpdate, error: scheduledUpdateError } = await supabaseAdmin
    .from('earnings')
    .update({ status: 'paid', paid_at: paidAt })
    .eq('user_id', targetUserId)
    .eq('status', 'scheduled')
    .select('id');
  if (scheduledUpdateError) {
    return json({ ok: false, error: scheduledUpdateError.message }, { status: 500 });
  }

  const { data: unpaidUpdate, error: unpaidUpdateError } = await supabaseAdmin
    .from('earnings')
    .update({ status: 'scheduled' })
    .eq('user_id', targetUserId)
    .eq('status', 'unpaid')
    .select('id');
  if (unpaidUpdateError) {
    return json({ ok: false, error: unpaidUpdateError.message }, { status: 500 });
  }

  const { error: payoutInsertError } = await supabaseAdmin.from('payouts').insert({
    user_id: targetUserId,
    amount: payoutAmount,
    currency: aggregate.currency,
    claim_ids: claimIds,
    claim_count: claimIds.length,
    status: 'paid',
    pay_id: payoutPayId || null,
    bsb: payoutBsb || null,
    account_number: payoutAccountNumber || null,
    payout_method: payoutMethod || null,
    paid_at: paidAt,
    updated_at: paidAt
  });
  if (payoutInsertError) {
    return json({ ok: false, error: payoutInsertError.message }, { status: 500 });
  }

  return json({
    ok: true,
    paid_at: paidAt,
    paid_earnings: scheduledUpdate?.length ?? 0,
    promoted_earnings: unpaidUpdate?.length ?? 0
  });
};
