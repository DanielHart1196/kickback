import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { createHash, randomBytes } from 'crypto';
import { supabaseAdmin } from '$lib/server/supabaseAdmin';
import { listSquarePayments, type SquarePayment } from '$lib/server/square/payments';
import { isFingerprintBlocked } from '$lib/server/square/fingerprints';
import { createEarningsForClaimId } from '$lib/server/earnings';
import { GOAL_DAYS } from '$lib/claims/constants';
const searchWindowMinutes = 10;
const matchToleranceMinutes = 5;
const dayMs = 24 * 60 * 60 * 1000;

function normalizeReferrerCode(code: string | null): string {
  return String(code ?? '').trim().toUpperCase();
}

export async function POST({ request }: RequestEvent) {
  const body = await request.json().catch(() => null);
  const claimId = body?.claim_id;
  const guestMode = Boolean(body?.guest_mode);
  const cleanupOnFail = Boolean(body?.cleanup_on_fail);
  if (!claimId) {
    return json({ ok: false, error: 'missing_claim_id' }, { status: 400 });
  }

  const cleanupClaimOnFailure = async () => {
    if (!cleanupOnFail) return;
    try {
      await supabaseAdmin
        .from('claims')
        .delete()
        .eq('id', claimId)
        .is('square_payment_id', null)
        .eq('status', 'pending');
    } catch {}
  };

  const { data: claim, error: claimError } = await supabaseAdmin
    .from('claims')
    .select('id,venue_id,venue,referrer,purchased_at,amount,last_4,square_payment_id,submitter_id')
    .eq('id', claimId)
    .maybeSingle();

  if (claimError) {
    return json({ ok: false, error: claimError.message }, { status: 500 });
  }
  if (!claim?.venue_id || !claim.purchased_at || !claim.amount || !claim.last_4) {
    await cleanupClaimOnFailure();
    return json({ ok: false, error: 'claim_missing_fields' }, { status: 400 });
  }
  if (claim.square_payment_id) {
    return json({ ok: true, linked: true });
  }

  const { data: connection, error: connectionError } = await supabaseAdmin
    .from('square_connections')
    .select('access_token')
    .eq('venue_id', claim.venue_id)
    .maybeSingle();

  if (connectionError) {
    await cleanupClaimOnFailure();
    return json({ ok: false, error: connectionError.message }, { status: 500 });
  }
  if (!connection?.access_token) {
    await cleanupClaimOnFailure();
    return json({ ok: false, error: 'square_not_connected' }, { status: 404 });
  }

  const { data: locationLinks, error: locationError } = await supabaseAdmin
    .from('square_location_links')
    .select('location_id')
    .eq('venue_id', claim.venue_id);

  if (locationError) {
    await cleanupClaimOnFailure();
    return json({ ok: false, error: locationError.message }, { status: 500 });
  }

  const allowedLocationIds = new Set(
    (locationLinks ?? []).map((row) => row.location_id).filter(Boolean)
  );

  const claimTime = new Date(claim.purchased_at);
  const beginTime = new Date(claimTime.getTime() - searchWindowMinutes * 60 * 1000);
  const endTime = new Date(claimTime.getTime() + searchWindowMinutes * 60 * 1000);

  const paymentsResult = await listSquarePayments(connection.access_token, {
    begin_time: beginTime.toISOString(),
    end_time: endTime.toISOString(),
    sort_order: 'ASC',
    limit: 200
  });
  if (!paymentsResult.ok) {
    await cleanupClaimOnFailure();
    return json(
      { ok: false, error: 'square_payments_failed' },
      { status: 502 }
    );
  }

  const payments = (paymentsResult.payload?.payments ?? []) as SquarePayment[];
  let bestMatch: { payment: SquarePayment; fingerprint: string } | null = null;
  let bestDiff = Number.POSITIVE_INFINITY;

  for (const payment of payments) {
    if (payment.status && payment.status !== 'COMPLETED') continue;
    const last4 = payment.card_details?.card?.last_4;
    const fingerprint =
      payment.card_details?.card?.fingerprint ??
      payment.card_details?.card?.card_fingerprint ??
      null;
    const amount = payment.amount_money?.amount;
    const createdAt = payment.created_at;
    if (!last4 || !fingerprint || amount == null || !createdAt) continue;
    if (String(last4).trim() !== String(claim.last_4).trim()) continue;
    if (Number(claim.amount).toFixed(2) !== (amount / 100).toFixed(2)) continue;
    if (allowedLocationIds.size > 0 && payment.location_id) {
      if (!allowedLocationIds.has(payment.location_id)) continue;
    }

    const paymentTime = new Date(createdAt);
    if (Number.isNaN(paymentTime.getTime())) continue;
    const diffMs = Math.abs(paymentTime.getTime() - claimTime.getTime());
    if (diffMs <= matchToleranceMinutes * 60 * 1000 && diffMs < bestDiff) {
      bestDiff = diffMs;
      bestMatch = { payment, fingerprint };
    }
  }

  if (!bestMatch) {
    await cleanupClaimOnFailure();
    return json({ ok: true, linked: false });
  }

  const { data: existingByPayment, error: existingByPaymentError } = await supabaseAdmin
    .from('claims')
    .select('id,submitter_id')
    .eq('square_payment_id', bestMatch.payment.id)
    .limit(1);

  if (existingByPaymentError) {
    await cleanupClaimOnFailure();
    return json({ ok: false, error: existingByPaymentError.message }, { status: 500 });
  }

  const alreadyLinkedClaim = existingByPayment?.[0] ?? null;
  if (alreadyLinkedClaim && alreadyLinkedClaim.id !== claim.id) {
    await cleanupClaimOnFailure();
    return json({
      ok: true,
      linked: false,
      duplicate: true,
      by_same_user: (alreadyLinkedClaim.submitter_id ?? null) === (claim.submitter_id ?? null)
    });
  }

  const { data: binding, error: bindingError } = await supabaseAdmin
    .from('square_card_bindings')
    .select('user_id')
    .eq('venue_id', claim.venue_id)
    .eq('card_fingerprint', bestMatch.fingerprint)
    .maybeSingle();

  if (bindingError) {
    await cleanupClaimOnFailure();
    return json({ ok: false, error: bindingError.message }, { status: 500 });
  }

  if (binding?.user_id) {
    if (!claim.submitter_id || binding.user_id !== claim.submitter_id) {
      await cleanupClaimOnFailure();
      return json({ ok: false, error: 'card_bound_to_other_user' }, { status: 409 });
    }
  } else if (claim.submitter_id) {
    const { error: createBindingError } = await supabaseAdmin
      .from('square_card_bindings')
      .upsert(
        {
          venue_id: claim.venue_id,
          card_fingerprint: bestMatch.fingerprint,
          user_id: claim.submitter_id,
          first_claim_id: claim.id,
          first_purchased_at: claim.purchased_at,
          updated_at: new Date().toISOString()
        },
        { onConflict: 'venue_id,card_fingerprint', ignoreDuplicates: true }
      );
    if (createBindingError) {
      await cleanupClaimOnFailure();
      return json({ ok: false, error: createBindingError.message }, { status: 500 });
    }
  }

  const { data: venue, error: venueError } = await supabaseAdmin
    .from('venues')
    .select('square_public,new_customers_only')
    .eq('id', claim.venue_id)
    .maybeSingle();

  if (venueError) {
    await cleanupClaimOnFailure();
    return json({ ok: false, error: venueError.message }, { status: 500 });
  }

  if (venue?.new_customers_only) {
    try {
      const blocked = await isFingerprintBlocked({
        venueId: claim.venue_id,
        fingerprint: bestMatch.fingerprint
      });
      if (blocked) {
        await cleanupClaimOnFailure();
        return json({
          ok: true,
          linked: false,
          new_customer_only_blocked: true
        });
      }
    } catch (error: any) {
      await cleanupClaimOnFailure();
      return json({ ok: false, error: error?.message ?? 'fingerprint_check_failed' }, { status: 500 });
    }
  }

  const autoClaimStatus = venue?.square_public === false ? 'pending' : 'approved';

  const { error: updateError } = await supabaseAdmin
    .from('claims')
    .update({
      status: autoClaimStatus,
      square_payment_id: bestMatch.payment.id,
      square_card_fingerprint: bestMatch.fingerprint,
      square_location_id: bestMatch.payment.location_id ?? null
    })
    .eq('id', claim.id);

  if (updateError) {
    if (String(updateError.message ?? '').toLowerCase().includes('duplicate key')) {
      await cleanupClaimOnFailure();
      return json({ ok: true, linked: false, duplicate: true, by_same_user: false });
    }
    await cleanupClaimOnFailure();
    return json({ ok: false, error: updateError.message }, { status: 500 });
  }

  if (autoClaimStatus === 'approved') {
    try {
      const submitterId = claim.submitter_id ?? null;
      const venueId = claim.venue_id ?? null;
      const referrerCode = normalizeReferrerCode(claim.referrer ?? null);
      if (submitterId && venueId && referrerCode) {
        const { data: existingActive } = await supabaseAdmin
          .from('invitations')
          .select('id')
          .eq('user_id', submitterId)
          .eq('venue_id', venueId)
          .eq('status', 'active')
          .maybeSingle();
        if (existingActive?.id) {
          return json({ ok: true, linked: true, activation_skipped: true });
        }
        const activatedAtIso = claim.purchased_at ?? bestMatch.payment.created_at ?? new Date().toISOString();
        const activatedAtMs = new Date(activatedAtIso).getTime();
        if (Number.isFinite(activatedAtMs)) {
          const expiresAtIso = new Date(activatedAtMs + GOAL_DAYS * dayMs).toISOString();
          const venueName = String(claim.venue ?? '').trim();
          const { data: updatedRows, error: updateInviteError } = await supabaseAdmin
            .from('invitations')
            .update({
              status: 'active',
              activated_at: activatedAtIso,
              expires_at: expiresAtIso,
              last_activity_at: new Date().toISOString()
            })
            .eq('user_id', submitterId)
            .eq('venue_id', venueId)
            .eq('referrer_code', referrerCode)
            .eq('status', 'pending')
            .select('id');
          if (!updateInviteError && (!updatedRows || updatedRows.length === 0)) {
            if (venueName) {
              await supabaseAdmin
                .from('invitations')
                .upsert(
                  {
                    user_id: submitterId,
                    venue_id: venueId,
                    venue_name: venueName,
                    referrer_code: referrerCode,
                    status: 'active',
                    activated_at: activatedAtIso,
                    expires_at: expiresAtIso,
                    last_activity_at: new Date().toISOString()
                  },
                  { onConflict: 'user_id,venue_id,referrer_code', ignoreDuplicates: true }
                );
            }
          }
          await supabaseAdmin
            .from('invitations')
            .delete()
            .eq('user_id', submitterId)
            .eq('venue_id', venueId)
            .eq('status', 'pending');
        }
      }
    } catch {}
  }

  try {
    const origin = new URL(request.url).origin;
    await fetch(`${origin}/api/notifications/claim-created`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ claim_id: claim.id })
    });
  } catch {}
  if (!claim.submitter_id) {
    if (guestMode) {
      const earningsResult = await createEarningsForClaimId(String(claim.id), {
        allowGuestWithoutSubmitter: true
      });
      if (!earningsResult.ok) {
        await cleanupClaimOnFailure();
        return json({ ok: false, error: earningsResult.error ?? 'failed_to_create_guest_earnings' }, { status: 500 });
      }
      return json({ ok: true, linked: true, guest_claim: true });
    }
    try {
      const activationToken = randomBytes(24).toString('hex');
      const tokenHash = createHash('sha256').update(activationToken).digest('hex');
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

      await supabaseAdmin
        .from('activation_claim_tokens')
        .delete()
        .eq('claim_id', claim.id)
        .is('claimed_at', null);

      const { error: tokenError } = await supabaseAdmin
        .from('activation_claim_tokens')
        .insert({
          claim_id: claim.id,
          token_hash: tokenHash,
          expires_at: expiresAt
        });

      if (!tokenError) {
        return json({ ok: true, linked: true, activation_token: activationToken });
      }
    } catch {}
  }

  return json({ ok: true, linked: true });
}
