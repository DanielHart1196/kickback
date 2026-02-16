import { json, type RequestHandler } from '@sveltejs/kit';
import { supabaseAdmin } from '$lib/server/supabaseAdmin';

type BalanceRow = {
  id: string;
  user_id: string | null;
  amount: number | null;
  currency: string | null;
  claim_ids: string[] | null;
  claim_count: number | null;
  pay_id: string | null;
  paid_at: string | null;
  created_at: string | null;
};

export const GET: RequestHandler = async ({ request }) => {
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

  const { data: rows, error } = await supabaseAdmin
    .from('payouts')
    .select('id, user_id, amount, currency, claim_ids, claim_count, pay_id, paid_at, created_at')
    .eq('status', 'paid')
    .order('paid_at', { ascending: false })
    .limit(5000);
  if (error) {
    return json({ ok: false, error: error.message }, { status: 500 });
  }
  const payoutsRows = (rows ?? []) as BalanceRow[];
  const userIds = Array.from(new Set(payoutsRows.map((row) => String(row.user_id ?? '')).filter(Boolean)));
  const [{ data: profiles }, { data: payoutProfiles }] = await Promise.all([
    userIds.length > 0
      ? supabaseAdmin.from('profiles').select('id, referral_code, email').in('id', userIds)
      : Promise.resolve({ data: [] as any[] }),
    userIds.length > 0
      ? supabaseAdmin.from('payout_profiles').select('user_id, pay_id').in('user_id', userIds)
      : Promise.resolve({ data: [] as any[] })
  ]);

  const profileById = new Map((profiles ?? []).map((p) => [String(p.id), p]));
  const payIdByUser = new Map((payoutProfiles ?? []).map((p) => [String(p.user_id), String(p.pay_id ?? '')]));

  const payouts = payoutsRows
    .map((entry) => {
      const userId = String(entry.user_id ?? '');
      const profile = profileById.get(userId);
      const fallbackPayId = payIdByUser.get(userId) ?? '';
      const claimIds = (Array.isArray(entry.claim_ids) ? entry.claim_ids : []).map((id) => String(id));
      return {
        id: entry.id,
        user_id: userId,
        referral_code: profile?.referral_code ?? null,
        email: profile?.email ?? null,
        pay_id: entry.pay_id || fallbackPayId || null,
        amount: Number(Number(entry.amount ?? 0).toFixed(2)),
        currency: String(entry.currency ?? 'aud').toLowerCase(),
        paid_at: entry.paid_at ?? entry.created_at ?? new Date().toISOString(),
        claim_count: Number(entry.claim_count ?? claimIds.length ?? 0)
      };
    })
    .sort((a, b) => new Date(b.paid_at).getTime() - new Date(a.paid_at).getTime());

  return json({ ok: true, payouts });
};
