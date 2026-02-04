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

async function stripePost(path: string, payload?: URLSearchParams) {
  const key = getStripeKey();
  if (!key) throw new Error('missing_stripe_key');
  const response = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: payload
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
      return json({ ok: false, error: 'missing_user_id' }, { status: 400 });
    }

    const { data: profile, error } = await supabaseAdmin
      .from('payout_profiles')
      .select('stripe_account_id')
      .eq('user_id', userId)
      .maybeSingle();
    if (error) {
      const msg = error.message || '';
      if (/does not exist/i.test(msg) && /stripe_account_id/i.test(msg)) {
        // Attempt backfill from Stripe if column missing
        try {
          const list = await stripeGet('accounts', { limit: 100 });
          const candidates: any[] = Array.isArray((list as any)?.data) ? (list as any).data : [];
          const match = candidates.find((acc: any) => {
            const md = acc?.metadata ?? {};
            return String(md?.app_user_id || '') === String(userId);
          });
          if (match?.id) {
            const foundId = match.id as string;
            try {
              await supabaseAdmin
                .from('payout_profiles')
                .upsert({ user_id: userId, stripe_account_id: foundId, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
            } catch {}
            const login = await stripePost(`accounts/${foundId}/login_links`);
            return json({ ok: true, url: login?.url });
          }
        } catch {}
        return json({ ok: false, error: 'not_connected' }, { status: 404 });
      }
      return json({ ok: false, error: msg }, { status: 500 });
    }
    let accountId = profile?.stripe_account_id ?? null;
    if (!accountId) {
      // Try to backfill account id from Stripe accounts list
      try {
        const list = await stripeGet('accounts', { limit: 100 });
        const candidates: any[] = Array.isArray((list as any)?.data) ? (list as any).data : [];
        const match = candidates.find((acc: any) => {
          const md = acc?.metadata ?? {};
          return String(md?.app_user_id || '') === String(userId);
        });
        if (match?.id) {
          accountId = match.id as string;
          try {
            await supabaseAdmin
              .from('payout_profiles')
              .upsert({ user_id: userId, stripe_account_id: accountId, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
          } catch {}
        }
      } catch {}
      if (!accountId) {
        return json({ ok: false, error: 'not_connected' }, { status: 404 });
      }
    }

    const login = await stripePost(`accounts/${accountId}/login_links`);
    return json({ ok: true, url: login?.url });
  } catch (error) {
    return json(
      { ok: false, error: error instanceof Error ? error.message : 'stripe_login_link_failed' },
      { status: 500 }
    );
  }
}
