import { json } from '@sveltejs/kit';
import { dev } from '$app/environment';
import { supabaseAdmin } from '$lib/server/supabaseAdmin';
import { env } from '$env/dynamic/private';

const timeZone = 'Australia/Sydney';
const weekdayIndex: Record<string, number> = {
  Mon: 0,
  Tue: 1,
  Wed: 2,
  Thu: 3,
  Fri: 4,
  Sat: 5,
  Sun: 6
};

function getTimeZoneOffsetMinutes(date: Date, zone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    timeZoneName: 'shortOffset',
    hour: '2-digit',
    minute: '2-digit'
  }).formatToParts(date);
  const offset = parts.find((part) => part.type === 'timeZoneName')?.value ?? 'GMT+0';
  const match = offset.match(/GMT([+-]\d{1,2})(?::(\d{2}))?/);
  if (!match) return 0;
  const hours = Number(match[1] ?? 0);
  const minutes = Number(match[2] ?? 0);
  return hours * 60 + Math.sign(hours) * minutes;
}

function getZonedDateParts(date: Date, zone: string) {
  const parts = new Intl.DateTimeFormat('en-AU', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short'
  }).formatToParts(date);
  const lookup = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    year: Number(lookup.year),
    month: Number(lookup.month),
    day: Number(lookup.day),
    weekday: weekdayIndex[lookup.weekday] ?? 0
  };
}

function getUtcForLocalMidnight(year: number, month: number, day: number, zone: string): number {
  const offsetMinutes = getTimeZoneOffsetMinutes(
    new Date(Date.UTC(year, month - 1, day, 12, 0, 0)),
    zone
  );
  return Date.UTC(year, month - 1, day, 0, 0, 0) - offsetMinutes * 60_000;
}

function getPreviousWeekRange() {
  const now = new Date();
  const parts = getZonedDateParts(now, timeZone);
  const localDate = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  localDate.setUTCDate(localDate.getUTCDate() - parts.weekday - 7);
  const startYear = localDate.getUTCFullYear();
  const startMonth = localDate.getUTCMonth() + 1;
  const startDay = localDate.getUTCDate();
  const labelEnd = new Date(localDate);
  labelEnd.setUTCDate(labelEnd.getUTCDate() + 6);
  const labelEndYear = labelEnd.getUTCFullYear();
  const labelEndMonth = labelEnd.getUTCMonth() + 1;
  const labelEndDay = labelEnd.getUTCDate();
  const endLocal = new Date(localDate);
  endLocal.setUTCDate(endLocal.getUTCDate() + 7);
  const endYear = endLocal.getUTCFullYear();
  const endMonth = endLocal.getUTCMonth() + 1;
  const endDay = endLocal.getUTCDate();

  const startUtc = getUtcForLocalMidnight(startYear, startMonth, startDay, timeZone);
  const endUtc = getUtcForLocalMidnight(endYear, endMonth, endDay, timeZone);

  const weekStart = `${startYear}-${String(startMonth).padStart(2, '0')}-${String(startDay).padStart(2, '0')}`;
  const weekEndLabel = `${labelEndYear}-${String(labelEndMonth).padStart(2, '0')}-${String(labelEndDay).padStart(2, '0')}`;

  return {
    weekStart,
    weekEnd: weekEndLabel,
    rangeStart: new Date(startUtc).toISOString(),
    rangeEnd: new Date(endUtc).toISOString()
  };
}

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

