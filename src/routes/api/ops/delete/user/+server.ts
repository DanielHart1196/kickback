import { json, type RequestHandler } from '@sveltejs/kit';
import { supabaseAdmin } from '$lib/server/supabaseAdmin';

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
  const targetUserId = body?.user_id;
  if (!targetUserId || typeof targetUserId !== 'string') {
    return json({ ok: false, error: 'missing_user_id' }, { status: 400 });
  }

  const { error: claimsError } = await supabaseAdmin
    .from('claims')
    .delete()
    .eq('submitter_id', targetUserId)
    .in('status', ['pending', 'approved', 'denied']);
  if (claimsError) {
    return json({ ok: false, error: claimsError.message }, { status: 500 });
  }

  const { error: ownersError } = await supabaseAdmin
    .from('venue_owners')
    .delete()
    .eq('owner_id', targetUserId);
  if (ownersError) {
    return json({ ok: false, error: ownersError.message }, { status: 500 });
  }

  const { error: profileDeleteError } = await supabaseAdmin
    .from('profiles')
    .delete()
    .eq('id', targetUserId);
  if (profileDeleteError) {
    return json({ ok: false, error: profileDeleteError.message }, { status: 500 });
  }

  const { error: authDeleteError } = await supabaseAdmin.auth.admin.deleteUser(targetUserId);
  if (authDeleteError) {
    return json({ ok: false, error: authDeleteError.message }, { status: 500 });
  }

  return json({ ok: true });
}
