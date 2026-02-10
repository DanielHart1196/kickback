import { json } from '@sveltejs/kit';
import { supabaseAdmin } from '$lib/server/supabaseAdmin';
import { env } from '$env/dynamic/private';

async function getWebPush() {
  try {
    const mod = await import('web-push');
    return (mod as any)?.default ?? mod;
  } catch {
    return null;
  }
}

function initWebPush(webpush: any) {
  const publicKey = env.PRIVATE_VAPID_PUBLIC_KEY || '';
  const privateKey = env.PRIVATE_VAPID_PRIVATE_KEY || '';
  const subject = env.PRIVATE_VAPID_SUBJECT || 'mailto:support@kkbk.app';
  if (!publicKey || !privateKey) {
    return false;
  }
  webpush.setVapidDetails(subject, publicKey, privateKey);
  return true;
}

export async function POST({ request }) {
  try {
    const webpush = await getWebPush();
    if (!webpush) {
      return json({ ok: false, error: 'web_push_unavailable' }, { status: 500 });
    }
    const ok = initWebPush(webpush);
    if (!ok) {
      return json({ ok: false, error: 'missing_vapid_keys' }, { status: 500 });
    }
    const token = request.headers.get('authorization')?.replace(/^Bearer\s+/, '') ?? '';
    const { data: sessionData, error: sessionError } = await supabaseAdmin.auth.getUser(token);
    const userId = sessionData?.user?.id ?? null;
    if (sessionError || !userId) {
      return json({ ok: false, error: 'unauthorized' }, { status: 401 });
    }
    const { data: sub, error: subError } = await supabaseAdmin
      .from('push_subscriptions')
      .select('endpoint,p256dh,auth')
      .eq('user_id', userId)
      .maybeSingle();
    if (subError || !sub?.endpoint) {
      return json({ ok: false, error: 'no_subscription' }, { status: 404 });
    }
    await webpush.sendNotification(
      {
        endpoint: sub.endpoint,
        keys: { p256dh: sub.p256dh, auth: sub.auth }
      } as any,
      JSON.stringify({
        title: 'Kickback test',
        body: 'This is a test notification',
        icon: '/favicon.png',
        badge: '/favicon.png'
      })
    );
    return json({ ok: true });
  } catch (error) {
    return json({ ok: false, error: 'failed_to_send' }, { status: 500 });
  }
}
