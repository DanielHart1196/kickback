import { json, type RequestHandler } from '@sveltejs/kit';
import { supabaseAdmin } from '$lib/server/supabaseAdmin';
import { addClaimsToUnpaidPayouts, type ClaimPayoutRow } from '$lib/server/payouts';

type ClaimStatus = 'pending' | 'approved' | 'paid' | 'guestpaid' | 'refpaid' | 'paidout' | 'denied' | null;
type InvoiceClaimRow = ClaimPayoutRow & {
  status: ClaimStatus;
  venue_id: string | null;
  venue: string | null;
  purchased_at: string | null;
};

function isMarkPaid(value: unknown): boolean {
  return value === true || value === 'true';
}

export const POST: RequestHandler = async ({ request }) => {
  const authHeader = request.headers.get('authorization') ?? '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!token) {
    return json({ ok: false, error: 'missing_token' }, { status: 401 });
  }

  const { data: requesterData, error: requesterError } = await supabaseAdmin.auth.getUser(token);
  if (requesterError || !requesterData?.user) {
    return json({ ok: false, error: 'invalid_token' }, { status: 401 });
  }

  const { data: requesterProfile, error: profileError } = await supabaseAdmin
    .from('profiles')
    .select('role')
    .eq('id', requesterData.user.id)
    .maybeSingle();
  if (profileError) {
    return json({ ok: false, error: profileError.message }, { status: 500 });
  }
  if (requesterProfile?.role !== 'admin') {
    return json({ ok: false, error: 'forbidden' }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const invoiceId = typeof body?.stripe_invoice_id === 'string' ? body.stripe_invoice_id.trim() : '';
  const markPaid = isMarkPaid(body?.mark_paid);
  if (!invoiceId) {
    return json({ ok: false, error: 'missing_stripe_invoice_id' }, { status: 400 });
  }

  const { data: invoice, error: invoiceError } = await supabaseAdmin
    .from('venue_invoices')
    .select('venue_id, week_start, week_end')
    .eq('stripe_invoice_id', invoiceId)
    .maybeSingle();
  if (invoiceError || !invoice) {
    return json({ ok: false, error: invoiceError?.message ?? 'invoice_not_found' }, { status: 404 });
  }

  const venueId = String(invoice.venue_id ?? '');
  const weekStart = String(invoice.week_start ?? '');
  const weekEnd = String(invoice.week_end ?? '');
  if (!venueId || !weekStart || !weekEnd) {
    return json({ ok: false, error: 'invoice_missing_metadata' }, { status: 400 });
  }

  const endNext = new Date(weekEnd);
  endNext.setDate(endNext.getDate() + 1);
  const endNextIso = endNext.toISOString();

  const { data: claimsByRange, error: claimsError } = await supabaseAdmin
    .from('claims')
    .select('id, status, venue_id, venue, purchased_at, amount, kickback_guest_rate, kickback_referrer_rate, submitter_id, referrer_id')
    .gte('purchased_at', weekStart)
    .lt('purchased_at', endNextIso);
  if (claimsError) {
    return json({ ok: false, error: claimsError.message }, { status: 500 });
  }

  const { data: venue } = await supabaseAdmin.from('venues').select('name').eq('id', venueId).maybeSingle();
  const venueName = String(venue?.name ?? '').trim().toLowerCase();

  const includedClaims = ((claimsByRange ?? []) as InvoiceClaimRow[]).filter((claim) => {
    const idMatch = String(claim?.venue_id ?? '') === venueId;
    const nameMatch = venueName.length > 0 && String(claim?.venue ?? '').trim().toLowerCase() === venueName;
    if (!idMatch && !nameMatch) return false;
    const status = (claim?.status ?? null) as ClaimStatus;
    return status === null || status === 'approved' || status === 'paid' || status === 'guestpaid' || status === 'refpaid' || status === 'paidout';
  });

  const claimIds = includedClaims.map((claim) => String(claim.id ?? '')).filter(Boolean);
  const paidStatuses = new Set(['paid', 'guestpaid', 'refpaid', 'paidout']);
  const paidCount = includedClaims.filter((claim) => paidStatuses.has((claim.status ?? 'approved') as string)).length;
  const unpaidIds = includedClaims
    .filter((claim) => !paidStatuses.has((claim.status ?? 'approved') as string))
    .map((claim) => String(claim.id ?? ''))
    .filter(Boolean);

  let markedPaid = 0;
  if (markPaid && unpaidIds.length > 0) {
    const claimsToAddToPayouts = includedClaims
      .filter((claim) => unpaidIds.includes(String(claim.id ?? '')))
      .map((claim) => ({
        id: String(claim.id),
        amount: Number(claim.amount ?? 0),
        kickback_guest_rate: claim.kickback_guest_rate ?? null,
        kickback_referrer_rate: claim.kickback_referrer_rate ?? null,
        submitter_id: claim.submitter_id ?? null,
        referrer_id: claim.referrer_id ?? null
      }));

    if (claimsToAddToPayouts.length > 0) {
      await addClaimsToUnpaidPayouts(claimsToAddToPayouts);
    }

    const { error: updateError } = await supabaseAdmin
      .from('claims')
      .update({ status: 'paid' })
      .in('id', unpaidIds);
    if (updateError) {
      return json({ ok: false, error: updateError.message }, { status: 500 });
    }
    markedPaid = unpaidIds.length;
  }

  return json({
    ok: true,
    stripe_invoice_id: invoiceId,
    venue_id: venueId,
    week_start: weekStart,
    week_end: weekEnd,
    claims_included: claimIds.length,
    claims_paid: markPaid ? paidCount + markedPaid : paidCount,
    claims_unpaid: markPaid ? Math.max(0, unpaidIds.length - markedPaid) : unpaidIds.length,
    mark_paid: markPaid,
    marked_paid: markedPaid,
    claim_ids: claimIds
  });
};
