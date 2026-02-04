import { json } from '@sveltejs/kit';
import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';
import { supabaseAdmin } from '$lib/server/supabaseAdmin';

function getStripeKey(): string | null {
  if (dev) return env.PRIVATE_STRIPE_SECRET_KEY_SANDBOX ?? null;
  return env.PRIVATE_STRIPE_SECRET_KEY_PROD ?? null;
}

async function stripeGet(path: string, query: Record<string, unknown> = {}) {
  const key = getStripeKey();
  if (!key) throw new Error('missing_stripe_key');
  const params = new URLSearchParams();
  Object.entries(query).forEach(([k, v]) => {
    if (v === undefined || v === null || v === '') return;
    if (typeof v === 'object' && !Array.isArray(v)) {
      Object.entries(v as Record<string, unknown>).forEach(([ik, iv]) => {
        if (iv !== undefined && iv !== null && iv !== '') {
          params.append(`${k}[${ik}]`, String(iv));
        }
      });
    } else {
      params.append(k, String(v));
    }
  });
  const url = params.toString()
    ? `https://api.stripe.com/v1/${path}?${params.toString()}`
    : `https://api.stripe.com/v1/${path}`;
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${key}`
    }
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const message = data?.error?.message ?? `stripe_${response.status}`;
    throw new Error(message);
  }
  return data;
}

export async function POST({ request }: { request: Request }) {
  try {
    const body = await request.json().catch(() => null);
    const userId = body?.user_id as string | undefined;
    if (!userId) {
      console.error('stripe_status: missing_user_id');
      return json({ ok: false, error: 'missing_user_id' }, { status: 400 });
    }

    const { data: profile, error } = await supabaseAdmin
      .from('payout_profiles')
      .select('stripe_account_id')
      .eq('user_id', userId)
      .maybeSingle();
    if (error) {
      const msg = error.message || '';
      console.error('stripe_status: supabase error', { userId, error: msg });
      if (/does not exist/i.test(msg) && /stripe_account_id/i.test(msg)) {
        console.warn('stripe_status: missing stripe_account_id column, treating as not connected', { userId });
        return json({ ok: true, onboarded: false, account_id: null });
      }
      return json({ ok: false, error: msg }, { status: 500 });
    }

    const accountId = profile?.stripe_account_id ?? null;
    if (!accountId) {
      console.warn('stripe_status: no stripe_account_id for user', { userId });
      try {
        const list = await stripeGet('accounts', { limit: 100 });
        const candidates: any[] = Array.isArray((list as any)?.data) ? (list as any).data : [];
        const match = candidates.find((acc: any) => {
          const md = acc?.metadata ?? {};
          return String(md?.app_user_id || '') === String(userId);
        });
        if (match?.id) {
          const foundId = match.id as string;
          console.info('stripe_status: backfilled account id from stripe list', { userId, accountId: foundId });
          await supabaseAdmin
            .from('payout_profiles')
            .upsert({ user_id: userId, stripe_account_id: foundId, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
          const account = await stripeGet(`accounts/${foundId}`);
          const onboarded = Boolean((account as any)?.details_submitted);
          if (!onboarded) {
            console.warn('stripe_status: backfilled account not onboarded yet', { userId, accountId: foundId, details_submitted: (account as any)?.details_submitted ?? null });
          }
          return json({ ok: true, onboarded, account_id: foundId });
        }
        if (dev && candidates.length === 1 && candidates[0]?.id) {
          const fallbackId = candidates[0].id as string;
          console.warn('stripe_status: dev fallback to single account', { userId, account_id: fallbackId });
          await supabaseAdmin
            .from('payout_profiles')
            .upsert({ user_id: userId, stripe_account_id: fallbackId, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
          const account = await stripeGet(`accounts/${fallbackId}`);
          const onboarded = Boolean((account as any)?.details_submitted);
          return json({ ok: true, onboarded, account_id: fallbackId });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('stripe_status: backfill attempt failed', { userId, error: msg });
      }
      return json({ ok: true, onboarded: false, account_id: null });
    }

    let account: any = null;
    try {
      account = await stripeGet(`accounts/${accountId}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('stripe_status: stripeGet failed', { userId, accountId, error: msg });
      return json({ ok: false, error: msg }, { status: 502 });
    }
    const onboarded = Boolean(account?.details_submitted);
    if (!onboarded) {
      console.warn('stripe_status: account not onboarded yet', { userId, accountId, details_submitted: account?.details_submitted ?? null });
    }
    return json({ ok: true, onboarded, account_id: accountId });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'stripe_status_failed';
    console.error('stripe_status: unhandled error', msg);
    return json(
      { ok: false, error: msg },
      { status: 500 }
    );
  }
}
