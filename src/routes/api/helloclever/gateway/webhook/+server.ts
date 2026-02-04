import { json } from '@sveltejs/kit';
import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';
import { supabaseAdmin } from '$lib/server/supabaseAdmin';

function isPaidStatus(status: string | null): boolean {
  if (!status) return false;
  return /paid|success|completed/i.test(status);
}

function getStripeKey(): string | null {
  const key = dev ? env.PRIVATE_STRIPE_SECRET_KEY_SANDBOX : env.PRIVATE_STRIPE_SECRET_KEY_PROD;
  return key || null;
}

function appendStripeParams(params: URLSearchParams, key: string, value: unknown) {
  if (value === undefined || value === null || value === '') return;
  if (Array.isArray(value)) {
    value.forEach((v, i) => {
      if (v !== undefined && v !== null && v !== '') {
        params.append(`${key}[${i}]`, String(v));
      }
    });
    return;
  }
  if (typeof value === 'object') {
    Object.entries(value as Record<string, unknown>).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') {
        params.append(`${key}[${k}]`, String(v));
      }
    });
    return;
  }
  params.append(key, String(value));
}

async function stripeRequest(path: string, payload: Record<string, unknown>) {
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

async function settleClaims(venuePayment: any) {
  const venueId: string | null = venuePayment?.venue_id ?? null;
  const startIso: string | null = venuePayment?.week_start ?? null;
  const endIso: string | null = venuePayment?.week_end ?? null;
  if (!venueId || !startIso || !endIso) return;

  const { data: claims, error } = await supabaseAdmin
    .from('claims')
    .select('id, amount, kickback_guest_rate, kickback_referrer_rate, status, submitter_id, referrer_id, purchased_at')
    .eq('venue_id', venueId)
    .or('status.is.null,status.eq.approved')
    .gte('purchased_at', startIso)
    .lt('purchased_at', endIso);
  if (error) throw error;

  const items = (claims ?? []).filter((c) => (c?.status ?? 'approved') !== 'denied');
  for (const claim of items) {
    const amount = Number(claim.amount ?? 0);
    const guestRate = Number(claim.kickback_guest_rate ?? 5);
    const referrerRate = Number(claim.kickback_referrer_rate ?? 5);
    const guestCents = Math.round((amount * guestRate) / 100 * 100);
    const referrerCents = Math.round((amount * referrerRate) / 100 * 100);

    const transfers: { type: 'guest' | 'referrer'; userId: string; cents: number }[] = [];
    if (claim.submitter_id && guestCents > 0) {
      transfers.push({ type: 'guest', userId: claim.submitter_id as string, cents: guestCents });
    }
    if (claim.referrer_id && referrerCents > 0) {
      transfers.push({ type: 'referrer', userId: claim.referrer_id as string, cents: referrerCents });
    }

    for (const t of transfers) {
      const { data: profile } = await supabaseAdmin
        .from('payout_profiles')
        .select('stripe_account_id')
        .eq('user_id', t.userId)
        .maybeSingle();
      const destination = profile?.stripe_account_id ?? null;
      if (!destination) continue;
      try {
        await stripeRequest('transfers', {
          amount: t.cents,
          currency: 'aud',
          destination,
          description: `Kickback ${t.type} settlement`,
          metadata: {
            venue_id: venueId,
            claim_id: claim.id ?? null,
            type: t.type
          }
        });
      } catch (err) {
        // Continue other items; transfers may fail if platform has insufficient Stripe balance
        console.error('stripe_transfer_failed', {
          user_id: t.userId,
          destination,
          cents: t.cents,
          error: err instanceof Error ? err.message : String(err)
        });
      }
    }

    if (claim.id) {
      await supabaseAdmin.from('claims').update({ status: 'paid' }).eq('id', claim.id);
    }
  }
}

export async function POST({ request }) {
  const webhookSecret = dev
    ? env.PRIVATE_HELLOCLEVER_WEBHOOK_SECRET_SANDBOX
    : env.PRIVATE_HELLOCLEVER_WEBHOOK_SECRET_PROD;
  const authHeader = request.headers.get('authorization') ?? '';
  const expected = `Bearer ${webhookSecret}`;
  if (!webhookSecret || authHeader !== expected) {
    return json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  const payload = await request.json().catch(() => null);
  const paymentId = payload?.payment_id ?? null;
  const orderId = payload?.order_id ?? null;
  const status = payload?.status ?? null;

  if (!paymentId && !orderId) {
    return json({ ok: false, error: 'missing_identifier' }, { status: 400 });
  }

  const updates: Record<string, string | null> = {
    status,
    updated_at: new Date().toISOString()
  };

  if (isPaidStatus(status)) {
    updates.paid_at = new Date().toISOString();
  }

  let updated = null;
  if (paymentId) {
    const { data, error } = await supabaseAdmin
      .from('venue_payment_requests')
      .update(updates)
      .eq('payment_id', paymentId)
      .select()
      .maybeSingle();
    if (error) {
      return json({ ok: false, error: error.message }, { status: 500 });
    }
    updated = data;
  }

  if (!updated && orderId) {
    const { data, error } = await supabaseAdmin
      .from('venue_payment_requests')
      .update(updates)
      .eq('order_id', orderId)
      .select()
      .maybeSingle();
    if (error) {
      return json({ ok: false, error: error.message }, { status: 500 });
    }
    updated = data;
  }

  if (updated && isPaidStatus(status)) {
    try {
      await settleClaims(updated);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('settlement_failed', { error: msg, payment_request_id: updated?.id ?? null });
    }
  }

  return json({ ok: true });
}
