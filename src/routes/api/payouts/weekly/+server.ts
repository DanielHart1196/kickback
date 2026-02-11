import { json } from '@sveltejs/kit';
import { supabaseAdmin } from '$lib/server/supabaseAdmin';

export async function GET({ url }) {
  try {
    const minStr = url.searchParams.get('min') ?? '20';
    const min = Number(minStr);
    const currency = (url.searchParams.get('currency') ?? 'aud').toLowerCase();
    const { data, error } = await supabaseAdmin
      .from('user_balances')
      .select('user_id, amount, currency, status')
      .eq('status', 'available')
      .eq('currency', currency)
      .order('created_at', { ascending: false })
      .limit(10000);
    if (error) {
      return json({ ok: false, error: error.message }, { status: 500 });
    }
    const totals = new Map<string, number>();
    for (const row of data ?? []) {
      const uid = String(row.user_id || '');
      const amt = Number(row.amount || 0);
      totals.set(uid, (totals.get(uid) ?? 0) + amt);
    }
    const payouts = Array.from(totals.entries())
      .filter(([, sum]) => sum >= min)
      .map(([user_id, sum]) => ({ user_id, amount: Number(sum.toFixed(2)), currency }));

    const { data: profiles } = await supabaseAdmin
      .from('payout_profiles')
      .select('user_id, stripe_account_id')
      .in(
        'user_id',
        payouts.map((p) => p.user_id)
      );
    const accountByUser = new Map<string, string>();
    for (const p of profiles ?? []) {
      if (p?.user_id && p?.stripe_account_id) {
        accountByUser.set(String(p.user_id), String(p.stripe_account_id));
      }
    }
    const enriched = payouts.map((p) => ({
      ...p,
      stripe_account_id: accountByUser.get(p.user_id) ?? null
    }));
    return json({ ok: true, payouts: enriched });
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : 'weekly_payouts_failed' }, { status: 500 });
  }
}
