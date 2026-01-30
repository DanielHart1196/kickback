import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';
import { supabaseAdmin } from '$lib/server/supabaseAdmin';

export async function GET({ url, cookies }) {
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const error = url.searchParams.get('error');
  const errorDescription = url.searchParams.get('error_description');

  if (error) {
    const redirectUrl = new URL('/admin', url.origin);
    redirectUrl.searchParams.set('zepto', 'error');
    redirectUrl.searchParams.set('reason', errorDescription ?? error);
    return new Response(null, { status: 302, headers: { Location: redirectUrl.toString() } });
  }

  if (!code) {
    return new Response('Missing code', { status: 400 });
  }

  const clientId = dev ? env.PRIVATE_ZEPTO_OAUTH_CLIENT_ID_SANDBOX : env.PRIVATE_ZEPTO_OAUTH_CLIENT_ID_PROD;
  const clientSecret = dev
    ? env.PRIVATE_ZEPTO_OAUTH_CLIENT_SECRET_SANDBOX
    : env.PRIVATE_ZEPTO_OAUTH_CLIENT_SECRET_PROD;
  if (!clientId || !clientSecret) {
    return new Response('Missing Zepto OAuth credentials', { status: 500 });
  }

  const stateCookie = cookies.get('zepto_oauth_state');
  const venueIdCookie = cookies.get('zepto_oauth_venue');
  const venueId = url.searchParams.get('venue_id') ?? venueIdCookie;

  const isLocalhost =
    url.origin.startsWith('http://localhost') || url.origin.startsWith('http://127.0.0.1');
  if (!state) {
    return new Response('Missing state', { status: 400 });
  }
  if (!stateCookie) {
    if (!isLocalhost) {
      return new Response('Missing state cookie', { status: 400 });
    }
  } else if (state !== stateCookie) {
    return new Response('Invalid state', { status: 400 });
  }

  cookies.delete('zepto_oauth_state', { path: '/' });
  cookies.delete('zepto_oauth_venue', { path: '/' });

  if (!venueId) {
    return new Response('Missing venue', { status: 400 });
  }

  const tokenBase = dev ? 'https://go.sandbox.zeptopayments.com' : 'https://go.zeptopayments.com';
  const redirectUri = `${url.origin}/api/zepto/callback`;
  const payload = new URLSearchParams();
  payload.set('grant_type', 'authorization_code');
  payload.set('client_id', clientId);
  payload.set('client_secret', clientSecret);
  payload.set('code', code);
  payload.set('redirect_uri', redirectUri);

  const response = await fetch(`${tokenBase}/oauth/token`, {
    method: 'POST',
    headers: { Accept: 'application/json' },
    body: payload
  });
  const tokenPayload = await response.json().catch(() => null);
  if (!response.ok) {
    const redirectUrl = new URL('/admin', url.origin);
    redirectUrl.searchParams.set('zepto', 'error');
    redirectUrl.searchParams.set('reason', tokenPayload?.error ?? 'token_exchange_failed');
    return new Response(null, { status: 302, headers: { Location: redirectUrl.toString() } });
  }

  const expiresIn = Number(tokenPayload?.expires_in ?? 0);
  const expiresAt = Number.isFinite(expiresIn) && expiresIn > 0
    ? new Date(Date.now() + expiresIn * 1000).toISOString()
    : null;

  const insertPayload = {
    venue_id: venueId,
    access_token: tokenPayload?.access_token ?? null,
    refresh_token: tokenPayload?.refresh_token ?? null,
    token_type: tokenPayload?.token_type ?? null,
    scope: tokenPayload?.scope ?? null,
    expires_at: expiresAt,
    updated_at: new Date().toISOString()
  };

  const { error: storeError } = await supabaseAdmin
    .from('zepto_connections')
    .upsert(insertPayload, { onConflict: 'venue_id' });

  if (storeError) {
    return new Response(storeError.message, { status: 500 });
  }

  const redirectUrl = new URL('/admin', url.origin);
  redirectUrl.searchParams.set('zepto', 'connected');
  if (venueId) {
    redirectUrl.searchParams.set('venue_id', venueId);
  }
  return new Response(null, { status: 302, headers: { Location: redirectUrl.toString() } });
}
