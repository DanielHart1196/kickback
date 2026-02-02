import { json } from '@sveltejs/kit';
import nodemailer from 'nodemailer';
import { env } from '$env/dynamic/private';
import { supabaseAdmin } from '$lib/server/supabaseAdmin';

const SUPPORT_TO = 'support@kkbk.app';

function getSmtpConfig() {
  const host = env.PRIVATE_SMTP_HOST ?? '';
  const port = Number(env.PRIVATE_SMTP_PORT ?? '');
  const user = env.PRIVATE_SMTP_USER ?? '';
  const pass = env.PRIVATE_SMTP_PASS ?? '';
  const from = env.PRIVATE_SMTP_FROM ?? '';
  const secure = String(env.PRIVATE_SMTP_SECURE ?? '').toLowerCase() === 'true';

  if (!host || !port || !user || !pass || !from) return null;
  return { host, port, user, pass, from, secure };
}

export async function POST({ request }) {
  let body: { email?: string; venue?: string; message?: string };
  try {
    body = await request.json();
  } catch {
    return json({ message: 'Invalid JSON' }, { status: 400 });
  }

  const email = typeof body.email === 'string' ? body.email.trim() : '';
  const venue = typeof body.venue === 'string' ? body.venue.trim() : '';
  const message = typeof body.message === 'string' ? body.message.trim() : undefined;

  if (!email) {
    return json({ message: 'Email is required' }, { status: 400 });
  }
  if (!venue) {
    return json({ message: 'Venue name is required' }, { status: 400 });
  }

  const ua = request.headers.get('user-agent') ?? null;
  const forwardedFor = request.headers.get('x-forwarded-for') ?? null;
  const ip = forwardedFor?.split(',')?.[0]?.trim() || null;

  const { error: insertError } = await supabaseAdmin.from('contact_submissions').insert({
    email,
    venue_name: venue,
    message: message || null,
    user_agent: ua,
    ip
  });

  if (insertError) {
    return json({ message: insertError.message || 'Failed to save contact request' }, { status: 500 });
  }

  // Optional email delivery (leave configured for later)
  const smtp = getSmtpConfig();
  if (smtp) {
    const transporter = nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.secure,
      auth: { user: smtp.user, pass: smtp.pass }
    });

    const subject = `Kickback venue enquiry: ${venue}`;
    const text = [
      `Venue: ${venue}`,
      `Email: ${email}`,
      message ? `Message:\n${message}` : 'Message: (none)',
      '',
      `Submitted: ${new Date().toISOString()}`
    ].join('\n');

    // Fire-and-forget: do not fail the request if SMTP is down/misconfigured
    transporter
      .sendMail({
        from: smtp.from,
        to: SUPPORT_TO,
        replyTo: email,
        subject,
        text
      })
      .catch(() => {});
  }

  return json({ ok: true });
}
