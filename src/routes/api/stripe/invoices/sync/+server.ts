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

async function stripeGet(path: string, query: Record<string, unknown> = {}) {
  const key = getStripeKey();
  if (!key) {
    throw new Error('missing_stripe_key');
  }
  const params = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => {
    appendStripeParams(params, key, value);
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

export async function GET({ url }) {
  try {
    const venueId = url.searchParams.get('venue_id') ?? undefined;
    if (!venueId) {
      return json({ ok: false, error: 'missing_venue_id' }, { status: 400 });
    }

    const { data: venue, error: venueError } = await supabaseAdmin
      .from('venues')
      .select('id, billing_email, stripe_customer_id')
      .eq('id', venueId)
      .maybeSingle();
    if (venueError || !venue) {
      return json({ ok: false, error: venueError?.message ?? 'venue_not_found' }, { status: 404 });
    }

    let stripeCustomerId = venue.stripe_customer_id ?? null;
    if (!stripeCustomerId && venue.billing_email) {
      try {
        const search = await stripeGet('customers/search', { query: `email:"${venue.billing_email}"` });
        const candidate = (search?.data ?? []).find((c: any) => (c?.email ?? '').toLowerCase() === venue.billing_email.toLowerCase());
        if (candidate?.id) {
          stripeCustomerId = candidate.id;
          await supabaseAdmin.from('venues').update({ stripe_customer_id: stripeCustomerId }).eq('id', venue.id);
        }
      } catch {}
    }
    if (!stripeCustomerId) {
      return json({ ok: false, error: 'missing_stripe_customer', inserted: 0, updated: 0 }, { status: 200 });
    }

    const invoices = await stripeGet('invoices', { customer: stripeCustomerId, limit: 20 });
    const list = Array.isArray(invoices?.data) ? invoices.data : [];

    let inserted = 0;
    let updated = 0;

    for (const inv of list) {
      const stripeId = inv?.id ?? null;
      const hostedUrl = inv?.hosted_invoice_url ?? null;
      const status = inv?.status ?? null;
      const meta = inv?.metadata ?? {};
      const weekStart = typeof meta?.week_start === 'string' ? meta.week_start : null;
      const weekEnd = typeof meta?.week_end === 'string' ? meta.week_end : null;
      if (!stripeId) continue;

      const { data: existing } = await supabaseAdmin
        .from('venue_invoices')
        .select('id, stripe_invoice_url, status')
        .eq('venue_id', venue.id)
        .eq('stripe_invoice_id', stripeId)
        .maybeSingle();

      if (!existing?.id) {
        const { error: insertError } = await supabaseAdmin.from('venue_invoices').insert({
          venue_id: venue.id,
          week_start: weekStart,
          week_end: weekEnd,
          subtotal: null,
          total: null,
          gst: 0,
          stripe_invoice_id: stripeId,
          stripe_invoice_url: hostedUrl,
          status
        });
        if (!insertError) {
          inserted += 1;
        }
        continue;
      }

      const needsUpdate =
        (hostedUrl && hostedUrl !== existing.stripe_invoice_url) || (status && status !== existing.status);
      if (needsUpdate) {
        const { error: updateError } = await supabaseAdmin
          .from('venue_invoices')
          .update({ stripe_invoice_url: hostedUrl ?? existing.stripe_invoice_url, status: status ?? existing.status })
          .eq('id', existing.id);
        if (!updateError) {
          updated += 1;
        }
      }
    }

    return json({ ok: true, inserted, updated });
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : 'sync_failed' }, { status: 500 });
  }
}
