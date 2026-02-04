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

async function stripeRequest(path: string, payload: Record<string, unknown> = {}) {
  const key = getStripeKey();
  if (!key) {
    throw new Error('missing_stripe_key');
  }
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

async function stripeGet(path: string, query: Record<string, unknown> = {}) {
  const key = getStripeKey();
  if (!key) {
    throw new Error('missing_stripe_key');
  }
  const params = new URLSearchParams();
  Object.entries(query).forEach(([k, v]) => appendStripeParams(params, k, v));
  const url = params.toString()
    ? `https://api.stripe.com/v1/${path}?${params.toString()}`
    : `https://api.stripe.com/v1/${path}`;
  const response = await fetch(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${key}` }
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
    const claimIds: string[] = Array.isArray(body?.claim_ids) ? body.claim_ids : [];
    const rangeStartBody: string | undefined = typeof body?.range_start === 'string' ? body.range_start : undefined;
    const rangeEndBody: string | undefined = typeof body?.range_end === 'string' ? body.range_end : undefined;
    if (!claimIds || claimIds.length === 0) {
      return json({ ok: false, error: 'missing_claim_ids' }, { status: 400 });
    }

    const { data: claims, error: claimsError } = await supabaseAdmin
      .from('claims')
      .select('id, venue_id, amount, status, purchased_at')
      .in('id', claimIds);
    if (claimsError) {
      return json({ ok: false, error: claimsError.message }, { status: 500 });
    }
    const rows = (claims ?? []).filter((c) => c.venue_id);
    if (rows.length === 0) {
      return json({ ok: false, error: 'no_venue_claims' }, { status: 400 });
    }

    const totals = new Map<string, number>();
    const ranges = new Map<string, { min: number; max: number }>();
    for (const claim of rows) {
      const status = (claim.status ?? 'approved') as string;
      if (status !== 'approved') continue;
      const vId = claim.venue_id as string;
      totals.set(vId, (totals.get(vId) ?? 0) + Number(claim.amount || 0));
      const t = new Date((claim as any).purchased_at).getTime();
      if (!Number.isNaN(t)) {
        const existing = ranges.get(vId);
        if (!existing) {
          ranges.set(vId, { min: t, max: t });
        } else {
          if (t < existing.min) existing.min = t;
          if (t > existing.max) existing.max = t;
        }
      }
    }
    if (totals.size === 0) {
      return json({ ok: false, error: 'no_approved_claims' }, { status: 400 });
    }

    const venueIds = Array.from(totals.keys());
    const { data: venues, error: venuesError } = await supabaseAdmin
      .from('venues')
      .select(
        'id, name, stripe_customer_id, billing_email, billing_contact_first_name, billing_contact_last_name, billing_phone, billing_company, billing_country_code, billing_state, billing_postal_code, billing_city, billing_address'
      )
      .in('id', venueIds);
    if (venuesError) {
      return json({ ok: false, error: venuesError.message }, { status: 500 });
    }

    const results: {
      venue_id: string;
      ok: boolean;
      error?: string;
      subtotal?: number;
      total?: number;
      amount_due?: number;
      invoice_id?: string;
      invoice_url?: string | null;
      line_items?: { amount: number; description: string | null }[];
    }[] = [];

    for (const venue of venues ?? []) {
      const total = totals.get(venue.id) ?? 0;
      if (!total || total <= 0) continue;
      if (!venue.billing_email) {
        results.push({ venue_id: venue.id, ok: false, error: 'missing_billing_email' });
        continue;
      }

      try {
        let stripeCustomerId = venue.stripe_customer_id ?? null;
        if (stripeCustomerId) {
          try {
            await stripeGet(`customers/${stripeCustomerId}`);
            try {
              await stripeRequest(`customers/${stripeCustomerId}`, { name: venue.name });
            } catch {}
          } catch (error) {
            if (error instanceof Error && /no such customer/i.test(error.message)) {
              stripeCustomerId = null;
            } else {
              throw error;
            }
          }
        }
        if (!stripeCustomerId) {
          const customer = await stripeRequest('customers', {
            email: venue.billing_email,
            name: venue.name,
            phone: venue.billing_phone,
            address: {
              line1: venue.billing_address,
              city: venue.billing_city,
              state: venue.billing_state,
              postal_code: venue.billing_postal_code,
              country: venue.billing_country_code || 'AU'
            },
            metadata: { venue_id: venue.id }
          });
          stripeCustomerId = customer.id;
          await supabaseAdmin.from('venues').update({ stripe_customer_id: stripeCustomerId }).eq('id', venue.id);
        }

        const referrerFee = total * 0.05;
        const guestFee = total * 0.05;
        const platformFee = total * 0.01;
        const subtotal = referrerFee + guestFee + platformFee;
        const totalWithGst = subtotal;
        const referrerCents = Math.round(referrerFee * 100);
        const guestCents = Math.round(guestFee * 100);
        const platformCents = Math.round(platformFee * 100);

        const range = ranges.get(venue.id);
        const startLabel =
          rangeStartBody ??
          (range ? new Date(range.min).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10));
        const endLabel = rangeEndBody ?? (range ? new Date(range.max).toISOString().slice(0, 10) : startLabel);
        const invoice = await stripeRequest('invoices', {
          customer: stripeCustomerId,
          collection_method: 'send_invoice',
          days_until_due: 7,
          auto_advance: false,
          description: `Kickback invoice (${startLabel} to ${endLabel})`,
          metadata: { venue_id: venue.id }
        });

        await stripeRequest('invoiceitems', {
          customer: stripeCustomerId,
          invoice: invoice.id,
          currency: 'aud',
          amount: referrerCents,
          description: 'Referrer commission (5%)',
          metadata: { venue_id: venue.id }
        });

        await stripeRequest('invoiceitems', {
          customer: stripeCustomerId,
          invoice: invoice.id,
          currency: 'aud',
          amount: guestCents,
          description: 'New customer cashback (5%)',
          metadata: { venue_id: venue.id }
        });

        await stripeRequest('invoiceitems', {
          customer: stripeCustomerId,
          invoice: invoice.id,
          currency: 'aud',
          amount: platformCents,
          description: 'Kickback platform fee (1%)',
          metadata: { venue_id: venue.id }
        });

        const finalized = await stripeRequest(`invoices/${invoice.id}/finalize`, {});
        const lines = await stripeGet(`invoices/${invoice.id}/lines`, { limit: 20 });
        const lineItems = (lines?.data ?? []).map((item: any) => ({
          amount: Number(item.amount ?? 0) / 100,
          description: item.description ?? null
        }));
        const amountDue = Number(finalized?.amount_due ?? invoice?.amount_due ?? 0) / 100;
        const invoiceUrl = finalized?.hosted_invoice_url ?? invoice?.hosted_invoice_url ?? null;

        results.push({
          venue_id: venue.id,
          ok: true,
          subtotal,
          total: totalWithGst,
          amount_due: amountDue,
          invoice_id: invoice.id,
          invoice_url: invoiceUrl,
          line_items: lineItems
        });
      } catch (error) {
        results.push({
          venue_id: venue.id,
          ok: false,
          error: error instanceof Error ? error.message : 'stripe_error'
        });
      }
    }

    return json({ ok: true, results });
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : 'bulk_create_failed' }, { status: 500 });
  }
}
