import webpush from 'web-push';
import { env } from '$env/dynamic/private';
import { supabaseAdmin } from '$lib/server/supabaseAdmin';

type PushSubscriptionRow = {
  id: string;
  user_id: string | null;
  endpoint: string | null;
  p256dh: string | null;
  auth: string | null;
};

export type PushPayload = {
  title: string;
  body: string;
  url?: string;
  tag?: string;
};

const vapidPublicKey = env.PRIVATE_VAPID_PUBLIC_KEY || '';
const vapidPrivateKey = env.PRIVATE_VAPID_PRIVATE_KEY || '';
const vapidSubject = env.PRIVATE_VAPID_SUBJECT || 'mailto:support@kkbk.app';

let vapidConfigured = false;
if (vapidPublicKey && vapidPrivateKey) {
  try {
    webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
    vapidConfigured = true;
  } catch {
    vapidConfigured = false;
  }
}

export function isPushEnabled(): boolean {
  return vapidConfigured;
}

export async function sendPushToUser(
  userId: string,
  payload: PushPayload
): Promise<{ ok: boolean; sent: number; failed: number }> {
  if (!vapidConfigured) {
    return { ok: false, sent: 0, failed: 0 };
  }
  const { data: rows, error } = await supabaseAdmin
    .from('push_subscriptions')
    .select('id, user_id, endpoint, p256dh, auth')
    .eq('user_id', userId);
  if (error || !rows || rows.length === 0) {
    return { ok: false, sent: 0, failed: 0 };
  }
  let sent = 0;
  let failed = 0;
  for (const row of rows as PushSubscriptionRow[]) {
    if (!row.endpoint || !row.p256dh || !row.auth) continue;
    try {
      await webpush.sendNotification(
        {
          endpoint: row.endpoint,
          keys: { p256dh: row.p256dh, auth: row.auth }
        },
        JSON.stringify(payload)
      );
      sent += 1;
    } catch (err: any) {
      failed += 1;
      const statusCode = err?.statusCode;
      if (statusCode === 404 || statusCode === 410) {
        await supabaseAdmin
          .from('push_subscriptions')
          .delete()
          .eq('id', row.id);
      }
    }
  }
  return { ok: true, sent, failed };
}
