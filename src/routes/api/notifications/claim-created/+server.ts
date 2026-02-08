import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { supabaseAdmin } from '$lib/server/supabaseAdmin';
import webpush from 'web-push';

function initWebPush() {
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
    const ok = initWebPush();
    if (!ok) {
      return json({ ok: false, error: 'missing_vapid_keys' }, { status: 500 });
    }
    const body = await request.json().catch(() => null);
    const claimId = body?.claim_id as string | undefined;
    if (!claimId) {
      return json({ ok: false, error: 'missing_claim_id' }, { status: 400 });
    }
    const { data: claim, error: claimError } = await supabaseAdmin
      .from('claims')
      .select('*')
      .eq('id', claimId)
      .maybeSingle();
    if (claimError || !claim) {
      return json({ ok: false, error: claimError?.message ?? 'claim_not_found' }, { status: 404 });
    }
    const amount = Number(claim.amount || 0);
    const venueName = String(claim.venue || '');
    const guestRate = Number(claim.kickback_guest_rate || 0) / 100;
    const refRate = Number(claim.kickback_referrer_rate || 0) / 100;
    const submitterId = String(claim.submitter_id || '');
    const referrerId = String(claim.referrer_id || '');
    const codeUsed = String(claim.submitter_referral_code || 'member');

    const targets: { userId: string; title: string; body: string }[] = [];
    if (submitterId) {
      const earned = Math.max(0, Number((amount * guestRate).toFixed(2)));
      targets.push({
        userId: submitterId,
        title: `+${earned.toFixed(2)} earned`,
        body: `from ${venueName}`
      });
    }
    if (referrerId) {
      const earned = Math.max(0, Number((amount * refRate).toFixed(2)));
      targets.push({
        userId: referrerId,
        title: `+${earned.toFixed(2)} ${codeUsed} used your code`,
        body: `at ${venueName}`
      });
    }

    const sent: string[] = [];
    for (const t of targets) {
      const { data: sub, error: subError } = await supabaseAdmin
        .from('push_subscriptions')
        .select('endpoint,p256dh,auth')
        .eq('user_id', t.userId)
        .maybeSingle();
      if (subError || !sub?.endpoint) continue;
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth }
          } as any,
          JSON.stringify({
            title: t.title,
            body: t.body,
            icon: '/favicon.png',
            badge: '/favicon.png'
          })
        );
        sent.push(t.userId);
      } catch (error) {
        // ignore individual push failures
      }
    }

    return json({ ok: true, sent });
  } catch (error) {
    return json({ ok: false, error: 'failed_to_send' }, { status: 500 });
  }
}
