import { json, type RequestHandler } from '@sveltejs/kit';
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
  if (!pass) return null;
  return { host, port, user, pass, from, secure };
}

async function sendEmailNotification(to: string, subject: string, text: string, html?: string) {
  const smtp = getSmtpConfig();
  if (!smtp) return false;
  try {
    const transporter = nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.secure,
      auth: { user: smtp.user, pass: smtp.pass }
    });
    await transporter.sendMail({
      from: smtp.from,
      to,
      subject,
      text,
      html
    });
    return true;
  } catch {
    return false;
  }
}

export const POST: RequestHandler = async ({ request }) => {
  try {
    const body = await request.json().catch(() => null);
    const userId = typeof body?.user_id === 'string' ? body.user_id : null;
    const amount = Number(body?.amount ?? 0);
    const payId = typeof body?.pay_id === 'string' ? body.pay_id : '';
    const paidAtRaw = typeof body?.paid_at === 'string' ? body.paid_at : new Date().toISOString();
    if (!userId || !(amount > 0)) {
      return json({ ok: false, error: 'missing_params' }, { status: 400 });
    }

    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('email, notify_payout_confirmation')
      .eq('id', userId)
      .maybeSingle();
    if (!profile?.email || !profile?.notify_payout_confirmation) {
      return json({ ok: true, skipped: 'notifications_disabled_or_missing_email' });
    }

    const paidAt = new Date(paidAtRaw);
    const paidLabel = Number.isNaN(paidAt.getTime())
      ? paidAtRaw
      : paidAt.toLocaleString('en-AU', { hour12: false });
    const amountLabel = `$${amount.toFixed(2)}`;
    const subject = `Payout sent ${amountLabel}`;
    const textLines = [
      `Payout sent: ${amountLabel}`,
      `PayID: ${payId || 'Not set'}`,
      `Time: ${paidLabel}`,
      '',
      'View your dashboard at https://kkbk.app/'
    ];
    const html = `Payout sent: ${amountLabel}<br>PayID: ${payId || 'Not set'}<br>Time: ${paidLabel}<br><br>View your dashboard at https://kkbk.app/`;
    const sent = await sendEmailNotification(profile.email, subject, textLines.join('\n'), html);
    return json({ ok: true, sent });
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : 'failed_to_send' }, { status: 500 });
  }
};
