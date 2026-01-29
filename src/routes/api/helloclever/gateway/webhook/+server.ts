import { json } from '@sveltejs/kit';
import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';
import { supabaseAdmin } from '$lib/server/supabaseAdmin';

function isPaidStatus(status: string | null): boolean {
  if (!status) return false;
  return /paid|success|completed/i.test(status);
}

export async function POST({ request }) {
  const webhookSecret = dev
    ? env.PRIVATE_HELLOCLEVER_WEBHOOK_SECRET_SANDBOX
    : env.PRIVATE_HELLOCLEVER_WEBHOOK_SECRET_PROD;
  const authHeader = request.headers.get('authorization') ?? '';
  const expected = `Bearer ${webhookSecret}`;
  if (!webhookSecret || authHeader !== expected) {
    return json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  const payload = await request.json().catch(() => null);
  const paymentId = payload?.payment_id ?? null;
  const orderId = payload?.order_id ?? null;
  const status = payload?.status ?? null;

  if (!paymentId && !orderId) {
    return json({ ok: false, error: 'missing_identifier' }, { status: 400 });
  }

  const updates: Record<string, string | null> = {
    status,
    updated_at: new Date().toISOString()
  };

  if (isPaidStatus(status)) {
    updates.paid_at = new Date().toISOString();
  }

  let updated = null;
  if (paymentId) {
    const { data, error } = await supabaseAdmin
      .from('venue_payment_requests')
      .update(updates)
      .eq('payment_id', paymentId)
      .select()
      .maybeSingle();
    if (error) {
      return json({ ok: false, error: error.message }, { status: 500 });
    }
    updated = data;
  }

  if (!updated && orderId) {
    const { data, error } = await supabaseAdmin
      .from('venue_payment_requests')
      .update(updates)
      .eq('order_id', orderId)
      .select()
      .maybeSingle();
    if (error) {
      return json({ ok: false, error: error.message }, { status: 500 });
    }
    updated = data;
  }

  return json({ ok: true });
}
