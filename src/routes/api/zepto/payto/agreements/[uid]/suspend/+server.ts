import { json } from '@sveltejs/kit';
import { getZeptoAccessToken, zeptoBaseUrl } from '$lib/server/zepto';

export async function POST({ params, request }) {
  const agreementUid = params.uid;
  if (!agreementUid) {
    return json({ ok: false, error: 'missing_agreement_uid' }, { status: 400 });
  }

  const body = await request.json().catch(() => null);
  const venueId = body?.venue_id ?? null;
  const reason = body?.reason ?? 'initiating_party_requested';
  const narrative = body?.narrative ?? null;
  const token = await getZeptoAccessToken(venueId);
  if (!token) {
    return json({ ok: false, error: 'missing_access_token' }, { status: 500 });
  }

  const payload: Record<string, unknown> = { reason };
  if (narrative) payload.narrative = narrative;

  const response = await fetch(`${zeptoBaseUrl}/payto/agreements/${agreementUid}/suspension`, {
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
    return json({ ok: false, error: result ?? 'suspend_failed' }, { status: response.status });
  }

  return json({ ok: true, result });
}
