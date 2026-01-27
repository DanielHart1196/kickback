import { json } from '@sveltejs/kit';
import { supabaseAdmin } from '$lib/server/supabaseAdmin';

export async function GET({ url }) {
  const venueId = url.searchParams.get('venue_id');
  if (!venueId) {
    return json({ location_ids: [], error: 'missing_venue_id' }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from('square_location_links')
    .select('location_id')
    .eq('venue_id', venueId);

  if (error) {
    return json({ location_ids: [], error: error.message }, { status: 500 });
  }

  return json({ location_ids: (data ?? []).map((row) => row.location_id) });
}

export async function POST({ request }) {
  const body = await request.json().catch(() => null);
  const venueId = body?.venue_id;
  const locationIds = Array.isArray(body?.location_ids) ? body.location_ids : null;

  if (!venueId || !locationIds) {
    return json({ ok: false, error: 'missing_params' }, { status: 400 });
  }

  const { error: deleteError } = await supabaseAdmin
    .from('square_location_links')
    .delete()
    .eq('venue_id', venueId);

  if (deleteError) {
    return json({ ok: false, error: deleteError.message }, { status: 500 });
  }

  if (locationIds.length > 0) {
    const rows = locationIds.map((locationId: string) => ({
      venue_id: venueId,
      location_id: locationId
    }));
    const { error: insertError } = await supabaseAdmin
      .from('square_location_links')
      .insert(rows);
    if (insertError) {
      return json({ ok: false, error: insertError.message }, { status: 500 });
    }
  }

  return json({ ok: true });
}
