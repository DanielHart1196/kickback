import { json } from '@sveltejs/kit';
import { supabaseAdmin } from '$lib/server/supabaseAdmin';
import { listSquarePayments, type SquarePayment } from '$lib/server/square/payments';
const searchWindowMinutes = 10;
const matchToleranceMinutes = 5;

export async function POST({ request }) {
  const body = await request.json().catch(() => null);
  const claimId = body?.claim_id;
  if (!claimId) {
    return json({ ok: false, error: 'missing_claim_id' }, { status: 400 });
  }

  const { data: claim, error: claimError } = await supabaseAdmin
    .from('claims')
    .select('id,venue_id,purchased_at,amount,last_4,square_payment_id,submitter_id')
    .eq('id', claimId)
    .maybeSingle();

  if (claimError) {
    return json({ ok: false, error: claimError.message }, { status: 500 });
  }
  if (!claim?.venue_id || !claim.purchased_at || !claim.amount || !claim.last_4) {
    return json({ ok: false, error: 'claim_missing_fields' }, { status: 400 });
  }
  if (claim.square_payment_id) {
    return json({ ok: true, linked: true });
  }
  if (!claim.submitter_id) {
    return json({ ok: true, linked: false });
  }

  const { data: connection, error: connectionError } = await supabaseAdmin
    .from('square_connections')
    .select('access_token')
    .eq('venue_id', claim.venue_id)
    .maybeSingle();

  if (connectionError) {
    return json({ ok: false, error: connectionError.message }, { status: 500 });
  }
  if (!connection?.access_token) {
    return json({ ok: false, error: 'square_not_connected' }, { status: 404 });
  }

  const { data: locationLinks, error: locationError } = await supabaseAdmin
    .from('square_location_links')
    .select('location_id')
    .eq('venue_id', claim.venue_id);

  if (locationError) {
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
    return json(
      { ok: false, error: paymentsResult.payload?.message ?? 'square_payments_failed' },
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
    return json({ ok: true, linked: false });
  }

  const { error: updateError } = await supabaseAdmin
    .from('claims')
    .update({
      status: 'approved',
      square_payment_id: bestMatch.payment.id,
      square_card_fingerprint: bestMatch.fingerprint,
      square_location_id: bestMatch.payment.location_id ?? null
    })
    .eq('id', claim.id);

  if (updateError) {
    return json({ ok: false, error: updateError.message }, { status: 500 });
  }

  return json({ ok: true, linked: true });
}
