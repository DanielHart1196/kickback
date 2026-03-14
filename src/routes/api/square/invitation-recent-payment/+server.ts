import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { supabaseAdmin } from '$lib/server/supabaseAdmin';
import { isFingerprintBlocked } from '$lib/server/square/fingerprints';
import { listSquarePayments, type SquarePayment } from '$lib/server/square/payments';

const recentWindowMinutes = 10;

function normalizeReferralCode(code: string | null | undefined): string {
  return String(code ?? '').trim().toUpperCase();
}

type EligiblePayment = {
  paymentId: string;
  amount: number;
  last4: string;
  fingerprint: string;
  createdAt: string;
  locationId: string | null;
};

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
  const referrerCode = normalizeReferralCode(body?.referrer_code);
  if (!venueId || !referrerCode) {
    return json({ ok: false, error: 'missing_fields' }, { status: 400 });
  }

  const { data: invite } = await supabaseAdmin
    .from('invitations')
    .select('id')
    .eq('user_id', userId)
    .eq('venue_id', venueId)
    .eq('referrer_code', referrerCode)
    .eq('status', 'pending')
    .limit(1)
    .maybeSingle();

  if (!invite?.id) {
    return json({ ok: true, candidates: [] });
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
        .select('name,new_customers_only')
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
    return json({ ok: true, candidates: [] });
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
  const beginTime = new Date(now.getTime() - recentWindowMinutes * 60 * 1000);

  const paymentsResult = await listSquarePayments(connection.access_token, {
    begin_time: beginTime.toISOString(),
    end_time: now.toISOString(),
    sort_order: 'DESC',
    limit: 100
  });

  if (!paymentsResult.ok) {
    return json({ ok: false, error: 'square_payments_failed' }, { status: 502 });
  }

  const eligiblePayments: EligiblePayment[] = [];
  for (const payment of (paymentsResult.payload?.payments ?? []) as SquarePayment[]) {
    if (payment.status && payment.status !== 'COMPLETED') continue;
    const createdAt = payment.created_at;
    const last4 = payment.card_details?.card?.last_4;
    const fingerprint =
      payment.card_details?.card?.fingerprint ??
      payment.card_details?.card?.card_fingerprint ??
      null;
    const amountCents = payment.amount_money?.amount;
    if (!createdAt || !last4 || !fingerprint || amountCents == null) continue;
    if (allowedLocationIds.size > 0 && payment.location_id) {
      if (!allowedLocationIds.has(payment.location_id)) continue;
    }
    const paymentMs = new Date(createdAt).getTime();
    if (!Number.isFinite(paymentMs) || paymentMs < beginTime.getTime() || paymentMs > now.getTime()) continue;
    eligiblePayments.push({
      paymentId: payment.id,
      amount: amountCents / 100,
      last4,
      fingerprint,
      createdAt,
      locationId: payment.location_id ?? null
    });
  }

  if (eligiblePayments.length === 0) {
    return json({ ok: true, candidates: [] });
  }

  const paymentIds = eligiblePayments.map((payment) => payment.paymentId);
  const fingerprints = Array.from(new Set(eligiblePayments.map((payment) => payment.fingerprint)));

  const [{ data: existingClaims, error: claimsError }, { data: bindings, error: bindingsError }] =
    await Promise.all([
      supabaseAdmin
        .from('claims')
        .select('square_payment_id')
        .in('square_payment_id', paymentIds),
      supabaseAdmin
        .from('square_card_bindings')
        .select('card_fingerprint,user_id')
        .eq('venue_id', venueId)
        .in('card_fingerprint', fingerprints)
    ]);

  if (claimsError) {
    return json({ ok: false, error: claimsError.message }, { status: 500 });
  }
  if (bindingsError) {
    return json({ ok: false, error: bindingsError.message }, { status: 500 });
  }

  const existingPaymentIds = new Set(
    (existingClaims ?? []).map((row) => row.square_payment_id).filter(Boolean)
  );
  const bindingMap = new Map<string, string | null>();
  for (const binding of bindings ?? []) {
    if (!binding.card_fingerprint) continue;
    bindingMap.set(binding.card_fingerprint, binding.user_id ?? null);
  }

  const candidates: Array<{
    payment_id: string;
    amount: number;
    created_at: string;
    venue_id: string;
    venue_name: string;
  }> = [];

  for (const payment of eligiblePayments) {
    if (existingPaymentIds.has(payment.paymentId)) continue;
    const boundUserId = bindingMap.get(payment.fingerprint) ?? null;
    if (boundUserId && boundUserId !== userId) continue;
    if (venue?.new_customers_only) {
      try {
        const blocked = await isFingerprintBlocked({
          venueId,
          fingerprint: payment.fingerprint,
          now
        });
        if (blocked) continue;
      } catch (error: any) {
        return json(
          { ok: false, error: error?.message ?? 'fingerprint_check_failed' },
          { status: 500 }
        );
      }
    }
    candidates.push({
      payment_id: payment.paymentId,
      amount: payment.amount,
      created_at: payment.createdAt,
      venue_id: venueId,
      venue_name: venue?.name ?? ''
    });
  }

  return json({ ok: true, candidates });
}
