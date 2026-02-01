import { json } from '@sveltejs/kit';
import { supabaseAdmin } from '$lib/server/supabaseAdmin';
import { getZeptoAccessToken, zeptoBaseUrl } from '$lib/server/zepto';

export async function POST({ params, request }) {
  const agreementUid = params.uid;
  if (!agreementUid) {
    return json({ ok: false, error: 'missing_agreement_uid' }, { status: 400 });
  }

  const body = await request.json().catch(() => null);
  const venueId = body?.venue_id ?? null;
  const changes = body?.changes ?? null;
  if (!changes || typeof changes !== 'object') {
    return json({ ok: false, error: 'missing_changes' }, { status: 400 });
  }

  const token = await getZeptoAccessToken(venueId);
  if (!token) {
    return json({ ok: false, error: 'missing_access_token' }, { status: 500 });
  }

  const payload = { changes };
  const response = await fetch(`${zeptoBaseUrl}/payto/agreements/${agreementUid}/amendment`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json'
    },
    body: JSON.stringify(payload)
  });

  const result = await response.json().catch(() => null);
  if (!response.ok) {
    return json({ ok: false, error: result ?? 'amend_failed' }, { status: response.status });
  }

  const existing = await supabaseAdmin
    .from('zepto_payto_agreements')
    .select('request_payload')
    .eq('uid', agreementUid)
    .maybeSingle();

  if (!existing.error && existing.data?.request_payload) {
    const updatedPayload = { ...(existing.data.request_payload as Record<string, unknown>) };
    const paymentTerms = updatedPayload.payment_terms as Record<string, unknown> | undefined;
    const changeTerms = (changes as Record<string, unknown>).payment_terms as Record<string, unknown> | undefined;
    if (changeTerms?.max_amount != null) {
      updatedPayload.payment_terms = {
        ...(paymentTerms ?? {}),
        max_amount: changeTerms.max_amount
      };
      await supabaseAdmin
        .from('zepto_payto_agreements')
        .update({ request_payload: updatedPayload, updated_at: new Date().toISOString() })
        .eq('uid', agreementUid);
    }
  }

  return json({ ok: true, result });
}
