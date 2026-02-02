import { json } from '@sveltejs/kit';
import { supabaseAdmin } from '$lib/server/supabaseAdmin';

export async function POST({ request }) {
  const authHeader = request.headers.get('authorization') ?? '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';

  if (!token) {
    return json({ ok: false, error: 'missing_token' }, { status: 401 });
  }

  const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(token);
  if (userError || !userData?.user) {
    return json({ ok: false, error: 'invalid_token' }, { status: 401 });
  }

  const userId = userData.user.id;

  const { error: claimsError } = await supabaseAdmin
    .from('claims')
    .delete()
    .eq('submitter_id', userId)
    .in('status', ['pending', 'approved', 'denied']);
  if (claimsError) {
    return json({ ok: false, error: claimsError.message }, { status: 500 });
  }

  const { error: ownersError } = await supabaseAdmin
    .from('venue_owners')
    .delete()
    .eq('owner_id', userId);
  if (ownersError) {
    return json({ ok: false, error: ownersError.message }, { status: 500 });
  }

  const { error: profileError } = await supabaseAdmin
    .from('profiles')
    .delete()
    .eq('id', userId);
  if (profileError) {
    return json({ ok: false, error: profileError.message }, { status: 500 });
  }

  const { error: deleteError } = await supabaseAdmin.auth.admin.deleteUser(userId);
  if (deleteError) {
    return json({ ok: false, error: deleteError.message }, { status: 500 });
  }

  return json({ ok: true });
}
