import { json } from '@sveltejs/kit';
import { supabaseAdmin } from '$lib/server/supabaseAdmin';

type Totals = {
  pending: number;
  approved: number;
  available: number;
  paid: number;
};

export async function POST() {
  try {
    const { data: balances, error: balError } = await supabaseAdmin
      .from('user_balances')
      .select('user_id, amount, status, currency')
      .order('created_at', { ascending: false })
      .limit(100000);
    if (balError) {
      return json({ ok: false, error: balError.message }, { status: 500 });
    }

    const byUser = new Map<string, Totals>();
    const ensure = (userId: string) => {
      const k = String(userId);
      if (!byUser.has(k)) byUser.set(k, { pending: 0, approved: 0, available: 0, paid: 0 });
      return byUser.get(k)!;
    };

    for (const row of balances ?? []) {
      if (!row?.user_id) continue;
      const amt = Number(row?.amount ?? 0);
      if (!(amt > 0)) continue;
      const status = String(row?.status ?? 'approved');
      const t = ensure(String(row.user_id));
      if (status === 'pending') t.pending += amt;
      else if (status === 'approved' || status === 'venuepaid') t.approved += amt;
      else if (status === 'available') t.available += amt;
      else if (status === 'paid') t.paid += amt;
    }

    let updated = 0;
    let failed = 0;

    for (const [userId, totals] of byUser.entries()) {
      const { error } = await supabaseAdmin
        .from('profiles')
        .update({
          pending_balance: Number(totals.pending.toFixed(2)),
          approved_balance: Number(totals.approved.toFixed(2)),
          available_balance: Number(totals.available.toFixed(2)),
          paid_balance: Number(totals.paid.toFixed(2))
        })
        .eq('id', userId);
      if (!error) updated += 1;
      else failed += 1;
    }

    return json({ ok: true, updated, failed, users: byUser.size });
  } catch (error) {
    const message = error instanceof Error ? error.message || 'profiles_backfill_failed' : 'profiles_backfill_failed';
    return json({ ok: false, error: message }, { status: 500 });
  }
}
