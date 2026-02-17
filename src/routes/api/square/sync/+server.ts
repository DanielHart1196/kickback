import { json } from '@sveltejs/kit';
import { supabaseAdmin } from '$lib/server/supabaseAdmin';
import { getSquareApiBase, squareVersion, type SquarePayment } from '$lib/server/square/payments';
import { GOAL_DAYS } from '$lib/claims/constants';
const defaultSyncHours = 24;
const overlapMinutes = 10;
const pageLimit = 200;
const dayMs = 24 * 60 * 60 * 1000;

function isWithinAutoClaimWindow(firstPurchasedAt: string, paymentPurchasedAt: string): boolean {
  const firstTime = new Date(firstPurchasedAt).getTime();
  const paymentTime = new Date(paymentPurchasedAt).getTime();
  if (!Number.isFinite(firstTime) || !Number.isFinite(paymentTime)) return false;
  const diffInDays = Math.floor((paymentTime - firstTime) / dayMs);
  return diffInDays >= 0 && diffInDays < GOAL_DAYS;
}

export async function POST({ request }) {
  const body = await request.json().catch(() => null);
  const venueId = body?.venue_id;
  const beginOverride = body?.begin_time;
  const endOverride = body?.end_time;

  if (!venueId) {
    return json({ ok: false, error: 'missing_venue_id' }, { status: 400 });
  }

  const { data: connection, error: connectionError } = await supabaseAdmin
    .from('square_connections')
    .select('access_token,last_sync_at')
    .eq('venue_id', venueId)
    .maybeSingle();

  if (connectionError) {
    return json({ ok: false, error: connectionError.message }, { status: 500 });
  }

  if (!connection?.access_token) {
    return json({ ok: false, error: 'square_not_connected' }, { status: 404 });
  }

  const { data: venue, error: venueError } = await supabaseAdmin
    .from('venues')
    .select('name,kickback_guest,kickback_referrer,square_public')
    .eq('id', venueId)
    .maybeSingle();

  if (venueError || !venue) {
    return json({ ok: false, error: venueError?.message ?? 'venue_not_found' }, { status: 404 });
  }

  const { data: locationLinks, error: locationError } = await supabaseAdmin
    .from('square_location_links')
    .select('location_id')
    .eq('venue_id', venueId);

  if (locationError) {
    return json({ ok: false, error: locationError.message }, { status: 500 });
  }

  const allowedLocationIds = new Set(
    (locationLinks ?? []).map((row) => row.location_id).filter(Boolean)
  );

  const now = new Date();
  const lastSync = connection.last_sync_at ? new Date(connection.last_sync_at) : null;
  const beginTime = beginOverride
    ? new Date(beginOverride)
    : lastSync
      ? new Date(lastSync.getTime() - overlapMinutes * 60 * 1000)
      : new Date(now.getTime() - defaultSyncHours * 60 * 60 * 1000);
  const endTime = endOverride ? new Date(endOverride) : now;

  if (Number.isNaN(beginTime.getTime()) || Number.isNaN(endTime.getTime())) {
    return json({ ok: false, error: 'invalid_time_range' }, { status: 400 });
  }

  const payments: SquarePayment[] = [];
  let cursor: string | null = null;
  const baseUrl = getSquareApiBase(connection.access_token);

  do {
    const paymentsUrl = new URL(`${baseUrl}/v2/payments`);
    paymentsUrl.searchParams.set('begin_time', beginTime.toISOString());
    paymentsUrl.searchParams.set('end_time', endTime.toISOString());
    paymentsUrl.searchParams.set('sort_order', 'ASC');
    paymentsUrl.searchParams.set('limit', String(pageLimit));
    if (cursor) paymentsUrl.searchParams.set('cursor', cursor);

    const response = await fetch(paymentsUrl.toString(), {
      headers: {
        Authorization: `Bearer ${connection.access_token}`,
        'Square-Version': squareVersion,
        Accept: 'application/json'
      }
    });

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      return json(
        { ok: false, error: payload?.message ?? 'square_payments_failed' },
        { status: 502 }
      );
    }

    payments.push(...((payload?.payments ?? []) as SquarePayment[]));
    cursor = payload?.cursor ?? null;
  } while (cursor);

  const validPayments = payments.filter((payment) => {
    if (payment.status && payment.status !== 'COMPLETED') return false;
    if (!payment.card_details?.card?.last_4) return false;
    if (
      !payment.card_details?.card?.fingerprint &&
      !payment.card_details?.card?.card_fingerprint
    ) {
      return false;
    }
    if (allowedLocationIds.size > 0 && payment.location_id) {
      return allowedLocationIds.has(payment.location_id);
    }
    return true;
  });

  if (validPayments.length === 0) {
    await supabaseAdmin
      .from('square_connections')
      .update({ last_sync_at: now.toISOString() })
      .eq('venue_id', venueId);
    return json({ ok: true, created: 0 });
  }

  const paymentIds = validPayments.map((payment) => payment.id);
  const { data: existingClaims, error: existingError } = await supabaseAdmin
    .from('claims')
    .select('square_payment_id')
    .in('square_payment_id', paymentIds);

  if (existingError) {
    return json({ ok: false, error: existingError.message }, { status: 500 });
  }

  const existingPaymentIds = new Set(
    (existingClaims ?? [])
      .map((claim) => claim.square_payment_id)
      .filter(Boolean) as string[]
  );

  const fingerprints = Array.from(
    new Set(
      validPayments
        .map((payment) => payment.card_details?.card?.fingerprint ?? payment.card_details?.card?.card_fingerprint)
        .filter(Boolean) as string[]
    )
  );

  if (fingerprints.length === 0) {
    return json({ ok: true, created: 0 });
  }

  const { data: bindings, error: bindingsError } = await supabaseAdmin
    .from('square_card_bindings')
    .select('card_fingerprint,user_id,first_purchased_at')
    .eq('venue_id', venueId)
    .in('card_fingerprint', fingerprints);

  if (bindingsError) {
    return json({ ok: false, error: bindingsError.message }, { status: 500 });
  }

  const fingerprintToUser = new Map<string, string>();
  const fingerprintToFirstPurchasedAt = new Map<string, string>();
  for (const binding of bindings ?? []) {
    if (!binding.card_fingerprint || !binding.user_id) continue;
    fingerprintToUser.set(binding.card_fingerprint, binding.user_id);
    if (binding.first_purchased_at) {
      fingerprintToFirstPurchasedAt.set(binding.card_fingerprint, binding.first_purchased_at);
    }
  }

  const missingFingerprints = fingerprints.filter((fingerprint) => !fingerprintToUser.has(fingerprint));
  if (missingFingerprints.length > 0) {
    const { data: legacyFingerprintClaims, error: legacyFingerprintError } = await supabaseAdmin
      .from('claims')
      .select('square_card_fingerprint,submitter_id,purchased_at,id')
      .eq('venue_id', venueId)
      .in('square_card_fingerprint', missingFingerprints)
      .order('purchased_at', { ascending: true });

    if (legacyFingerprintError) {
      return json({ ok: false, error: legacyFingerprintError.message }, { status: 500 });
    }

    const bindingsToSeed: Array<Record<string, unknown>> = [];
    for (const claim of legacyFingerprintClaims ?? []) {
      if (!claim.square_card_fingerprint || !claim.submitter_id) continue;
      if (fingerprintToUser.has(claim.square_card_fingerprint)) continue;
      fingerprintToUser.set(claim.square_card_fingerprint, claim.submitter_id);
      if (claim.purchased_at) {
        fingerprintToFirstPurchasedAt.set(claim.square_card_fingerprint, claim.purchased_at);
      }
      bindingsToSeed.push({
        venue_id: venueId,
        card_fingerprint: claim.square_card_fingerprint,
        user_id: claim.submitter_id,
        first_claim_id: claim.id ?? null,
        first_purchased_at: claim.purchased_at ?? null,
        updated_at: new Date().toISOString()
      });
    }

    if (bindingsToSeed.length > 0) {
      const { error: seedBindingsError } = await supabaseAdmin
        .from('square_card_bindings')
        .upsert(bindingsToSeed, { onConflict: 'venue_id,card_fingerprint', ignoreDuplicates: true });
      if (seedBindingsError) {
        return json({ ok: false, error: seedBindingsError.message }, { status: 500 });
      }
    }
  }

  const userIds = Array.from(new Set(Array.from(fingerprintToUser.values())));
  if (userIds.length === 0) {
    return json({ ok: true, created: 0 });
  }

  const { data: userClaims, error: userClaimsError } = await supabaseAdmin
    .from('claims')
    .select('submitter_id,referrer_id,referrer,purchased_at')
    .eq('venue_id', venueId)
    .in('submitter_id', userIds)
    .order('purchased_at', { ascending: true });

  if (userClaimsError) {
    return json({ ok: false, error: userClaimsError.message }, { status: 500 });
  }

  const userToReferrer = new Map<
    string,
    { referrer_id: string | null; referrer: string | null }
  >();
  for (const claim of userClaims ?? []) {
    if (!claim.submitter_id) continue;
    if (!userToReferrer.has(claim.submitter_id)) {
      userToReferrer.set(claim.submitter_id, {
        referrer_id: claim.referrer_id ?? null,
        referrer: claim.referrer ?? null
      });
    }
  }

  const autoClaimStatus = venue.square_public === false ? 'pending' : 'approved';

  const claimsToInsert = validPayments
    .filter((payment) => !existingPaymentIds.has(payment.id))
    .map((payment) => {
      const fingerprint =
        payment.card_details?.card?.fingerprint ?? payment.card_details?.card?.card_fingerprint ?? null;
      const submitterId = fingerprint ? fingerprintToUser.get(fingerprint) ?? null : null;
      if (!submitterId) return null;
      const referrer = userToReferrer.get(submitterId) ?? { referrer_id: null, referrer: null };
      const amount = payment.amount_money?.amount != null ? payment.amount_money.amount / 100 : null;
      const firstPurchasedAt = fingerprint ? fingerprintToFirstPurchasedAt.get(fingerprint) ?? null : null;
      if (
        amount == null ||
        !payment.card_details?.card?.last_4 ||
        !payment.created_at ||
        !firstPurchasedAt ||
        !isWithinAutoClaimWindow(firstPurchasedAt, payment.created_at)
      ) {
        return null;
      }
      return {
        venue: venue.name,
        venue_id: venueId,
        submitter_id: submitterId,
        referrer_id: referrer.referrer_id,
        referrer: referrer.referrer,
        amount,
        last_4: payment.card_details.card.last_4,
        purchased_at: payment.created_at,
        created_at: new Date().toISOString(),
        status: autoClaimStatus,
        kickback_guest_rate: venue.kickback_guest ?? null,
        kickback_referrer_rate: venue.kickback_referrer ?? null,
        square_payment_id: payment.id,
        square_card_fingerprint: fingerprint,
        square_location_id: payment.location_id ?? null
      };
    })
    .filter(Boolean) as Record<string, unknown>[];

  if (claimsToInsert.length > 0) {
    const { data: inserted, error: insertError } = await supabaseAdmin
      .from('claims')
      .upsert(claimsToInsert, { onConflict: 'square_payment_id', ignoreDuplicates: true })
      .select('id');
    if (insertError) {
      return json({ ok: false, error: insertError.message }, { status: 500 });
    }
    try {
      const origin = new URL(request.url).origin;
      for (const row of inserted ?? []) {
        const id = (row as { id?: string })?.id;
        if (!id) continue;
        await fetch(`${origin}/api/notifications/claim-created`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ claim_id: id })
        });
      }
    } catch {}
  }

  await supabaseAdmin
    .from('square_connections')
    .update({ last_sync_at: now.toISOString() })
    .eq('venue_id', venueId);

  return json({ ok: true, created: claimsToInsert.length });
}
