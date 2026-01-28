import { json } from '@sveltejs/kit';
import { supabaseAdmin } from '$lib/server/supabaseAdmin';
import {
  PRIVATE_HELLOCLEVER_WEBHOOK_SECRET_PROD,
  PRIVATE_HELLOCLEVER_WEBHOOK_SECRET_SANDBOX
} from '$env/static/private';
import { dev } from '$app/environment';

export async function POST({ request }) {
  const secret = dev ? PRIVATE_HELLOCLEVER_WEBHOOK_SECRET_SANDBOX : PRIVATE_HELLOCLEVER_WEBHOOK_SECRET_PROD;
  const authHeader = request.headers.get('authorization') ?? '';
  const expected = `Bearer ${secret}`;
  if (!secret || authHeader !== expected) {
    return json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  const payload = await request.json().catch(() => null);
  const paymentAgreementId = payload?.payment_agreement_id ?? null;
  const clientTransactionId = payload?.client_transaction_id ?? null;
  const status = payload?.status ?? null;

  if (!paymentAgreementId && !clientTransactionId) {
    return json({ ok: false, error: 'missing_identifier' }, { status: 400 });
  }

  const updates = {
    status,
    last_status_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  let updated = null;
  if (paymentAgreementId) {
    const { data, error } = await supabaseAdmin
      .from('venue_payment_agreements')
      .update(updates)
      .eq('payment_agreement_id', paymentAgreementId)
      .select()
      .maybeSingle();
    if (error) {
      return json({ ok: false, error: error.message }, { status: 500 });
    }
    updated = data;
  }

  if (!updated && clientTransactionId) {
    const { data, error } = await supabaseAdmin
      .from('venue_payment_agreements')
      .update(updates)
      .eq('client_transaction_id', clientTransactionId)
      .select()
      .maybeSingle();
    if (error) {
      return json({ ok: false, error: error.message }, { status: 500 });
    }
    updated = data;
  }

  return json({ ok: true });
}
