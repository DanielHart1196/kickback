import { json } from '@sveltejs/kit';
import { supabaseAdmin } from '$lib/server/supabaseAdmin';

export async function POST({ request }) {
  try {
    const body = await request.json().catch(() => null);
    const subscription = body?.subscription ?? null;
    if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
      return json({ ok: false, error: 'invalid_subscription' }, { status: 400 });
    }
    const endpoint: string = subscription.endpoint;
    const p256dh: string = subscription.keys.p256dh;
    const auth: string = subscription.keys.auth;

    const { data: sessionData, error: sessionError } = await supabaseAdmin.auth.getUser(
      request.headers.get('authorization')?.replace(/^Bearer\s+/, '') ?? ''
    );
    const userId = sessionData?.user?.id ?? null;
    if (sessionError || !userId) {
      return json({ ok: false, error: 'unauthorized' }, { status: 401 });
    }

    const { error } = await supabaseAdmin
      .from('push_subscriptions')
      .upsert(
        {
          user_id: userId,
          endpoint,
          p256dh,
          auth,
          updated_at: new Date().toISOString()
        },
        { onConflict: 'user_id' }
      );
    if (error) {
      return json({ ok: false, error: error.message }, { status: 500 });
    }
    return json({ ok: true });
  } catch (error) {
    return json({ ok: false, error: 'invalid_request' }, { status: 400 });
  }
}
