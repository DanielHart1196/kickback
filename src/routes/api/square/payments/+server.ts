import { json } from '@sveltejs/kit';
import { dev } from '$app/environment';
import { supabaseAdmin } from '$lib/server/supabaseAdmin';

const squareApiBase = dev ? 'https://connect.squareupsandbox.com' : 'https://connect.squareup.com';
const squareVersion = '2025-01-23';

export async function GET({ url }) {
  const venueId = url.searchParams.get('venue_id');
  const beginTime = url.searchParams.get('begin_time');
  const endTime = url.searchParams.get('end_time');

  if (!venueId || !beginTime || !endTime) {
    return json({ payments: [], error: 'missing_params' }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from('square_connections')
    .select('access_token')
    .eq('venue_id', venueId)
    .maybeSingle();

  if (error) {
    return json({ payments: [], error: error.message }, { status: 500 });
  }

  if (!data?.access_token) {
    return json({ payments: [], error: 'square_not_connected' }, { status: 404 });
  }

  const paymentsUrl = new URL(`${squareApiBase}/v2/payments`);
  paymentsUrl.searchParams.set('begin_time', beginTime);
  paymentsUrl.searchParams.set('end_time', endTime);
  paymentsUrl.searchParams.set('sort_order', 'ASC');
  paymentsUrl.searchParams.set('limit', '200');

  const response = await fetch(paymentsUrl.toString(), {
    headers: {
      Authorization: `Bearer ${data.access_token}`,
      'Square-Version': squareVersion,
      Accept: 'application/json'
    }
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    return json({ payments: [], error: payload?.message ?? 'square_payments_failed' }, { status: 502 });
  }

  return json({ payments: payload?.payments ?? [] });
}