export async function POST({ request }) {
  if (!dev) {
    const authHeader = request.headers.get('authorization') ?? '';
    const cronHeader = request.headers.get('x-vercel-cron');
    const isCron = cronHeader === '1';
    const secret = env.CRON_SECRET || env.PRIVATE_CRON_SECRET;
    const hasSecret = secret && authHeader === `Bearer ${secret}`;
    if (!isCron && !hasSecret) {
      return json({ ok: false, error: 'unauthorized' }, { status: 401 });
    }
  }

  const { weekStart, weekEnd, rangeStart, rangeEnd } = getPreviousWeekRange();

  const { data: claims, error: claimsError } = await supabaseAdmin
    .from('claims')
    .select('venue_id, amount')
    .eq('status', 'approved')
    .gte('purchased_at', rangeStart)
    .lt('purchased_at', rangeEnd)
    .not('venue_id', 'is', null);
  if (claimsError) {
    return json({ ok: false, error: claimsError.message }, { status: 500 });
  }

  const totals = new Map<string, number>();
  for (const claim of claims ?? []) {
    if (!claim.venue_id) continue;
    totals.set(claim.venue_id, (totals.get(claim.venue_id) ?? 0) + Number(claim.amount || 0));
  }

  const { data: venues, error: venueError } = await supabaseAdmin
    .from('venues')
    .select(
      'id, name, active, billing_email, billing_contact_first_name, billing_contact_last_name, billing_phone, billing_company, billing_country_code, billing_state, billing_postal_code, billing_city, billing_address, stripe_customer_id'
    )
    .eq('active', true);
  if (venueError) {
    return json({ ok: false, error: venueError.message }, { status: 500 });
  }

  const results: {
    venue_id: string;
    ok: boolean;
    error?: string;
    subtotal?: number;
    total?: number;
    amount_due?: number;
    invoice_id?: string;
    line_items?: { amount: number; description: string | null }[];
  }[] = [];
  const debugTotals: { venue_id: string; total: number }[] = [];

  for (const venue of venues ?? []) {
    const total = totals.get(venue.id) ?? 0;
    debugTotals.push({ venue_id: venue.id, total });
    if (!total || total <= 0) continue;

    const { data: existing } = await supabaseAdmin
      .from('venue_invoices')
      .select('id')
      .eq('venue_id', venue.id)
      .eq('week_start', weekStart)
      .maybeSingle();
    if (existing?.id) continue;

    if (!venue.billing_email) {
      results.push({ venue_id: venue.id, ok: false, error: 'missing_billing_email' });
      continue;
    }

    try {
      let stripeCustomerId = venue.stripe_customer_id ?? null;
      if (stripeCustomerId) {
        try {
          await stripeGet(`customers/${stripeCustomerId}`);
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
          name: [venue.billing_contact_first_name, venue.billing_contact_last_name]
            .filter(Boolean)
            .join(' ')
            .trim() || venue.billing_company || venue.name,
          phone: venue.billing_phone,
          address: {
            line1: venue.billing_address,
            city: venue.billing_city,
            state: venue.billing_state,
            postal_code: venue.billing_postal_code,
            country: venue.billing_country_code || 'AU'
          },
          metadata: {
            venue_id: venue.id
          }
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

      const invoice = await stripeRequest('invoices', {
        customer: stripeCustomerId,
        collection_method: 'send_invoice',
        days_until_due: 7,
        auto_advance: false,
        description: `Kickback weekly invoice (${weekStart} to ${weekEnd})`,
        metadata: {
          venue_id: venue.id,
          week_start: weekStart,
          week_end: weekEnd
        }
      });

      await stripeRequest('invoiceitems', {
        customer: stripeCustomerId,
        invoice: invoice.id,
        currency: 'aud',
        amount: platformCents,
        description: 'Kickback platform fee (1%)',
        metadata: {
          venue_id: venue.id,
          week_start: weekStart,
          week_end: weekEnd
        }
      });

      await stripeRequest('invoiceitems', {
        customer: stripeCustomerId,
        invoice: invoice.id,
        currency: 'aud',
        amount: guestCents,
        description: 'New customer cashback (5%)',
        metadata: {
          venue_id: venue.id,
          week_start: weekStart,
          week_end: weekEnd
        }
      });

      await stripeRequest('invoiceitems', {
        customer: stripeCustomerId,
        invoice: invoice.id,
        currency: 'aud',
        amount: referrerCents,
        description: 'Referrer commission (5%)',
        metadata: {
          venue_id: venue.id,
          week_start: weekStart,
          week_end: weekEnd
        }
      });

      const finalized = await stripeRequest(`invoices/${invoice.id}/finalize`, {});
      const lines = await stripeGet(`invoices/${invoice.id}/lines`, { limit: 20 });
      const lineItems = (lines?.data ?? []).map((item: any) => ({
        amount: Number(item.amount ?? 0) / 100,
        description: item.description ?? null
      }));
      const amountDue = Number(finalized?.amount_due ?? invoice?.amount_due ?? 0) / 100;

      const { error: upsertError } = await supabaseAdmin
        .from('venue_invoices')
        .upsert(
          {
            venue_id: venue.id,
            week_start: weekStart,
            week_end: weekEnd,
            subtotal,
            total: totalWithGst,
            gst: 0,
            stripe_invoice_id: invoice.id,
            stripe_invoice_url: finalized?.hosted_invoice_url ?? invoice?.hosted_invoice_url ?? null,
            status: finalized?.status ?? invoice?.status ?? null
          },
          { onConflict: 'stripe_invoice_id' }
        );

      results.push({
        venue_id: venue.id,
        ok: !upsertError,
        error: upsertError?.message ?? undefined,
        subtotal,
        total: totalWithGst,
        amount_due: amountDue,
        invoice_id: invoice.id,
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

  return json({
    ok: true,
    week_start: weekStart,
    week_end: weekEnd,
    range_start: rangeStart,
    range_end: rangeEnd,
    totals: debugTotals,
    results
  });
}

export async function GET({ request }) {
  return POST({ request } as any);
}
