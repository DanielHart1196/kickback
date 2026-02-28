import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { randomUUID } from 'crypto';
import { supabaseAdmin } from '$lib/server/supabaseAdmin';
import { fetchSquarePayment, type SquarePayment } from '$lib/server/square/payments';
import { matchSquareSignature } from '$lib/server/square/webhook';
import { GOAL_DAYS } from '$lib/claims/constants';
import { getVenueRatesForTime } from '$lib/venues/happyHour';
import { createEarningsForClaimId } from '$lib/server/earnings';

const dayMs = 24 * 60 * 60 * 1000;

function normalizeReferrerCode(code: string | null): string {
  return String(code ?? '').trim().toUpperCase();
}

function isMissingOnConflictConstraintError(message: string | null | undefined): boolean {
  const normalized = String(message ?? '').toLowerCase();
  return (
    normalized.includes('no unique or exclusion constraint') &&
    normalized.includes('on conflict')
  );
}

export async function POST({ request }: RequestEvent) {
  const traceId = randomUUID();
  const logPrefix = `[square webhook][${traceId}]`;

  console.log(`${logPrefix} received`, {
    url: request.url,
    hasSignature: Boolean(request.headers.get('x-square-signature')),
    signatureLength: (request.headers.get('x-square-signature') ?? '').length,
    hasSandboxKey: Boolean(process.env.PRIVATE_SQUARE_WEBHOOK_SIGNATURE_KEY_SANDBOX),
    hasProdKey: Boolean(process.env.PRIVATE_SQUARE_WEBHOOK_SIGNATURE_KEY_PROD)
  });

  try {
    const signature = request.headers.get('x-square-signature') ?? '';
    const body = await request.text();
    const signatureMatch = matchSquareSignature(request, body, signature);

    if (!signatureMatch.hasSandboxKey && !signatureMatch.hasProdKey) {
      console.error(`${logPrefix} missing signature key`, signatureMatch);
      return json({ ok: false, error: 'missing_signature_key' }, { status: 500 });
    }

    if (!signatureMatch.valid) {
      console.warn(`${logPrefix} signature mismatch`, {
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

    console.log(`${logPrefix} parsed`, { eventType, merchantId, paymentId });

    if (!merchantId || !paymentId) {
      return json({ ok: true, ignored: true });
    }

    if (eventType !== 'payment.updated') {
      return json({ ok: true, ignored: true });
    }

    const { data: connections, error: connectionError } = await supabaseAdmin
      .from('square_connections')
      .select('venue_id,access_token')
      .eq('merchant_id', merchantId);

    if (connectionError) {
      console.error(`${logPrefix} square_connections query failed`, {
        merchantId,
        error: connectionError.message
      });
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
      console.error(`${logPrefix} payment fetch failed`, {
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
      console.error(`${logPrefix} square_location_links query failed`, {
        venueIds,
        error: locationError.message
      });
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
      console.error(`${logPrefix} square_card_bindings query failed`, {
        candidateVenues,
        fingerprint,
        error: bindingsError.message
      });
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
        console.error(`${logPrefix} fallback fingerprint claims query failed`, {
          candidateVenues,
          fingerprint,
          error: fingerprintError.message
        });
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
        console.error(`${logPrefix} seed square_card_bindings failed`, {
          venueId,
          submitterId,
          fingerprint,
          error: seedBindingError.message
        });
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
      console.error(`${logPrefix} user claims query failed`, {
        venueId,
        submitterId,
        error: userClaimsError.message
      });
      return json({ ok: false, error: userClaimsError.message }, { status: 500 });
    }

    const referrer = userClaims?.[0] ?? { referrer_id: null, referrer: null };
    const referrerCode = normalizeReferrerCode(referrer.referrer ?? null);
    if (!referrerCode) {
      return json({ ok: true, ignored: true });
    }

    const { data: activeInvitations, error: inviteError } = await supabaseAdmin
      .from('invitations')
      .select('id, activated_at, expires_at')
      .eq('user_id', submitterId)
      .eq('venue_id', venueId)
      .eq('referrer_code', referrerCode)
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(1);
    if (inviteError) {
      console.error(`${logPrefix} invitations query failed`, {
        submitterId,
        venueId,
        referrerCode,
        error: inviteError.message
      });
      return json({ ok: false, error: inviteError.message }, { status: 500 });
    }
    const activeInvitation = activeInvitations?.[0] ?? null;
    if (!activeInvitation?.id) {
      return json({ ok: true, ignored: true });
    }
    const activatedAtMs = new Date(activeInvitation.activated_at ?? '').getTime();
    if (!Number.isFinite(activatedAtMs)) {
      return json({ ok: true, ignored: true });
    }
    const expiresAtMs = activeInvitation.expires_at
      ? new Date(activeInvitation.expires_at).getTime()
      : activatedAtMs + GOAL_DAYS * dayMs;
    if (!Number.isFinite(expiresAtMs)) {
      return json({ ok: true, ignored: true });
    }
    const paymentMs = new Date(purchasedAt).getTime();
    if (!Number.isFinite(paymentMs) || paymentMs < activatedAtMs || paymentMs > expiresAtMs) {
      return json({ ok: true, ignored: true });
    }

    const autoClaimStatus = venue.square_public === false ? 'pending' : 'approved';
    const effectiveRates = getVenueRatesForTime(venue, purchasedAt, 5);

    const claimPayload = {
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
    };

    const { data: createdUpsert, error: insertError } = await supabaseAdmin
      .from('claims')
      .upsert(
        claimPayload,
        { onConflict: 'square_payment_id', ignoreDuplicates: true }
      )
      .select('id')
      .maybeSingle();

    let created = createdUpsert;
    if (insertError) {
      if (isMissingOnConflictConstraintError(insertError.message)) {
        console.error(`${logPrefix} missing square_payment_id unique index, falling back to plain insert`, {
          paymentId: payment.id,
          error: insertError.message
        });
        const { data: createdInsert, error: fallbackInsertError } = await supabaseAdmin
          .from('claims')
          .insert(claimPayload)
          .select('id')
          .maybeSingle();
        if (fallbackInsertError) {
          console.error(`${logPrefix} claim fallback insert failed`, {
            venueId,
            submitterId,
            paymentId: payment.id,
            error: fallbackInsertError.message
          });
          return json({ ok: false, error: fallbackInsertError.message }, { status: 500 });
        }
        created = createdInsert;
      } else {
        console.error(`${logPrefix} claim upsert failed`, {
          venueId,
          submitterId,
          paymentId: payment.id,
          error: insertError.message
        });
        return json({ ok: false, error: insertError.message }, { status: 500 });
      }
    }

    if (!created?.id) {
      return json({ ok: true, already_linked: true });
    }

    try {
      await createEarningsForClaimId(String(created.id));
    } catch {}

    try {
      const origin = new URL(request.url).origin;
      await fetch(`${origin}/api/notifications/claim-created`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ claim_id: created?.id })
      });
    } catch {}

    return json({ ok: true });
  } catch (error) {
    console.error(`${logPrefix} unhandled error`, error);
    return json({ ok: false, error: 'webhook_unhandled_error' }, { status: 500 });
  }
}
