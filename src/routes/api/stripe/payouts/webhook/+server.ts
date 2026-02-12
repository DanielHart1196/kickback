import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { supabaseAdmin } from '$lib/server/supabaseAdmin';
import crypto from 'node:crypto';

function getWebhookSecrets(): string[] {
  const secrets: string[] = [];
  const prod = env.PRIVATE_STRIPE_WEBHOOK_SECRET_PROD ?? null;
  const test = env.PRIVATE_STRIPE_WEBHOOK_SECRET_SANDBOX ?? null;
  if (prod) secrets.push(prod);
  if (test) secrets.push(test);
  return secrets;
}

function parseStripeSignature(header: string | null) {
  if (!header) return null;
  const parts = header.split(',').map((p) => p.trim());
  const t = parts.find((p) => p.startsWith('t='))?.slice(2) ?? null;
  const v1 = parts.find((p) => p.startsWith('v1='))?.slice(3) ?? null;
  if (!t || !v1) return null;
  return { t, v1 };
}

function verifySignature(secret: string, timestamp: string, rawBody: string, expectedV1: string): boolean {
  const signedPayload = `${timestamp}.${rawBody}`;
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(signedPayload, 'utf8');
  const computed = hmac.digest('hex');
  return crypto.timingSafeEqual(Buffer.from(computed, 'utf8'), Buffer.from(expectedV1, 'utf8'));
}

export async function POST({ request }) {
  try {
    const secrets = getWebhookSecrets();
    if (!secrets || secrets.length === 0) {
      return json({ ok: false, error: 'missing_webhook_secret' }, { status: 500 });
    }
    const raw = await request.text();
    const sigHeader = request.headers.get('stripe-signature');
    const parsed = parseStripeSignature(sigHeader);
    const valid = parsed ? secrets.some((s) => verifySignature(s, parsed.t, raw, parsed.v1)) : false;
    if (!parsed || !valid) {
      return json({ ok: false, error: 'invalid_signature' }, { status: 401 });
    }
    const event = JSON.parse(raw);
    const type: string = event?.type ?? '';
    const obj = event?.data?.object ?? null;
    const accountId: string | undefined = event?.account ?? undefined;
    if (type !== 'payout.paid' || !obj || !accountId) {
      return json({ ok: true });
    }
    const currency: string = String(obj?.currency ?? 'aud').toLowerCase();
    const amountCents: number = Number(obj?.amount ?? 0);

    const { data: profile } = await supabaseAdmin
      .from('payout_profiles')
      .select('user_id')
      .eq('stripe_account_id', accountId)
      .maybeSingle();
    const userId: string | undefined = profile?.user_id ? String(profile.user_id) : undefined;
    if (!userId) {
      return json({ ok: false, error: 'user_not_found_for_account' }, { status: 404 });
    }

    const { data: rows } = await supabaseAdmin
      .from('user_balances')
      .select('id, amount')
      .eq('user_id', userId)
      .eq('status', 'available')
      .eq('currency', currency)
      .order('created_at', { ascending: true })
      .limit(10000);

    const totalAvailable = Number((rows ?? []).reduce((sum, r) => sum + Number(r.amount ?? 0), 0));
    const payoutAmount = amountCents / 100;
    const markAll = payoutAmount >= totalAvailable - 0.0001;
    const idsToMark = markAll ? (rows ?? []).map((r) => r.id).filter(Boolean) : [];

    if (idsToMark.length > 0) {
      await supabaseAdmin
        .from('user_balances')
        .update({ status: 'paid', created_at: new Date().toISOString() })
        .in('id', idsToMark as string[]);
    }

    return json({ ok: true, marked_count: idsToMark.length });
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : 'payout_webhook_failed' }, { status: 500 });
  }
}
