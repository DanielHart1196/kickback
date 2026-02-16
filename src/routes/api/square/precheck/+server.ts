import { json } from '@sveltejs/kit';
import { supabaseAdmin } from '$lib/server/supabaseAdmin';
import { listSquarePayments, type SquarePayment } from '$lib/server/square/payments';

const searchWindowMinutes = 10;

export async function POST({ request }) {
  const body = await request.json().catch(() => null);
  const venueId = body?.venue_id;
  const amount = body?.amount;
  const last4 = body?.last_4;
  const purchasedAt = body?.purchased_at;
  const submitterId = body?.submitter_id ?? null;

  if (!venueId || amount == null || !last4 || !purchasedAt) {
    return json({ ok: false, error: 'missing_fields' }, { status: 400 });
  }

  const { data: connection, error: connectionError } = await supabaseAdmin
    .from('square_connections')
    .select('access_token')
    .eq('venue_id', venueId)
    .maybeSingle();
  if (connectionError) {
    return json({ ok: false, error: connectionError.message }, { status: 500 });
  }
  if (!connection?.access_token) {
    return json({ ok: true, connected: false, duplicate: false });
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

  const claimTime = new Date(purchasedAt);
  if (Number.isNaN(claimTime.getTime())) {
    return json({ ok: false, error: 'invalid_time' }, { status: 400 });
  }
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
      { ok: false, error: 'square_payments_failed' },
      { status: 502 }
    );
  }

  const payments = (paymentsResult.payload?.payments ?? []) as SquarePayment[];
  let matched: { paymentId: string; fingerprint: string; locationId: string | null } | null = null;

  for (const payment of payments) {
    if (payment.status && payment.status !== 'COMPLETED') continue;
    const pLast4 = payment.card_details?.card?.last_4;
    const fingerprint =
      payment.card_details?.card?.fingerprint ?? payment.card_details?.card?.card_fingerprint ?? null;
    const amountCents = payment.amount_money?.amount;
    const createdAt = payment.created_at;
    if (!pLast4 || !fingerprint || amountCents == null || !createdAt) continue;
    if (String(pLast4).trim() !== String(last4).trim()) continue;
    if ((amountCents / 100).toFixed(2) !== Number(amount).toFixed(2)) continue;
    if (allowedLocationIds.size > 0 && payment.location_id) {
      if (!allowedLocationIds.has(payment.location_id)) continue;
    }
    matched = { paymentId: payment.id, fingerprint, locationId: payment.location_id ?? null };
    break;
  }

  if (!matched) {
    return json({ ok: true, connected: true, duplicate: false });
  }

  if (submitterId) {
    const { data: binding, error: bindingError } = await supabaseAdmin
      .from('square_card_bindings')
      .select('user_id')
      .eq('venue_id', venueId)
      .eq('card_fingerprint', matched.fingerprint)
      .maybeSingle();

    if (bindingError) {
      return json({ ok: false, error: bindingError.message }, { status: 500 });
    }

    if (binding?.user_id && binding.user_id !== submitterId) {
      return json({
        ok: true,
        connected: true,
        duplicate: false,
        by_same_user: false,
        bound_to_other_user: true
      });
    }
  }

  const { data: existing, error: existError } = await supabaseAdmin
    .from('claims')
    .select('id,submitter_id')
    .eq('square_payment_id', matched.paymentId)
    .limit(1);
  if (existError) {
    return json({ ok: false, error: existError.message }, { status: 500 });
  }

  const alreadyLinked = (existing ?? []).length > 0;
  const bySameUser =
    alreadyLinked && submitterId ? (existing?.[0]?.submitter_id ?? null) === submitterId : false;

  return json({
    ok: true,
    connected: true,
    duplicate: alreadyLinked,
    by_same_user: bySameUser,
    bound_to_other_user: false
  });
}
