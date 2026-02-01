import { json } from '@sveltejs/kit';
import { supabaseAdmin } from '$lib/server/supabaseAdmin';
import { getZeptoAccessToken, zeptoBaseUrl } from '$lib/server/zepto';

function getAgreementPayload(body: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!body) return null;
  if (body.agreement && typeof body.agreement === 'object') {
    return body.agreement as Record<string, unknown>;
  }
  const { venue_id: _venueId, ...rest } = body as Record<string, unknown>;
  return rest;
}

function validateAgreement(payload: Record<string, unknown>) {
  const missing: string[] = [];
  if (!payload.uid) missing.push('uid');
  if (!payload.purpose) missing.push('purpose');
  if (!payload.description) missing.push('description');
  const debtor = payload.debtor as Record<string, unknown> | undefined;
  const creditor = payload.creditor as Record<string, unknown> | undefined;
  const paymentTerms = payload.payment_terms as Record<string, unknown> | undefined;

  if (!debtor?.party_name) missing.push('debtor.party_name');
  if (!debtor?.account_identifier) missing.push('debtor.account_identifier');
  const debtorIdentifier = debtor?.account_identifier as Record<string, unknown> | undefined;
  if (!debtorIdentifier?.type) missing.push('debtor.account_identifier.type');
  if (!debtorIdentifier?.value) missing.push('debtor.account_identifier.value');

  if (!creditor?.party_name) missing.push('creditor.party_name');
  if (!creditor?.ultimate_party_name) missing.push('creditor.ultimate_party_name');
  if (!creditor?.account_identifier) missing.push('creditor.account_identifier');
  const creditorIdentifier = creditor?.account_identifier as Record<string, unknown> | undefined;
  if (!creditorIdentifier?.type) missing.push('creditor.account_identifier.type');
  if (!creditorIdentifier?.value) missing.push('creditor.account_identifier.value');

  if (!paymentTerms?.type) missing.push('payment_terms.type');
  if (!paymentTerms?.frequency) missing.push('payment_terms.frequency');

  return missing;
}

export async function POST({ request }) {
  const body = await request.json().catch(() => null);
  const venueId = body?.venue_id;
  if (!venueId) {
    return json({ ok: false, error: 'missing_params', missing: ['venue_id'] }, { status: 400 });
  }

  const { data: existingAgreement, error: existingError } = await supabaseAdmin
    .from('zepto_payto_agreements')
    .select('uid')
    .eq('venue_id', venueId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existingError) {
    return json({ ok: false, error: existingError.message }, { status: 500 });
  }
  if (existingAgreement?.uid) {
    return json({ ok: false, error: 'agreement_exists', uid: existingAgreement.uid }, { status: 409 });
  }

  const token = await getZeptoAccessToken(venueId);
  if (!token) {
    return json({ ok: false, error: 'missing_access_token' }, { status: 500 });
  }

  const payload = getAgreementPayload(body);
  if (!payload) {
    return json({ ok: false, error: 'invalid_payload' }, { status: 400 });
  }

  const missing = validateAgreement(payload);
  if (missing.length > 0) {
    return json({ ok: false, error: 'missing_params', missing }, { status: 400 });
  }

  const response = await fetch(`${zeptoBaseUrl}/payto/agreements`, {
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
    return json({ ok: false, error: result ?? 'agreement_create_failed' }, { status: response.status });
  }

  const now = new Date().toISOString();
  const agreementUid = (result?.uid as string | undefined) ?? (payload.uid as string);
  const insertPayload = {
    uid: agreementUid,
    venue_id: venueId,
    request_payload: payload,
    response_payload: result,
    updated_at: now
  };

  const { error: storeError } = await supabaseAdmin
    .from('zepto_payto_agreements')
    .upsert(insertPayload, { onConflict: 'uid' });
  if (storeError) {
    return json({ ok: false, error: storeError.message }, { status: 500 });
  }

  return json({ ok: true, agreement: result });
}

export async function GET({ url }) {
  const venueId = url.searchParams.get('venue_id');
  if (!venueId) {
    return json({ ok: false, error: 'missing_params', missing: ['venue_id'] }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from('zepto_payto_agreements')
    .select('uid,state,last_event_type,updated_at,created_at,request_payload')
    .eq('venue_id', venueId)
    .order('updated_at', { ascending: false })
    .limit(20);
  if (error) {
    return json({ ok: false, error: error.message }, { status: 500 });
  }

  return json({ ok: true, agreements: data ?? [] });
}
