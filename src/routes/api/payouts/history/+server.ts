import { json, type RequestHandler } from '@sveltejs/kit';
import { supabaseAdmin } from '$lib/server/supabaseAdmin';

type HistoryRow = {
  source_invoice_id: string | null;
  source_charge_id: string | null;
  amount: number | null;
  currency: string | null;
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

  const userId = requesterData.user.id;
  const { data: rows, error } = await supabaseAdmin
    .from('user_balances')
    .select('source_invoice_id, source_charge_id, amount, currency, created_at')
    .eq('user_id', userId)
    .eq('status', 'paidout')
    .order('created_at', { ascending: false })
    .limit(1000);

  if (error) {
    return json({ ok: false, error: error.message }, { status: 500 });
  }

  const grouped = new Map<
    string,
    {
      id: string;
      amount: number;
      currency: string;
      paid_at: string;
      pay_id: string;
    }
  >();

  for (const row of (rows ?? []) as HistoryRow[]) {
    const paidAt = row.created_at ?? new Date().toISOString();
    const key = row.source_invoice_id ?? `single_${paidAt}`;
    const existing = grouped.get(key);
    if (existing) {
      existing.amount += Number(row.amount ?? 0);
      continue;
    }
    grouped.set(key, {
      id: key,
      amount: Number(row.amount ?? 0),
      currency: String(row.currency ?? 'aud').toLowerCase(),
      paid_at: paidAt,
      pay_id: String(row.source_charge_id ?? '')
    });
  }

  const payouts = Array.from(grouped.values())
    .map((entry) => ({ ...entry, amount: Number(entry.amount.toFixed(2)) }))
    .sort((a, b) => new Date(b.paid_at).getTime() - new Date(a.paid_at).getTime());

  return json({ ok: true, payouts });
};
