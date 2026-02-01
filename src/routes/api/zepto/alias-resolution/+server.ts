import { json } from '@sveltejs/kit';
import { getZeptoAccessToken, zeptoBaseUrl } from '$lib/server/zepto';

function getClientIp(headers: Headers, fallback: string | undefined): string | null {
  const forwarded = headers.get('x-forwarded-for') ?? '';
  if (forwarded) {
    return forwarded.split(',')[0]?.trim() ?? null;
  }
  const realIp = headers.get('x-real-ip') ?? '';
  if (realIp) return realIp.trim();
  return fallback ?? null;
}

export async function POST({ request, getClientAddress }) {
  const body = await request.json().catch(() => null);
  const venueId = body?.venue_id ?? null;
  const token = await getZeptoAccessToken(venueId);
  if (!token) {
    return json({ ok: false, error: 'missing_access_token' }, { status: 500 });
  }

  const type = body?.type;
  const value = body?.value;
  const requesterId = body?.requester?.id;
  const requesterIp =
    body?.requester?.remote_ip ?? getClientIp(request.headers, getClientAddress?.());

  const missing = [];
  if (!type) missing.push('type');
  if (!value) missing.push('value');
  if (!requesterId) missing.push('requester.id');
  if (!requesterIp) missing.push('requester.remote_ip');
  if (missing.length > 0) {
    return json({ ok: false, error: 'missing_params', missing }, { status: 400 });
  }

  const payload = {
    type,
    value,
    requester: {
      id: requesterId,
      remote_ip: requesterIp
    }
  };

  const response = await fetch(`${zeptoBaseUrl}/payto/alias_resolution`, {
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
    return json({ ok: false, error: result ?? 'alias_resolution_failed' }, { status: response.status });
  }

  return json({ ok: true });
}
