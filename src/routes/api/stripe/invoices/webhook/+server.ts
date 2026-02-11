import { json } from '@sveltejs/kit';
import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';
import { supabaseAdmin } from '$lib/server/supabaseAdmin';
import crypto from 'node:crypto';

function getWebhookSecrets(): string[] {
  const secrets: string[] = [];
  const prod = env.PRIVATE_STRIPE_WEBHOOK_SECRET_PROD ?? null;
  const test = env.PRIVATE_STRIPE_WEBHOOK_SECRET_SANDBOX ?? null;
  if (prod) secrets.push(prod);
  if (test) secrets.push(test);
  return secrets;
}

function getStripeKey(): string | null {
  if (dev) return env.PRIVATE_STRIPE_SECRET_KEY_SANDBOX ?? null;
  return env.PRIVATE_STRIPE_SECRET_KEY_PROD ?? null;
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

async function settleClaimsForRange(venueId: string, startIso: string, endIso: string) {
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
      } catch {}
    }

    if (claim.id) {
      await supabaseAdmin.from('claims').update({ status: 'paid' }).eq('id', claim.id);
    }
  }
}

function parseStripeSignature(header: string | null) {
  if (!header) return null;
  const parts = header.split(',').map((p) => p.trim());
  const t = parts.find((p) => p.startsWith('t='))?.slice(2) ?? null;
  const v1 = parts.find((p) => p.startsWith('v1='))?.slice(3) ?? null;
  if (!t || !v1) return null;
  return { t, v1 };
}

function verifySignature(secret: string, timestamp: string, rawBody: string, expectedV1: string): boolean {
  const signedPayload = `${timestamp}.${rawBody}`;
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(signedPayload, 'utf8');
  const computed = hmac.digest('hex');
  return crypto.timingSafeEqual(Buffer.from(computed, 'utf8'), Buffer.from(expectedV1, 'utf8'));
}

export async function POST({ request }) {
  try {
    const secrets = getWebhookSecrets();
    if (!secrets || secrets.length === 0) {
      return json({ ok: false, error: 'missing_webhook_secret' }, { status: 500 });
    }
    const raw = await request.text();
    const sigHeader = request.headers.get('stripe-signature');
    const parsed = parseStripeSignature(sigHeader);
    const valid = parsed ? secrets.some((s) => verifySignature(s, parsed.t, raw, parsed.v1)) : false;
    if (!parsed || !valid) {
      return json({ ok: false, error: 'invalid_signature' }, { status: 401 });
    }
    const event = JSON.parse(raw);
    const type = event?.type ?? '';
    const obj = event?.data?.object ?? null;
    const paidTypes = new Set(['invoice.payment_succeeded', 'invoice.paid']);
    if (!paidTypes.has(type) || !obj) {
      return json({ ok: true });
    }
    const invoiceId: string | null = obj?.id ?? null;
    let venueId: string | null = obj?.metadata?.venue_id ?? null;
    let startIso: string | null = obj?.metadata?.week_start ?? null;
    let endIso: string | null = obj?.metadata?.week_end ?? null;
    if ((!venueId || !startIso || !endIso) && invoiceId) {
      const { data: vi } = await supabaseAdmin
        .from('venue_invoices')
        .select('venue_id, week_start, week_end')
        .eq('stripe_invoice_id', invoiceId)
        .maybeSingle();
      venueId = venueId ?? (vi?.venue_id ?? null);
      startIso = startIso ?? (vi?.week_start ?? null);
      endIso = endIso ?? (vi?.week_end ?? null);
    }
    if (!venueId || !startIso || !endIso) {
      return json({ ok: false, error: 'missing_invoice_metadata' }, { status: 400 });
    }
    await settleClaimsForRange(venueId, startIso, endIso);
    return json({ ok: true });
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : 'stripe_webhook_failed' }, { status: 500 });
  }
}
