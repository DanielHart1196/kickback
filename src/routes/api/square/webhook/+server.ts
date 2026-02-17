import { json } from '@sveltejs/kit';
import { supabaseAdmin } from '$lib/server/supabaseAdmin';
import { fetchSquarePayment, type SquarePayment } from '$lib/server/square/payments';
import { matchSquareSignature } from '$lib/server/square/webhook';
import { GOAL_DAYS } from '$lib/claims/constants';
import { getVenueRatesForTime } from '$lib/venues/happyHour';

const dayMs = 24 * 60 * 60 * 1000;

function isWithinAutoClaimWindow(firstPurchasedAt: string, paymentPurchasedAt: string): boolean {
  const firstTime = new Date(firstPurchasedAt).getTime();
  const paymentTime = new Date(paymentPurchasedAt).getTime();
  if (!Number.isFinite(firstTime) || !Number.isFinite(paymentTime)) return false;
  const diffInDays = Math.floor((paymentTime - firstTime) / dayMs);
  return diffInDays >= 0 && diffInDays < GOAL_DAYS;
}

export async function POST({ request }) {
  const signature = request.headers.get('x-square-signature') ?? '';
  const body = await request.text();
  const signatureMatch = matchSquareSignature(request, body, signature);

  if (!signatureMatch.hasSandboxKey && !signatureMatch.hasProdKey) {
    return json({ ok: false, error: 'missing_signature_key' }, { status: 500 });
  }

  if (!signatureMatch.valid) {
    console.warn('Square webhook signature mismatch', {
      requestUrl: request.url,
      publicUrl: signatureMatch.publicUrl,
      signatureLength: signature.length,
      hasSandboxKey: signatureMatch.hasSandboxKey,
      hasProdKey: signatureMatch.hasProdKey
    });
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

  const accessToken = connections.find((connection) => connection.access_token)?.access_token ?? null;
  if (!accessToken) {
    return json({ ok: false, error: 'missing_access_token' }, { status: 404 });
  }

  const paymentResult = await fetchSquarePayment(accessToken, paymentId);
  if (!paymentResult.ok) {
    console.error('Square payment fetch failed', {
      merchantId,
      paymentId,
      baseUrl: paymentResult.baseUrl,
      status: paymentResult.status,
      error: paymentResult.payload ?? null
    });
    return json(
      { ok: false, error: 'square_payment_failed' },
      { status: 502 }
    );
  }

  const payment = paymentResult.payload?.payment as SquarePayment | undefined;
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

  const { data: bindings, error: bindingsError } = await supabaseAdmin
    .from('square_card_bindings')
    .select('venue_id,user_id,first_purchased_at')
    .in('venue_id', candidateVenues)
    .eq('card_fingerprint', fingerprint);

  if (bindingsError) {
    return json({ ok: false, error: bindingsError.message }, { status: 500 });
  }

  let venueId: string | null = null;
  let submitterId: string | null = null;
  let firstPurchasedAt: string | null = null;

  for (const candidateVenue of candidateVenues) {
    const match = (bindings ?? []).find((row) => row.venue_id === candidateVenue);
    if (match?.user_id) {
      venueId = candidateVenue;
      submitterId = match.user_id;
      firstPurchasedAt = match.first_purchased_at ?? null;
      break;
    }
  }

  if (!venueId || !submitterId) {
    const { data: fingerprintClaims, error: fingerprintError } = await supabaseAdmin
      .from('claims')
      .select('submitter_id,venue_id,purchased_at')
      .in('venue_id', candidateVenues)
      .eq('square_card_fingerprint', fingerprint)
      .order('purchased_at', { ascending: true });

    if (fingerprintError) {
      return json({ ok: false, error: fingerprintError.message }, { status: 500 });
    }

    const fingerprintClaim = (fingerprintClaims ?? []).find(
      (claim) => claim.submitter_id && claim.venue_id && candidateVenues.includes(claim.venue_id)
    );

    if (!fingerprintClaim?.submitter_id || !fingerprintClaim.venue_id) {
      return json({ ok: true, ignored: true });
    }

    venueId = fingerprintClaim.venue_id;
    submitterId = fingerprintClaim.submitter_id;
    firstPurchasedAt = fingerprintClaim.purchased_at ?? null;

    const { error: seedBindingError } = await supabaseAdmin
      .from('square_card_bindings')
      .upsert(
        {
          venue_id: venueId,
          card_fingerprint: fingerprint,
          user_id: submitterId,
          first_claim_id: null,
          first_purchased_at: firstPurchasedAt,
          updated_at: new Date().toISOString()
        },
        { onConflict: 'venue_id,card_fingerprint', ignoreDuplicates: true }
      );
    if (seedBindingError) {
      return json({ ok: false, error: seedBindingError.message }, { status: 500 });
    }
  }

  const { data: venue, error: venueError } = await supabaseAdmin
    .from('venues')
    .select('name,kickback_guest,kickback_referrer,square_public,happy_hour_start_time,happy_hour_end_time,happy_hour_days')
    .eq('id', venueId)
    .maybeSingle();

  if (venueError || !venue) {
    return json({ ok: false, error: venueError?.message ?? 'venue_not_found' }, { status: 404 });
  }

  const { data: userClaims, error: userClaimsError } = await supabaseAdmin
    .from('claims')
    .select('referrer_id,referrer,purchased_at')
    .eq('venue_id', venueId)
    .eq('submitter_id', submitterId)
    .order('purchased_at', { ascending: true })
    .limit(1);

  if (userClaimsError) {
    return json({ ok: false, error: userClaimsError.message }, { status: 500 });
  }

  const referrer = userClaims?.[0] ?? { referrer_id: null, referrer: null };
  const windowStart = firstPurchasedAt ?? userClaims?.[0]?.purchased_at ?? null;
  if (!windowStart || !isWithinAutoClaimWindow(windowStart, purchasedAt)) {
    return json({ ok: true, ignored: true });
  }

  const autoClaimStatus = venue.square_public === false ? 'pending' : 'approved';
  const effectiveRates = getVenueRatesForTime(venue, purchasedAt, 5);

  const { data: created, error: insertError } = await supabaseAdmin
    .from('claims')
    .upsert(
      {
        venue: venue.name,
        venue_id: venueId,
        submitter_id: submitterId,
        referrer_id: referrer.referrer_id ?? null,
        referrer: referrer.referrer ?? null,
        amount: amount / 100,
        last_4: last4,
        purchased_at: purchasedAt,
        created_at: new Date().toISOString(),
        status: autoClaimStatus,
        kickback_guest_rate: effectiveRates.guestRate,
        kickback_referrer_rate: effectiveRates.referrerRate,
        square_payment_id: payment.id,
        square_card_fingerprint: fingerprint,
        square_location_id: payment.location_id ?? null
      },
      { onConflict: 'square_payment_id', ignoreDuplicates: true }
    )
    .select('id')
    .maybeSingle();

  if (insertError) {
    return json({ ok: false, error: insertError.message }, { status: 500 });
  }

  if (!created?.id) {
    return json({ ok: true, already_linked: true });
  }

  try {
    const origin = new URL(request.url).origin;
    await fetch(`${origin}/api/notifications/claim-created`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ claim_id: created?.id })
    });
  } catch {}

  return json({ ok: true });
}
