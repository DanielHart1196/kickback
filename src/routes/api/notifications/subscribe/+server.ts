import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { supabaseAdmin } from '$lib/server/supabaseAdmin';

type SubscriptionPayload = {
  endpoint: string;
  keys: { p256dh: string; auth: string };
};

export async function POST({ request }: RequestEvent) {
  const authHeader = request.headers.get('authorization') ?? '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!token) {
    return json({ ok: false, error: 'missing_token' }, { status: 401 });
  }
  const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(token);
  if (userError || !userData?.user) {
    return json({ ok: false, error: 'invalid_token' }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const action = typeof body?.action === 'string' ? body.action : 'subscribe';
  const subscription = body?.subscription as SubscriptionPayload | null;
  if (!subscription?.endpoint) {
    return json({ ok: false, error: 'missing_subscription' }, { status: 400 });
  }

  if (action === 'unsubscribe') {
    const { error } = await supabaseAdmin
      .from('push_subscriptions')
      .delete()
      .eq('user_id', userData.user.id)
      .eq('endpoint', subscription.endpoint);
    if (error) {
      return json({ ok: false, error: error.message }, { status: 500 });
    }
    return json({ ok: true });
  }

  const payload = {
    user_id: userData.user.id,
    endpoint: subscription.endpoint,
    p256dh: subscription.keys?.p256dh ?? null,
    auth: subscription.keys?.auth ?? null,
    updated_at: new Date().toISOString()
  };
  const { error } = await supabaseAdmin
    .from('push_subscriptions')
    .upsert(payload, { onConflict: 'user_id,endpoint' });
  if (error) {
    return json({ ok: false, error: error.message }, { status: 500 });
  }

  return json({ ok: true });
}
