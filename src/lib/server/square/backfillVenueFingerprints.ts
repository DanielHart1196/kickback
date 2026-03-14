import { supabaseAdmin } from '$lib/server/supabaseAdmin';
import { listSquarePayments, type SquarePayment } from '$lib/server/square/payments';
import { cleanupOldFingerprints, getFingerprintCutoffs, upsertVenueFingerprints } from '$lib/server/square/fingerprints';

const pageLimit = 200;
const maxPagesPerBatch = 50;
const maxBatches = 5;

export async function backfillVenueFingerprintsForVenue(venueId: string) {
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
    throw connectionError;
  }
  if (!connection?.access_token) {
    throw new Error('square_not_connected');
  }
  if (locationError) {
    throw locationError;
  }

  const allowedLocationIds = new Set(
    (locationLinks ?? []).map((row) => row.location_id).filter(Boolean)
  );

  const now = new Date();
  const { minAgeCutoff, sixMonthsAgo } = getFingerprintCutoffs(now);
  if (minAgeCutoff.getTime() <= sixMonthsAgo.getTime()) {
    return { upserted: 0, truncated: false };
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
      throw new Error('square_payments_failed');
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

  return {
    upserted,
    truncated: Boolean(cursor)
  };
}
