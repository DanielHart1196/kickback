import { json } from '@sveltejs/kit';
import { supabaseAdmin } from '$lib/server/supabaseAdmin';

export async function GET({ url }) {
  const venueId = url.searchParams.get('venue_id');
  if (!venueId) {
    return json({ connected: false, error: 'missing_venue_id' }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from('square_connections')
    .select('merchant_id')
    .eq('venue_id', venueId)
    .maybeSingle();

  if (error) {
    return json({ connected: false, error: error.message }, { status: 500 });
  }

  return json({ connected: Boolean(data), merchant_id: data?.merchant_id ?? null });
}
