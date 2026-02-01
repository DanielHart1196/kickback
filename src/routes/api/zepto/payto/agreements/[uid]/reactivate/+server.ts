import { json } from '@sveltejs/kit';
import { getZeptoAccessToken, zeptoBaseUrl } from '$lib/server/zepto';

export async function POST({ params, request }) {
  const agreementUid = params.uid;
  if (!agreementUid) {
    return json({ ok: false, error: 'missing_agreement_uid' }, { status: 400 });
  }

  const body = await request.json().catch(() => null);
  const venueId = body?.venue_id ?? null;
  const token = await getZeptoAccessToken(venueId);
  if (!token) {
    return json({ ok: false, error: 'missing_access_token' }, { status: 500 });
  }

  const response = await fetch(`${zeptoBaseUrl}/payto/agreements/${agreementUid}/reactivation`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json'
    }
  });

  const result = await response.json().catch(() => null);
  if (!response.ok) {
    return json({ ok: false, error: result ?? 'reactivate_failed' }, { status: response.status });
  }

  return json({ ok: true, result });
}
