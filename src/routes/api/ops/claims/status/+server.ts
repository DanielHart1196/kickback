import { json } from '@sveltejs/kit';
import { supabaseAdmin } from '$lib/server/supabaseAdmin';
import { addClaimsToUnpaidPayouts, type ClaimPayoutRow } from '$lib/server/payouts';

type ClaimStatus = 'pending' | 'approved' | 'paid' | 'guestpaid' | 'refpaid' | 'paidout' | 'denied';
type ClaimStatusRow = ClaimPayoutRow & {
  status: ClaimStatus | null;
};

export async function POST({ request }) {
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

  return json({ ok: true, updated: claimIds.length, status, payouts_created: payoutsCreated });
}
