import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { supabaseAdmin } from '$lib/server/supabaseAdmin';
import nodemailer from 'nodemailer';

function getSmtpConfig() {
  const host = env.PRIVATE_SMTP_HOST || 'smtp.resend.com';
  const port = Number(env.PRIVATE_SMTP_PORT || '465');
  const user = env.PRIVATE_SMTP_USER || 'resend';
  const pass = env.PRIVATE_SMTP_PASS ?? '';
  const from = env.PRIVATE_SMTP_FROM || 'Kickback <notifications@kkbk.app>';
  const secure = env.PRIVATE_SMTP_SECURE ? String(env.PRIVATE_SMTP_SECURE).toLowerCase() === 'true' : true;

  if (!pass) {
    console.warn('SMTP configuration: Missing PRIVATE_SMTP_PASS (API Key)');
    return null;
  }
  return { host, port, user, pass, from, secure };
}

async function sendEmailNotification(to: string, subject: string, text: string) {
  const smtp = getSmtpConfig();
  if (!smtp) {
    console.warn('Email skipped: SMTP not configured');
    return false;
  }

  try {
    const transporter = nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.secure,
      auth: { user: smtp.user, pass: smtp.pass }
    });

    console.log(`Attempting to send email to ${to} via ${smtp.host}`);
    await transporter.sendMail({
      from: smtp.from,
      to,
      subject,
      text
    });
    console.log(`Email sent successfully to ${to}`);
    return true;
  } catch (error) {
    console.error(`Email notification failed for ${to}:`, error);
    return false;
  }
}

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

    const targets: { userId: string; title: string; body: string; isSubmitter: boolean }[] = [];
    if (submitterId) {
      const earned = Math.max(0, Number((amount * guestRate).toFixed(2)));
      targets.push({
        userId: submitterId,
        title: `+${earned.toFixed(2)} earned`,
        body: `from ${venueName}`,
        isSubmitter: true
      });
    }
    if (referrerId) {
      const earned = Math.max(0, Number((amount * refRate).toFixed(2)));
      targets.push({
        userId: referrerId,
        title: `+${earned.toFixed(2)} ${codeUsed} used your code`,
        body: `at ${venueName}`,
        isSubmitter: false
      });
    }

    const sentPush: string[] = [];
    const sentEmail: string[] = [];
    for (const t of targets) {
      // 1. Fetch user profile for email and preferences
      const { data: profile } = await supabaseAdmin
        .from('profiles')
        .select('email, notify_approved_claims')
        .eq('id', t.userId)
        .maybeSingle();

      // 2. Try Email Notification
      if (profile?.email && profile?.notify_approved_claims) {
        const ok = await sendEmailNotification(
          profile.email,
          t.title,
          `${t.title}\n${t.body}\n\nView your dashboard at https://kkbk.app/`
        );
        if (ok) sentEmail.push(t.userId);
      } else {
        console.log(`Email skipped for ${t.userId}:`, {
          hasEmail: !!profile?.email,
          notifyApproved: !!profile?.notify_approved_claims
        });
      }

      // 3. Try Web Push Notification
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
        sentPush.push(t.userId);
      } catch (error) {
        // ignore individual push failures
      }
    }

    return json({ ok: true, sentPush, sentEmail });
  } catch (error) {
    return json({ ok: false, error: 'failed_to_send' }, { status: 500 });
  }
}
