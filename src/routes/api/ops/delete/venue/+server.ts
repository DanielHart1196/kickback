import { json } from '@sveltejs/kit';
import { supabaseAdmin } from '$lib/server/supabaseAdmin';

export async function POST({ request }) {
  const authHeader = request.headers.get('authorization') ?? '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';

  if (!token) {
    return json({ ok: false, error: 'missing_token' }, { status: 401 });
  }

  const { data: requesterData, error: requesterError } = await supabaseAdmin.auth.getUser(token);
  if (requesterError || !requesterData?.user) {
    return json({ ok: false, error: 'invalid_token' }, { status: 401 });
  }

  const requesterId = requesterData.user.id;
  const { data: requesterProfile, error: profileError } = await supabaseAdmin
    .from('profiles')
    .select('role')
    .eq('id', requesterId)
    .maybeSingle();
  if (profileError) {
    return json({ ok: false, error: profileError.message }, { status: 500 });
  }
  if (requesterProfile?.role !== 'admin') {
    return json({ ok: false, error: 'forbidden' }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const venueId = body?.venue_id;
  if (!venueId || typeof venueId !== 'string') {
    return json({ ok: false, error: 'missing_venue_id' }, { status: 400 });
  }

  const { error: claimNullError } = await supabaseAdmin
    .from('claims')
    .update({ venue_id: null })
    .eq('venue_id', venueId);
  if (claimNullError) {
    return json({ ok: false, error: claimNullError.message }, { status: 500 });
  }

  const { error: ownersDeleteError } = await supabaseAdmin
    .from('venue_owners')
    .delete()
    .eq('venue_id', venueId);
  if (ownersDeleteError) {
    return json({ ok: false, error: ownersDeleteError.message }, { status: 500 });
  }

  const tablesToClean = [
    'square_connections',
    'square_location_links',
    'zepto_connections',
    'zepto_payto_agreements',
    'venue_payment_agreements'
  ];

  for (const table of tablesToClean) {
    const { error } = await supabaseAdmin.from(table).delete().eq('venue_id', venueId);
    if (error) {
      return json({ ok: false, error: error.message, table }, { status: 500 });
    }
  }

  const { error: venueDeleteError } = await supabaseAdmin.from('venues').delete().eq('id', venueId);
  if (venueDeleteError) {
    return json({ ok: false, error: venueDeleteError.message }, { status: 500 });
  }

  return json({ ok: true });
}
