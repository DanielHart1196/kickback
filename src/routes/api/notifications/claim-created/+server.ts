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

async function sendEmailNotification(to: string, subject: string, text: string, html?: string) {
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
      text,
      html
    });
    console.log(`Email sent successfully to ${to}`);
    return true;
  } catch (error) {
    console.error(`Email notification failed for ${to}:`, error);
    return false;
  }
}

export async function POST({ request }) {
  try {
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
    const claimStatus = String(claim.status ?? '').toLowerCase();
    if (claimStatus !== 'approved' && claimStatus !== 'paid') {
      return json({ ok: true, skipped: 'claim_not_approved' });
    }
    const amount = Number(claim.amount || 0);
    const venueName = String(claim.venue || '');
    const guestRate = Number(claim.kickback_guest_rate || 0) / 100;
    const refRate = Number(claim.kickback_referrer_rate || 0) / 100;
    const submitterId = String(claim.submitter_id || '');
    const referrerId = String(claim.referrer_id || '');
    const codeUsed = String(claim.submitter_referral_code || 'member');

    const targets: {
      userId: string;
      emailSubject: string;
      emailText: string;
      emailHtml?: string;
    }[] = [];
    if (submitterId) {
      const earned = Math.max(0, Number((amount * guestRate).toFixed(2)));
      const earnedText = `+$${earned.toFixed(2)} earned`;
      const detailText = `from ${venueName}`;
      targets.push({
        userId: submitterId,
        emailSubject: earnedText,
        emailText: `${earnedText}\n${detailText}\n\nView your dashboard at https://kkbk.app/`,
        emailHtml: `${earnedText}<br>${detailText}<br><br>View your dashboard at https://kkbk.app/`
      });
    }
    if (referrerId) {
      const earned = Math.max(0, Number((amount * refRate).toFixed(2)));
      const earnedText = `+$${earned.toFixed(2)} earned`;
      const detailText = `${codeUsed} used your code at ${venueName}`;
      targets.push({
        userId: referrerId,
        emailSubject: earnedText,
        emailText: `${earnedText}\n${detailText}\n\nView your dashboard at https://kkbk.app/`,
        emailHtml: `${earnedText}<br>${detailText}<br><br>View your dashboard at https://kkbk.app/`
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
          t.emailSubject,
          t.emailText,
          t.emailHtml
        );
        if (ok) sentEmail.push(t.userId);
      } else {
        console.log(`Email skipped for ${t.userId}:`, {
          hasEmail: !!profile?.email,
          notifyApproved: !!profile?.notify_approved_claims
        });
      }

      // Browser push notifications are disabled.
    }

    return json({ ok: true, sentPush, sentEmail });
  } catch (error) {
    return json({ ok: false, error: 'failed_to_send' }, { status: 500 });
  }
}
