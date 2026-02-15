import { json } from '@sveltejs/kit';
import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';
import { supabaseAdmin } from '$lib/server/supabaseAdmin';

const PAYTO_TIMEZONE = 'Australia/Sydney';
const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6
};
const PLATFORM_FEE_RATE = 2;

type ZonedParts = {
  year: number;
  month: number;
  day: number;
  weekday: number;
};

function getZonedParts(date: Date, timeZone: string): ZonedParts {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short'
  });
  const parts = formatter.formatToParts(date);
  const mapped = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const weekday = WEEKDAY_INDEX[mapped.weekday] ?? 0;
  return {
    year: Number(mapped.year),
    month: Number(mapped.month),
    day: Number(mapped.day),
    weekday
  };
}

function getWeekStartUtc(date: Date, timeZone: string): Date {
  const parts = getZonedParts(date, timeZone);
  const todayUtc = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  const diffToMonday = (parts.weekday + 6) % 7;
  return new Date(todayUtc.getTime() - diffToMonday * 24 * 60 * 60 * 1000);
}

function getLastWeekRange(timeZone: string): { start: Date; end: Date } {
  const currentWeekStart = getWeekStartUtc(new Date(), timeZone);
  const lastWeekStart = new Date(currentWeekStart.getTime() - 7 * 24 * 60 * 60 * 1000);
  return { start: lastWeekStart, end: currentWeekStart };
}

function formatWeekLabel(start: Date, end: Date, timeZone: string): string {
  const startLabel = start.toLocaleDateString('en-AU', {
    timeZone,
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  });
  const endLabel = new Date(end.getTime() - 24 * 60 * 60 * 1000).toLocaleDateString('en-AU', {
    timeZone,
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  });
  return `${startLabel} - ${endLabel}`;
}

function calculateKickbackWithRate(amount: number, rate: number): number {
  return Number((amount * rate).toFixed(2));
}

// Adjust this to match Hello Clever's order_details schema if their API changes.
function buildContactDetails(venue: Record<string, string | null>, billingEmail: string) {
  return {
    first_name: venue.billing_contact_first_name ?? '',
    last_name: venue.billing_contact_last_name ?? '',
    phone: venue.billing_phone ?? '',
    email: billingEmail,
    company: venue.billing_company ?? '',
    country_code: venue.billing_country_code ?? '',
    state: venue.billing_state ?? '',
    postal_code: venue.billing_postal_code ?? '',
    city: venue.billing_city ?? '',
    address: venue.billing_address ?? ''
  };
}

function buildOrderDetails(
  description: string,
  itemAmount: number,
  weekLabel: string,
  contactDetails: ReturnType<typeof buildContactDetails>,
  imageUrl: string
) {
  return {
    billing_details: contactDetails,
    shipping_details: contactDetails,
    items: [
      {
        id: `kickback-${weekLabel.replace(/[^a-z0-9]/gi, '').toLowerCase() || 'invoice'}`,
        name: description || `Kickback ${weekLabel}`,
        variant_id: 'default',
        image_url: imageUrl,
        quantity: '1',
        price: itemAmount.toFixed(2),
        enable_cashback: false
      }
    ]
  };
}

async function getGatewayAccessToken(
  appId: string,
  secretKey: string,
  baseUrl: string
): Promise<string> {
  const response = await fetch(`${baseUrl}/api/v1/payment_gateways/access_token`, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      'app-id': appId,
      'secret-key': secretKey
    }
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.access_token) {
    throw new Error(payload?.error ?? 'access_token_failed');
  }
  return payload.access_token as string;
}

function getGatewayBaseUrl(isDev: boolean): string {
  return isDev ? 'https://api.cleverhub.co' : 'https://api-merchant.helloclever.co';
}

