import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { supabaseAdmin } from '$lib/server/supabaseAdmin';
import { addClaimsToUnpaidPayouts, type ClaimPayoutRow } from '$lib/server/payouts';
import { sendEarningsNotificationsForClaims } from '$lib/server/earnings';
import { GOAL_DAYS } from '$lib/claims/constants';

type ClaimStatus = 'pending' | 'approved' | 'paid' | 'guestpaid' | 'refpaid' | 'paidout' | 'denied';
type ClaimStatusRow = ClaimPayoutRow & {
  status: ClaimStatus | null;
};

type InvitationActivationRow = {
  id: string;
  submitter_id: string | null;
  venue_id: string | null;
  venue: string | null;
  referrer: string | null;
  purchased_at: string | null;
};

const dayMs = 24 * 60 * 60 * 1000;

function normalizeReferrerCode(code: string | null): string {
  return String(code ?? '').trim().toUpperCase();
}

export async function POST({ request }: RequestEvent) {
  const authHeader = request.headers.get('authorization') ?? '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';

  if (!token) {
    return json({ ok: false, error: 'missing_token' }, { status: 401 });
  }

  const { data: requesterData, error: requesterError } = await supabaseAdmin.auth.getUser(token);
  if (requesterError || !requesterData?.user) {
    return json({ ok: false, error: 'invalid_token' }, { status: 401 });
  }

  const requesterId = requesterData.user.id;
  const { data: requesterProfile, error: profileError } = await supabaseAdmin
    .from('profiles')
    .select('role')
    .eq('id', requesterId)
    .maybeSingle();
  if (profileError) {
    return json({ ok: false, error: profileError.message }, { status: 500 });
  }
  if (requesterProfile?.role !== 'admin') {
    return json({ ok: false, error: 'forbidden' }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const rawIds = Array.isArray(body?.claim_ids) ? body.claim_ids : [];
  const claimIds = rawIds.map((v: unknown) => String(v)).filter((v: string) => v.length > 0);
  const status: ClaimStatus | null =
    typeof body?.status === 'string' && ['pending', 'approved', 'paid', 'guestpaid', 'refpaid', 'paidout', 'denied'].includes(body.status)
      ? body.status
      : null;

  if (!status || claimIds.length === 0) {
    return json({ ok: false, error: 'missing_params' }, { status: 400 });
  }

  let payoutsCreated = 0;
  if (status === 'denied') {
    const { data: paidEarnings, error: paidEarningsError } = await supabaseAdmin
      .from('earnings')
      .select('id')
      .in('claim_id', claimIds)
      .eq('status', 'paid');
    if (paidEarningsError) {
      return json({ ok: false, error: paidEarningsError.message }, { status: 500 });
    }
    if ((paidEarnings ?? []).length > 0) {
      return json({ ok: false, error: 'cannot_deny_paid_earnings' }, { status: 409 });
    }
  }
  if (status === 'paid') {
    const { data: claims, error: claimsError } = await supabaseAdmin
      .from('claims')
      .select('id, status, amount, kickback_guest_rate, kickback_referrer_rate, submitter_id, referrer_id')
      .in('id', claimIds);
    if (claimsError) {
      return json({ ok: false, error: claimsError.message }, { status: 500 });
    }

    const payoutCandidates = ((claims ?? []) as ClaimStatusRow[])
      .filter(
        (claim) =>
          !['paid', 'guestpaid', 'refpaid', 'paidout'].includes((claim.status ?? 'approved') as string)
      )
      .map((claim) => ({
        id: String(claim.id),
        amount: Number(claim.amount ?? 0),
        kickback_guest_rate: claim.kickback_guest_rate ?? null,
        kickback_referrer_rate: claim.kickback_referrer_rate ?? null,
        submitter_id: claim.submitter_id ?? null,
        referrer_id: claim.referrer_id ?? null
      }));

    if (payoutCandidates.length > 0) {
      const payoutResult = await addClaimsToUnpaidPayouts(payoutCandidates);
      payoutsCreated = payoutResult.rowsInserted + payoutResult.rowsUpdated;
    }
  }

  const { error: updateError } = await supabaseAdmin
    .from('claims')
    .update({ status })
    .in('id', claimIds);
  if (updateError) {
    return json({ ok: false, error: updateError.message }, { status: 500 });
  }

  if (status === 'denied') {
    const { error: earningsError } = await supabaseAdmin
      .from('earnings')
      .update({ status: 'denied' })
      .in('claim_id', claimIds);
    if (earningsError) {
      return json({ ok: false, error: earningsError.message }, { status: 500 });
    }
    const { error: feesError } = await supabaseAdmin
      .from('venue_fees')
      .update({ status: 'denied' })
      .in('claim_id', claimIds);
    if (feesError) {
      return json({ ok: false, error: feesError.message }, { status: 500 });
    }
  }

  if (status === 'approved' || status === 'paid') {
    const { data: activationClaims, error: activationError } = await supabaseAdmin
      .from('claims')
      .select('id, submitter_id, venue_id, venue, referrer, purchased_at')
      .in('id', claimIds);
    if (activationError) {
      return json({ ok: false, error: activationError.message }, { status: 500 });
    }
    const nowIso = new Date().toISOString();
    for (const row of (activationClaims ?? []) as InvitationActivationRow[]) {
      if (!row.submitter_id || !row.venue_id || !row.referrer) continue;
      const referrerCode = normalizeReferrerCode(row.referrer);
      if (!referrerCode) continue;
      const activatedAtIso = row.purchased_at ?? nowIso;
      const activatedAtMs = new Date(activatedAtIso).getTime();
      if (!Number.isFinite(activatedAtMs)) continue;
      const expiresAtIso = new Date(activatedAtMs + GOAL_DAYS * dayMs).toISOString();
      const venueName = String(row.venue ?? '').trim();

      const { data: existingActive } = await supabaseAdmin
        .from('invitations')
        .select('id')
        .eq('user_id', row.submitter_id)
        .eq('venue_id', row.venue_id)
        .eq('status', 'active')
        .maybeSingle();
      if (existingActive?.id) {
        continue;
      }

      const { data: updatedRows, error: updateInviteError } = await supabaseAdmin
        .from('invitations')
        .update({
          status: 'active',
          activated_at: activatedAtIso,
          expires_at: expiresAtIso,
          last_activity_at: nowIso
        })
        .eq('user_id', row.submitter_id)
        .eq('venue_id', row.venue_id)
        .eq('referrer_code', referrerCode)
        .eq('status', 'pending')
        .select('id');
      if (updateInviteError) {
        return json({ ok: false, error: updateInviteError.message }, { status: 500 });
      }
      if (!updatedRows || updatedRows.length === 0) {
        if (!venueName) continue;
        const { error: insertError } = await supabaseAdmin
          .from('invitations')
          .insert(
            {
              user_id: row.submitter_id,
              venue_id: row.venue_id,
              venue_name: venueName,
              referrer_code: referrerCode,
              status: 'active',
              activated_at: activatedAtIso,
              expires_at: expiresAtIso,
              last_activity_at: nowIso
            },
            { onConflict: 'user_id,venue_id,referrer_code', ignoreDuplicates: true }
          );
        if (insertError) {
          return json({ ok: false, error: insertError.message }, { status: 500 });
        }
      }
      await supabaseAdmin
        .from('invitations')
        .delete()
        .eq('user_id', row.submitter_id)
        .eq('venue_id', row.venue_id)
        .eq('status', 'pending');
    }
  }

  if (status === 'approved' || status === 'paid') {
    try {
      const origin = new URL(request.url).origin;
      await Promise.all(
        claimIds.map((id: string) =>
          fetch(`${origin}/api/notifications/claim-created`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ claim_id: id })
          }).catch(() => null)
        )
      );
    } catch {}
  }

  if (status === 'approved') {
    try {
      await sendEarningsNotificationsForClaims(claimIds);
    } catch {}
  }

  return json({ ok: true, updated: claimIds.length, status, payouts_created: payoutsCreated });
}
