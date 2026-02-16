import { json, type RequestHandler } from '@sveltejs/kit';
import { supabaseAdmin } from '$lib/server/supabaseAdmin';

export const POST: RequestHandler = async ({ request }) => {
  const body = await request.json().catch(() => null);
  const emailRaw = body?.email;
  const email = typeof emailRaw === 'string' ? emailRaw.trim().toLowerCase() : '';

  if (!email) {
    return json({ ok: false, error: 'missing_email' }, { status: 400 });
  }

  const { data: profile, error } = await supabaseAdmin
    .from('profiles')
    .select('role')
    .ilike('email', email)
    .maybeSingle();

  if (error) {
    return json({ ok: false, error: error.message }, { status: 500 });
  }

  const role = profile?.role ?? 'member';
  const isOwner = role === 'owner' || role === 'admin';

  return json({
    ok: true,
    is_owner: isOwner,
    requires_code: !isOwner
  });
};
