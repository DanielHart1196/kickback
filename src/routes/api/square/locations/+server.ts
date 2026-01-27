import { json } from '@sveltejs/kit';
import { dev } from '$app/environment';
import { supabaseAdmin } from '$lib/server/supabaseAdmin';

const squareApiBase = dev ? 'https://connect.squareupsandbox.com' : 'https://connect.squareup.com';
const squareVersion = '2025-01-23';

export async function GET({ url }) {
  const venueId = url.searchParams.get('venue_id');
  if (!venueId) {
    return json({ locations: [], error: 'missing_venue_id' }, { status: 400 });
  }

  const { data: connection, error: connectionError } = await supabaseAdmin
    .from('square_connections')
    .select('access_token')
    .eq('venue_id', venueId)
    .maybeSingle();

  if (connectionError) {
    return json({ locations: [], error: connectionError.message }, { status: 500 });
  }

  if (!connection?.access_token) {
    return json({ locations: [], error: 'square_not_connected' }, { status: 404 });
  }

  const response = await fetch(`${squareApiBase}/v2/locations`, {
    headers: {
      Authorization: `Bearer ${connection.access_token}`,
      'Square-Version': squareVersion,
      Accept: 'application/json'
    }
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    return json({ locations: [], error: payload?.message ?? 'square_locations_failed' }, { status: 502 });
  }

  const locations = (payload?.locations ?? []).map((location: { id: string; name: string; status?: string }) => ({
    id: location.id,
    name: location.name,
    status: location.status
  }));

  return json({ locations });
}
