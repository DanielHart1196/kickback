import { json } from '@sveltejs/kit';
import { getZeptoAccessToken, zeptoBaseUrl } from '$lib/server/zepto';

export async function GET({ params, url }) {
  const agreementUid = params.uid;
  if (!agreementUid) {
    return json({ ok: false, error: 'missing_agreement_uid' }, { status: 400 });
  }

  const venueId = url.searchParams.get('venue_id');
  if (!venueId) {
    return json({ ok: false, error: 'missing_params', missing: ['venue_id'] }, { status: 400 });
  }

  const token = await getZeptoAccessToken(venueId);
  if (!token) {
    return json({ ok: false, error: 'missing_access_token' }, { status: 500 });
  }

  const response = await fetch(`${zeptoBaseUrl}/payto/agreements/${agreementUid}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json'
    }
  });

  const result = await response.json().catch(() => null);
  if (!response.ok) {
    return json({ ok: false, error: result ?? 'agreement_fetch_failed' }, { status: response.status });
  }

  return json({ ok: true, agreement: result?.data ?? result });
}
