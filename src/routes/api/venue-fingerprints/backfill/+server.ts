import { json, type RequestHandler } from '@sveltejs/kit';
import { supabaseAdmin } from '$lib/server/supabaseAdmin';
import { listSquarePayments, type SquarePayment } from '$lib/server/square/payments';
import { cleanupOldFingerprints, getFingerprintCutoffs, upsertVenueFingerprints } from '$lib/server/square/fingerprints';

const pageLimit = 200;
const maxPagesPerBatch = 50;
const maxBatches = 5;

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

  const body = await request.json().catch(() => null);
  const venueId = typeof body?.venue_id === 'string' ? body.venue_id : '';
  if (!venueId) {
    return json({ ok: false, error: 'missing_venue_id' }, { status: 400 });
  }

  const { data: requesterProfile, error: profileError } = await supabaseAdmin
    .from('profiles')
    .select('role')
    .eq('id', requesterData.user.id)
    .maybeSingle();
  if (profileError) {
    return json({ ok: false, error: profileError.message }, { status: 500 });
  }

  let canAccess = requesterProfile?.role === 'admin';
  if (!canAccess) {
    const { data: directVenue, error: directError } = await supabaseAdmin
      .from('venues')
      .select('id')
      .eq('id', venueId)
      .eq('created_by', requesterData.user.id)
      .maybeSingle();
    if (directError) {
      return json({ ok: false, error: directError.message }, { status: 500 });
    }
    canAccess = Boolean(directVenue?.id);
  }

  if (!canAccess) {
    const { data: ownerLink, error: ownerError } = await supabaseAdmin
      .from('venue_owners')
      .select('venue_id')
      .eq('venue_id', venueId)
      .eq('owner_id', requesterData.user.id)
      .maybeSingle();
    if (ownerError) {
      return json({ ok: false, error: ownerError.message }, { status: 500 });
    }
    canAccess = Boolean(ownerLink?.venue_id);
  }

  if (!canAccess) {
    return json({ ok: false, error: 'forbidden' }, { status: 403 });
  }

  const [{ data: connection, error: connectionError }, { data: locationLinks, error: locationError }] =
    await Promise.all([
      supabaseAdmin
        .from('square_connections')
        .select('access_token')
        .eq('venue_id', venueId)
        .maybeSingle(),
      supabaseAdmin
        .from('square_location_links')
        .select('location_id')
        .eq('venue_id', venueId)
    ]);

  if (connectionError) {
    return json({ ok: false, error: connectionError.message }, { status: 500 });
  }
  if (!connection?.access_token) {
    return json({ ok: false, error: 'square_not_connected' }, { status: 404 });
  }
  if (locationError) {
    return json({ ok: false, error: locationError.message }, { status: 500 });
  }

  const allowedLocationIds = new Set(
    (locationLinks ?? []).map((row) => row.location_id).filter(Boolean)
  );

  const now = new Date();
  const { minAgeCutoff, sixMonthsAgo } = getFingerprintCutoffs(now);
  if (minAgeCutoff.getTime() <= sixMonthsAgo.getTime()) {
    return json({ ok: true, upserted: 0 });
  }

  const payments: SquarePayment[] = [];
  let cursor: string | null = null;
  let pages = 0;
  let batches = 0;

  do {
    const response = await listSquarePayments(connection.access_token, {
      begin_time: sixMonthsAgo.toISOString(),
      end_time: minAgeCutoff.toISOString(),
      sort_order: 'ASC',
      limit: pageLimit,
      cursor
    });
    if (!response.ok) {
      return json({ ok: false, error: 'square_payments_failed' }, { status: 502 });
    }
    payments.push(...((response.payload?.payments ?? []) as SquarePayment[]));
    cursor = response.payload?.cursor ?? null;
    pages += 1;
    if (pages >= maxPagesPerBatch && cursor) {
      batches += 1;
      pages = 0;
    }
  } while (cursor && batches < maxBatches);

  const { upserted } = await upsertVenueFingerprints({
    venueId,
    payments,
    allowedLocationIds,
    now
  });

  await cleanupOldFingerprints(venueId, sixMonthsAgo);

  return json({
    ok: true,
    upserted,
    truncated: Boolean(cursor)
  });
};
