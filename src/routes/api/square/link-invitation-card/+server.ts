import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { GOAL_DAYS } from '$lib/claims/constants';
import { getVenueRatesForTime } from '$lib/venues/happyHour';
import { createEarningsForClaimId } from '$lib/server/earnings';
import { isFingerprintBlocked } from '$lib/server/square/fingerprints';
import { fetchSquarePayment } from '$lib/server/square/payments';
import { supabaseAdmin } from '$lib/server/supabaseAdmin';

const recentWindowMinutes = 10;
const dayMs = 24 * 60 * 60 * 1000;

function normalizeReferralCode(code: string | null | undefined): string {
  return String(code ?? '').trim().toUpperCase();
}

function isDuplicateError(message: string | null | undefined): boolean {
  const value = String(message ?? '').toLowerCase();
  return value.includes('duplicate key') || value.includes('unique constraint');
}

export async function POST({ request }: RequestEvent) {
  const authHeader = request.headers.get('authorization') ?? '';
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!bearer) {
    return json({ ok: false, error: 'missing_token' }, { status: 401 });
  }

  const { data: requesterData, error: requesterError } = await supabaseAdmin.auth.getUser(bearer);
  if (requesterError || !requesterData?.user) {
    return json({ ok: false, error: 'invalid_token' }, { status: 401 });
  }
  const userId = requesterData.user.id;

  const body = await request.json().catch(() => null);
  const venueId = String(body?.venue_id ?? '').trim();
  const paymentId = String(body?.payment_id ?? '').trim();
  const referrerCode = normalizeReferralCode(body?.referrer_code);
  const confirmedLast4 = String(body?.last_4 ?? '').replace(/\D/g, '').slice(-4);
  if (!venueId || !paymentId || !referrerCode || confirmedLast4.length !== 4) {
    return json({ ok: false, error: 'missing_fields' }, { status: 400 });
  }

  const { data: invitations, error: inviteError } = await supabaseAdmin
    .from('invitations')
    .select('id, venue_name, status')
    .eq('user_id', userId)
    .eq('venue_id', venueId)
    .eq('referrer_code', referrerCode)
    .in('status', ['pending', 'active'])
    .order('created_at', { ascending: false });

  if (inviteError) {
    return json({ ok: false, error: inviteError.message }, { status: 500 });
  }

  const invite =
    (invitations ?? []).find((row) => row.status === 'pending') ??
    (invitations ?? []).find((row) => row.status === 'active') ??
    null;
  if (!invite?.id) {
    return json({ ok: false, error: 'invitation_not_found' }, { status: 404 });
  }

  const [{ data: connection, error: connectionError }, { data: venue, error: venueError }] =
    await Promise.all([
      supabaseAdmin
        .from('square_connections')
        .select('access_token')
        .eq('venue_id', venueId)
        .maybeSingle(),
      supabaseAdmin
        .from('venues')
        .select('name,square_public,new_customers_only,kickback_guest,kickback_referrer,happy_hour_start_time,happy_hour_end_time,happy_hour_days,happy_hour_start_time_2,happy_hour_end_time_2,happy_hour_days_2,happy_hour_start_time_3,happy_hour_end_time_3,happy_hour_days_3')
        .eq('id', venueId)
        .maybeSingle()
    ]);

  if (connectionError) {
    return json({ ok: false, error: connectionError.message }, { status: 500 });
  }
  if (venueError) {
    return json({ ok: false, error: venueError.message }, { status: 500 });
  }
  if (!connection?.access_token) {
    return json({ ok: false, error: 'square_not_connected' }, { status: 404 });
  }
  if (!venue?.name) {
    return json({ ok: false, error: 'venue_not_found' }, { status: 404 });
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

  const paymentResult = await fetchSquarePayment(connection.access_token, paymentId);
  if (!paymentResult.ok || !paymentResult.payload?.payment) {
    return json({ ok: false, error: 'payment_not_found' }, { status: 404 });
  }

  const payment = paymentResult.payload.payment;
  if (payment.status && payment.status !== 'COMPLETED') {
    return json({ ok: false, error: 'payment_not_completed' }, { status: 409 });
  }
  if (allowedLocationIds.size > 0 && payment.location_id) {
    if (!allowedLocationIds.has(payment.location_id)) {
      return json({ ok: false, error: 'payment_not_allowed_for_venue' }, { status: 409 });
    }
  }

  const createdAt = payment.created_at ?? '';
  const amountCents = payment.amount_money?.amount;
  const last4 = payment.card_details?.card?.last_4 ?? '';
  const fingerprint =
    payment.card_details?.card?.fingerprint ??
    payment.card_details?.card?.card_fingerprint ??
    null;

  if (!createdAt || amountCents == null || !last4 || !fingerprint) {
    return json({ ok: false, error: 'payment_missing_card_details' }, { status: 409 });
  }
  if (confirmedLast4 !== String(last4).trim()) {
    return json({ ok: false, error: 'last4_mismatch' }, { status: 409 });
  }

  const paymentMs = new Date(createdAt).getTime();
  const now = Date.now();
  if (!Number.isFinite(paymentMs) || paymentMs < now - recentWindowMinutes * 60 * 1000 || paymentMs > now) {
    return json({ ok: false, error: 'payment_outside_recent_window' }, { status: 409 });
  }

  const { data: referrerProfile, error: referrerError } = await supabaseAdmin
    .from('profiles')
    .select('id, referral_code')
    .or(`referral_code.ilike.${referrerCode},referral_code_original.ilike.${referrerCode}`)
    .limit(1)
    .maybeSingle();

  if (referrerError) {
    return json({ ok: false, error: referrerError.message }, { status: 500 });
  }
  if (!referrerProfile?.id) {
    return json({ ok: false, error: 'referrer_not_found' }, { status: 404 });
  }
  if (referrerProfile.id === userId) {
    return json({ ok: false, error: 'self_referral_not_allowed' }, { status: 409 });
  }

  const { data: existingBinding, error: bindingReadError } = await supabaseAdmin
    .from('square_card_bindings')
    .select('user_id')
    .eq('venue_id', venueId)
    .eq('card_fingerprint', fingerprint)
    .maybeSingle();

  if (bindingReadError) {
    return json({ ok: false, error: bindingReadError.message }, { status: 500 });
  }
  if (existingBinding?.user_id && existingBinding.user_id !== userId) {
    return json({ ok: false, error: 'card_bound_to_other_user' }, { status: 409 });
  }

  if (venue.new_customers_only) {
    try {
      const blocked = await isFingerprintBlocked({
        venueId,
        fingerprint,
        now: new Date(now)
      });
      if (blocked) {
        return json({ ok: false, error: 'new_customer_only_blocked' }, { status: 409 });
      }
    } catch (error: any) {
      return json({ ok: false, error: error?.message ?? 'fingerprint_check_failed' }, { status: 500 });
    }
  }

  const { data: existingClaim, error: existingClaimError } = await supabaseAdmin
    .from('claims')
    .select('id,submitter_id')
    .eq('square_payment_id', paymentId)
    .maybeSingle();

  if (existingClaimError) {
    return json({ ok: false, error: existingClaimError.message }, { status: 500 });
  }
  if (existingClaim?.submitter_id && existingClaim.submitter_id !== userId) {
    return json({ ok: false, error: 'payment_already_linked' }, { status: 409 });
  }

  const autoClaimStatus = venue.square_public === false ? 'pending' : 'approved';
  let claimId = existingClaim?.id ? String(existingClaim.id) : null;
  let createdClaim = false;

  if (!claimId) {
    const rates = getVenueRatesForTime(venue, createdAt, 5);
    const claimPayload = {
      venue: venue.name,
      venue_id: venueId,
      submitter_id: userId,
      referrer_id: referrerProfile.id,
      referrer: referrerCode,
      amount: amountCents / 100,
      last_4: last4,
      purchased_at: createdAt,
      created_at: new Date().toISOString(),
      status: autoClaimStatus,
      kickback_guest_rate: rates.guestRate,
      kickback_referrer_rate: rates.referrerRate,
      square_payment_id: paymentId,
      square_card_fingerprint: fingerprint,
      square_location_id: payment.location_id ?? null
    };

    const { data: insertedClaim, error: insertError } = await supabaseAdmin
      .from('claims')
      .insert(claimPayload)
      .select('id')
      .maybeSingle();

    if (insertError) {
      if (!isDuplicateError(insertError.message)) {
        return json({ ok: false, error: insertError.message }, { status: 500 });
      }
      const { data: duplicateClaim, error: duplicateReadError } = await supabaseAdmin
        .from('claims')
        .select('id,submitter_id')
        .eq('square_payment_id', paymentId)
        .maybeSingle();
      if (duplicateReadError) {
        return json({ ok: false, error: duplicateReadError.message }, { status: 500 });
      }
      if (duplicateClaim?.submitter_id && duplicateClaim.submitter_id !== userId) {
        return json({ ok: false, error: 'payment_already_linked' }, { status: 409 });
      }
      claimId = duplicateClaim?.id ? String(duplicateClaim.id) : null;
    } else {
      claimId = insertedClaim?.id ? String(insertedClaim.id) : null;
      createdClaim = Boolean(claimId);
    }
  }

  const { error: bindingWriteError } = await supabaseAdmin
    .from('square_card_bindings')
    .upsert(
      {
        venue_id: venueId,
        card_fingerprint: fingerprint,
        user_id: userId,
        first_claim_id: claimId,
        first_purchased_at: createdAt,
        updated_at: new Date().toISOString()
      },
      { onConflict: 'venue_id,card_fingerprint' }
    );

  if (bindingWriteError) {
    return json({ ok: false, error: bindingWriteError.message }, { status: 500 });
  }

  const activatedAtIso = createdAt;
  const expiresAtIso = new Date(new Date(activatedAtIso).getTime() + GOAL_DAYS * dayMs).toISOString();

  if (invite.status === 'pending') {
    const { data: activatedRows, error: activateError } = await supabaseAdmin
      .from('invitations')
      .update({
        status: 'active',
        activated_at: activatedAtIso,
        expires_at: expiresAtIso,
        last_activity_at: new Date().toISOString()
      })
      .eq('user_id', userId)
      .eq('venue_id', venueId)
      .eq('referrer_code', referrerCode)
      .eq('status', 'pending')
      .select('id');

    if (activateError) {
      return json({ ok: false, error: activateError.message }, { status: 500 });
    }

    if (!activatedRows || activatedRows.length === 0) {
      const { error: activateUpsertError } = await supabaseAdmin
        .from('invitations')
        .upsert(
          {
            user_id: userId,
            venue_id: venueId,
            venue_name: invite.venue_name ?? venue.name,
            referrer_code: referrerCode,
            status: 'active',
            activated_at: activatedAtIso,
            expires_at: expiresAtIso,
            last_activity_at: new Date().toISOString()
          },
          { onConflict: 'user_id,venue_id,referrer_code' }
        );
      if (activateUpsertError) {
        return json({ ok: false, error: activateUpsertError.message }, { status: 500 });
      }
    }
  } else {
    const { error: touchActiveError } = await supabaseAdmin
      .from('invitations')
      .update({
        last_activity_at: new Date().toISOString(),
        expires_at: expiresAtIso
      })
      .eq('id', invite.id);
    if (touchActiveError) {
      return json({ ok: false, error: touchActiveError.message }, { status: 500 });
    }
  }

  await supabaseAdmin
    .from('invitations')
    .delete()
    .eq('user_id', userId)
    .eq('venue_id', venueId)
    .eq('status', 'pending');

  if (claimId && autoClaimStatus === 'approved') {
    try {
      await createEarningsForClaimId(claimId);
    } catch {}
  }

  if (createdClaim && claimId) {
    try {
      const origin = new URL(request.url).origin;
      await fetch(`${origin}/api/notifications/claim-created`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ claim_id: claimId })
      });
    } catch {}
  }

  return json({ ok: true, claim_id: claimId, activated: true });
}
