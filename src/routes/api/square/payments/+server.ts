import { json } from '@sveltejs/kit';
import { supabaseAdmin } from '$lib/server/supabaseAdmin';
import { listSquarePayments } from '$lib/server/square/payments';

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

  const paymentsResult = await listSquarePayments(data.access_token, {
    begin_time: beginTime,
    end_time: endTime,
    sort_order: 'ASC',
    limit: 200
  });

  if (!paymentsResult.ok) {
    return json(
      { payments: [], error: paymentsResult.payload?.message ?? 'square_payments_failed' },
      { status: 502 }
    );
  }

  return json({ payments: paymentsResult.payload?.payments ?? [] });
}
