import { json } from '@sveltejs/kit';
import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';
import { supabaseAdmin } from '$lib/server/supabaseAdmin';

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

async function stripeRequest(path: string, payload: Record<string, unknown> = {}) {
  const key = getStripeKey();
  if (!key) {
    throw new Error('missing_stripe_key');
  }
  const body = new URLSearchParams();
  Object.entries(payload).forEach(([key, value]) => {
    appendStripeParams(body, key, value);
  });

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

export async function POST(
  { request, url }: { request: Request; url: URL }
) {
  try {
    const body = await request.json().catch(() => null);
    const userId = body?.user_id as string | undefined;
    const email = body?.email as string | undefined;
    if (!userId) {
      return json({ ok: false, error: 'missing_user_id' }, { status: 400 });
    }
    const key = getStripeKey();
    if (!key) {
      return json({ ok: false, error: 'missing_stripe_key' }, { status: 500 });
    }

    const { data: existingProfile } = await supabaseAdmin
      .from('payout_profiles')
      .select('stripe_account_id')
      .eq('user_id', userId)
      .maybeSingle();
    let accountId = existingProfile?.stripe_account_id ?? null;

    if (!accountId) {
      const account = await stripeRequest('accounts', {
        type: 'express',
        country: 'AU',
        email: email || null,
        business_type: 'individual',
        business_profile: {
          mcc: '5969',
          product_description: 'I refer my friends to venues and receive a commission on their spend',
          url: null
        },
        capabilities: {
          card_payments: { requested: true },
          transfers: { requested: true }
        },
        metadata: {
          app_user_id: userId
        }
      });
      accountId = account?.id ?? null;
      if (!accountId) {
        return json({ ok: false, error: 'stripe_account_create_failed' }, { status: 500 });
      }
      await supabaseAdmin
        .from('payout_profiles')
        .upsert({ user_id: userId, stripe_account_id: accountId, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
    }

    const origin = url.origin;
    const returnUrl = `${origin}/#payouts-connected`;
    const refreshUrl = `${origin}/#payouts-refresh`;

    const accountLink = await stripeRequest('account_links', {
      account: accountId,
      type: 'account_onboarding',
      return_url: returnUrl,
      refresh_url: refreshUrl
    });

    return json({ ok: true, url: accountLink?.url, account_id: accountId });
  } catch (error) {
    return json(
      { ok: false, error: error instanceof Error ? error.message : 'stripe_connect_failed' },
      { status: 500 }
    );
  }
}
