import { json, type RequestHandler } from '@sveltejs/kit';
import { supabaseAdmin } from '$lib/server/supabaseAdmin';
import { backfillVenueFingerprintsForVenue } from '$lib/server/square/backfillVenueFingerprints';

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

  try {
    const result = await backfillVenueFingerprintsForVenue(venueId);
    return json({
      ok: true,
      upserted: result.upserted,
      truncated: result.truncated
    });
  } catch (error: any) {
    const message = error?.message ?? 'fingerprint_backfill_failed';
    const status = message === 'square_not_connected' ? 404 : message === 'square_payments_failed' ? 502 : 500;
    return json({ ok: false, error: message }, { status });
  }
};
