import { json } from '@sveltejs/kit';
import { dev } from '$app/environment';
import { supabaseAdmin } from '$lib/server/supabaseAdmin';
import { env } from '$env/dynamic/private';

function getStripeKey(): string | null {
  if (dev) return env.PRIVATE_STRIPE_SECRET_KEY_SANDBOX ?? null;
  return env.PRIVATE_STRIPE_SECRET_KEY_PROD ?? null;
}

function appendStripeParams(params: URLSearchParams, prefix: string, value: unknown) {
  if (value === undefined || value === null || value === '') return;
  if (typeof value === 'object' && !Array.isArray(value)) {
    Object.entries(value as Record<string, unknown>).forEach(([key, inner]) => {
      appendStripeParams(params, `${prefix}[${key}]`, inner);
    });
    return;
  }
  params.append(prefix, String(value));
}

async function stripePost(path: string, payload: Record<string, unknown> = {}) {
  const key = getStripeKey();
  if (!key) throw new Error('missing_stripe_key');
  const body = new URLSearchParams();
  Object.entries(payload).forEach(([k, v]) => appendStripeParams(body, k, v));
  const response = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const message = data?.error?.message ?? `stripe_${response.status}`;
    throw new Error(message);
  }
  return data;
}

export async function POST({ request }) {
  try {
    const body = await request.json().catch(() => null);
    const userId: string | undefined = typeof body?.user_id === 'string' ? body.user_id : undefined;
    const currency: string = typeof body?.currency === 'string' ? String(body.currency).toLowerCase() : 'aud';
    if (!userId) {
      return json({ ok: false, error: 'missing_user_id' }, { status: 400 });
    }

    const { data: profile } = await supabaseAdmin
      .from('payout_profiles')
      .select('stripe_account_id')
      .eq('user_id', userId)
      .maybeSingle();
    const destination = profile?.stripe_account_id ?? null;
    if (!destination) {
      return json({ ok: false, error: 'missing_stripe_destination' }, { status: 400 });
    }

    const { data: rows, error: rowsError } = await supabaseAdmin
      .from('user_balances')
      .select('id, amount')
      .eq('user_id', userId)
      .eq('status', 'venuepaid')
      .eq('currency', currency)
      .limit(10000);
    if (rowsError) {
      return json({ ok: false, error: rowsError.message }, { status: 500 });
    }
    const total = Number((rows ?? []).reduce((sum, r) => sum + Number(r.amount ?? 0), 0));
    if (!(total > 0)) {
      return json({ ok: false, error: 'no_available_balance' }, { status: 400 });
    }
    const cents = Math.round(total * 100);

    await stripePost('transfers', {
      amount: cents,
      currency,
      destination,
      description: 'Kickback weekly payout',
      metadata: { user_id: userId }
    });

    const ids = (rows ?? []).map((r) => r.id).filter(Boolean);
    let updated = 0;
    if (ids.length > 0) {
      const { error: upErr } = await supabaseAdmin
        .from('user_balances')
        .update({ status: 'available', created_at: new Date().toISOString() })
        .in('id', ids as string[]);
      if (!upErr) {
        updated = ids.length;
      }
    }
    return json({ ok: true, transferred: total, currency, updated_rows: updated });
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : 'transfer_failed' }, { status: 500 });
  }
}
