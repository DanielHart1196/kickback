import { json } from '@sveltejs/kit';
import { dev } from '$app/environment';
import { createHmac, timingSafeEqual } from 'crypto';
import {
  PRIVATE_SQUARE_WEBHOOK_SIGNATURE_KEY_PROD,
  PRIVATE_SQUARE_WEBHOOK_SIGNATURE_KEY_SANDBOX
} from '$env/static/private';
import { supabaseAdmin } from '$lib/server/supabaseAdmin';

const squareApiBase = dev ? 'https://connect.squareupsandbox.com' : 'https://connect.squareup.com';
const squareVersion = '2025-01-23';

type SquarePayment = {
  id: string;
  status?: string;
  created_at?: string;
  location_id?: string;
  amount_money?: { amount: number };
  card_details?: { card?: { last_4?: string; fingerprint?: string; card_fingerprint?: string } };
};

function isValidSignature(signature: string, url: string, body: string, key: string): boolean {
  const hmac = createHmac('sha1', key);
  hmac.update(url + body);
  const expected = hmac.digest('base64');
  if (expected.length !== signature.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

export async function POST({ request }) {
  const signatureKey = dev
    ? PRIVATE_SQUARE_WEBHOOK_SIGNATURE_KEY_SANDBOX
    : PRIVATE_SQUARE_WEBHOOK_SIGNATURE_KEY_PROD;
  if (!signatureKey) {
    return json({ ok: false, error: 'missing_signature_key' }, { status: 500 });
  }

  const signature = request.headers.get('x-square-signature') ?? '';
  const body = await request.text();

  if (!signature || !isValidSignature(signature, request.url, body, signatureKey)) {
    return json({ ok: false, error: 'invalid_signature' }, { status: 401 });
  }

  const payload = JSON.parse(body);
  const eventType = payload?.type;
  const merchantId = payload?.merchant_id;
  const paymentId = payload?.data?.id ?? payload?.data?.object?.payment?.id;

  if (!merchantId || !paymentId) {
    return json({ ok: true, ignored: true });
  }

  if (eventType !== 'payment.created' && eventType !== 'payment.updated') {
    return json({ ok: true, ignored: true });
  }

  const { data: connections, error: connectionError } = await supabaseAdmin
    .from('square_connections')
    .select('venue_id,access_token')
    .eq('merchant_id', merchantId);

  if (connectionError) {
    return json({ ok: false, error: connectionError.message }, { status: 500 });
  }

  if (!connections || connections.length === 0) {
    return json({ ok: true, ignored: true });
  }

  const existing = await supabaseAdmin
    .from('claims')
    .select('square_payment_id')
    .eq('square_payment_id', paymentId)
    .maybeSingle();

  if (existing.data) {
    return json({ ok: true, already_linked: true });
  }

  const accessToken = connections[0]?.access_token;
  if (!accessToken) {
    return json({ ok: false, error: 'missing_access_token' }, { status: 404 });
  }

  const paymentResponse = await fetch(`${squareApiBase}/v2/payments/${paymentId}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Square-Version': squareVersion,
      Accept: 'application/json'
    }
  });

  const paymentPayload = await paymentResponse.json().catch(() => null);
  if (!paymentResponse.ok) {
    return json({ ok: false, error: paymentPayload?.message ?? 'square_payment_failed' }, { status: 502 });
  }

  const payment = paymentPayload?.payment as SquarePayment | undefined;
  if (!payment || (payment.status && payment.status !== 'COMPLETED')) {
    return json({ ok: true, ignored: true });
  }

  const last4 = payment.card_details?.card?.last_4;
  const fingerprint =
    payment.card_details?.card?.fingerprint ??
    payment.card_details?.card?.card_fingerprint ??
    null;
  const amount = payment.amount_money?.amount;
  const purchasedAt = payment.created_at;

  if (!last4 || !fingerprint || amount == null || !purchasedAt) {
    return json({ ok: true, ignored: true });
  }

  const venueIds = connections.map((connection) => connection.venue_id).filter(Boolean) as string[];
  if (venueIds.length === 0) {
    return json({ ok: true, ignored: true });
  }

  const { data: locationLinks, error: locationError } = await supabaseAdmin
    .from('square_location_links')
    .select('venue_id,location_id')
    .in('venue_id', venueIds);

  if (locationError) {
    return json({ ok: false, error: locationError.message }, { status: 500 });
  }

  const venueToLocations = new Map<string, Set<string>>();
  for (const row of locationLinks ?? []) {
    if (!venueToLocations.has(row.venue_id)) {
      venueToLocations.set(row.venue_id, new Set());
    }
    venueToLocations.get(row.venue_id)?.add(row.location_id);
  }

  const candidateVenues = venueIds.filter((venueId) => {
    const locations = venueToLocations.get(venueId);
    if (!locations || locations.size === 0) {
      return venueIds.length === 1;
    }
    if (!payment.location_id) return false;
    return locations.has(payment.location_id);
  });

  if (candidateVenues.length === 0) {
    return json({ ok: true, ignored: true });
  }

  const { data: fingerprintClaims, error: fingerprintError } = await supabaseAdmin
    .from('claims')
    .select('square_card_fingerprint,submitter_id,venue_id,purchased_at')
    .in('venue_id', candidateVenues)
    .eq('square_card_fingerprint', fingerprint)
    .order('purchased_at', { ascending: true });

  if (fingerprintError) {
    return json({ ok: false, error: fingerprintError.message }, { status: 500 });
  }

  const fingerprintClaim = (fingerprintClaims ?? []).find((claim) =>
    candidateVenues.includes(claim.venue_id ?? '')
  );

  if (!fingerprintClaim?.submitter_id || !fingerprintClaim.venue_id) {
    return json({ ok: true, ignored: true });
  }

  const venueId = fingerprintClaim.venue_id;
  const submitterId = fingerprintClaim.submitter_id;

  const { data: venue, error: venueError } = await supabaseAdmin
    .from('venues')
    .select('name,kickback_guest,kickback_referrer')
    .eq('id', venueId)
    .maybeSingle();

  if (venueError || !venue) {
    return json({ ok: false, error: venueError?.message ?? 'venue_not_found' }, { status: 404 });
  }

  const { data: userClaims, error: userClaimsError } = await supabaseAdmin
    .from('claims')
    .select('referrer_id,referrer')
    .eq('venue_id', venueId)
    .eq('submitter_id', submitterId)
    .order('purchased_at', { ascending: true })
    .limit(1);

  if (userClaimsError) {
    return json({ ok: false, error: userClaimsError.message }, { status: 500 });
  }

  const referrer = userClaims?.[0] ?? { referrer_id: null, referrer: null };

  const { error: insertError } = await supabaseAdmin.from('claims').insert({
    venue: venue.name,
    venue_id: venueId,
    submitter_id: submitterId,
    referrer_id: referrer.referrer_id ?? null,
    referrer: referrer.referrer ?? null,
    amount: amount / 100,
    last_4: last4,
    purchased_at: purchasedAt,
    created_at: new Date().toISOString(),
    status: 'approved',
    kickback_guest_rate: venue.kickback_guest ?? null,
    kickback_referrer_rate: venue.kickback_referrer ?? null,
    square_payment_id: payment.id,
    square_card_fingerprint: fingerprint,
    square_location_id: payment.location_id ?? null
  });

  if (insertError) {
    return json({ ok: false, error: insertError.message }, { status: 500 });
  }

  return json({ ok: true });
}