export async function POST({ request, url }) {
  const body = await request.json().catch(() => null);
  const venueId = body?.venue_id;
  const description = body?.description ?? 'Weekly Kickback invoice';

  if (!venueId) {
    return json({ ok: false, error: 'missing_venue_id' }, { status: 400 });
  }

  const appId = dev ? env.PRIVATE_HELLOCLEVER_APP_ID_SANDBOX : env.PRIVATE_HELLOCLEVER_APP_ID_PROD;
  const secretKey = dev
    ? env.PRIVATE_HELLOCLEVER_SECRET_KEY_SANDBOX
    : env.PRIVATE_HELLOCLEVER_SECRET_KEY_PROD;
  const webhookSecret = dev
    ? env.PRIVATE_HELLOCLEVER_WEBHOOK_SECRET_SANDBOX
    : env.PRIVATE_HELLOCLEVER_WEBHOOK_SECRET_PROD;

  if (!appId || !secretKey || !webhookSecret) {
    return json({ ok: false, error: 'missing_credentials' }, { status: 500 });
  }

  const { start, end } = getLastWeekRange(PAYTO_TIMEZONE);
  const weekLabel = formatWeekLabel(start, end, PAYTO_TIMEZONE);
  const startIso = start.toISOString();
  const endIso = end.toISOString();

  const { data: venue, error: venueError } = await supabaseAdmin
    .from('venues')
    .select(
      'id, name, billing_email, billing_contact_first_name, billing_contact_last_name, billing_phone, billing_company, billing_country_code, billing_state, billing_postal_code, billing_city, billing_address'
    )
    .eq('id', venueId)
    .maybeSingle();

  if (venueError || !venue) {
    return json({ ok: false, error: venueError?.message ?? 'venue_not_found' }, { status: 404 });
  }

  const billingEmail = venue.billing_email ?? '';
  const missingDetails: string[] = [];
  if (!venue.billing_contact_first_name) missingDetails.push('billing_contact_first_name');
  if (!venue.billing_contact_last_name) missingDetails.push('billing_contact_last_name');
  if (!venue.billing_phone) missingDetails.push('billing_phone');
  if (!billingEmail) missingDetails.push('billing_email');
  if (!venue.billing_country_code) missingDetails.push('billing_country_code');
  if (!venue.billing_postal_code) missingDetails.push('billing_postal_code');
  if (!venue.billing_city) missingDetails.push('billing_city');
  if (!venue.billing_address) missingDetails.push('billing_address');
  if (missingDetails.length > 0) {
    return json({ ok: false, error: 'missing_billing_details', missing: missingDetails }, { status: 400 });
  }

  const { data: claims, error: claimsError } = await supabaseAdmin
    .from('claims')
    .select('amount, kickback_guest_rate, kickback_referrer_rate, status')
    .eq('venue_id', venueId)
    .or('status.is.null,status.eq.approved')
    .gte('purchased_at', startIso)
    .lt('purchased_at', endIso);

  if (claimsError) {
    return json({ ok: false, error: claimsError.message }, { status: 500 });
  }

  const claimRows = claims ?? [];
  if (claimRows.length === 0) {
    return json({ ok: false, error: 'no_approved_claims' }, { status: 400 });
  }

  let totalClaimAmount = 0;
  let platformFeeAmount = 0;
  let kickbackAmount = 0;
  for (const claim of claimRows) {
    const amount = Number(claim.amount ?? 0);
    totalClaimAmount += amount;
    const guestRate = Number(claim.kickback_guest_rate ?? 5);
    const referrerRate = Number(claim.kickback_referrer_rate ?? 5);
    const combinedRate = (guestRate + referrerRate + PLATFORM_FEE_RATE) / 100;
    const feeAmount = calculateKickbackWithRate(amount, combinedRate);
    const platformRate = PLATFORM_FEE_RATE / 100;
    const platformFee = calculateKickbackWithRate(amount, platformRate);
    platformFeeAmount += platformFee;
    kickbackAmount += feeAmount - platformFee;
  }

  totalClaimAmount = Number(totalClaimAmount.toFixed(2));
  platformFeeAmount = Number(platformFeeAmount.toFixed(2));
  kickbackAmount = Number(kickbackAmount.toFixed(2));

  const invoiceAmount = Number((kickbackAmount + platformFeeAmount).toFixed(2));
  const orderId =
    (globalThis.crypto && 'randomUUID' in globalThis.crypto
      ? globalThis.crypto.randomUUID()
      : `invoice-${venueId}-${Date.now()}`);

  try {
    const baseUrl = getGatewayBaseUrl(dev);
    const accessToken = await getGatewayAccessToken(appId, secretKey, baseUrl);
    const callbackUrl = new URL('/api/helloclever/gateway/webhook', url.origin).toString();
    const contactDetails = buildContactDetails(venue, billingEmail);
    const imageUrl = venue.logo_url ?? new URL('/favicon.svg', url.origin).toString();
    const payload = {
      order_id: orderId,
      amount: invoiceAmount,
      description,
      order_success_url: new URL('/admin?invoice=paid', url.origin).toString(),
      payment_gateway_notification: {
        endpoint_url: callbackUrl,
        authorization_header: `Bearer ${webhookSecret}`
      },
      order_details: buildOrderDetails(description, invoiceAmount, weekLabel, contactDetails, imageUrl)
    };

    const response = await fetch(`${baseUrl}/api/v1/payment_gateways/create_payment`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'access-token': accessToken
      },
      body: JSON.stringify(payload)
    });

    const result = await response.json().catch(() => null);
    if (!response.ok) {
      return json({ ok: false, error: result ?? 'request_failed' }, { status: response.status });
    }

    const insertPayload = {
      venue_id: venueId,
      order_id: orderId,
      payment_id: result?.payment_id ?? null,
      redirect_url: result?.redirect_url ?? null,
      amount: invoiceAmount,
      description,
      status: 'created',
      week_start: startIso,
      week_end: endIso,
      claim_count: claimRows.length,
      total_claim_amount: totalClaimAmount,
      platform_fee_amount: platformFeeAmount,
      kickback_amount: kickbackAmount,
      created_at: new Date().toISOString()
    };

    const { data: stored, error: storeError } = await supabaseAdmin
      .from('venue_payment_requests')
      .insert(insertPayload)
      .select()
      .single();

    if (storeError) {
      return json({ ok: false, error: storeError.message }, { status: 500 });
    }

    return json({ ok: true, payment_request: stored });
  } catch (error) {
    return json(
      { ok: false, error: error instanceof Error ? error.message : 'request_failed' },
      { status: 500 }
    );
  }
}
