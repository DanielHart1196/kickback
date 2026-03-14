import { json, redirect, type RequestEvent } from '@sveltejs/kit';
import { dev } from '$app/environment';
import {
  PRIVATE_SQUARE_APP_SECRET_PROD,
  PRIVATE_SQUARE_APP_SECRET_SANDBOX
} from '$env/static/private';
import {
  PUBLIC_SQUARE_APP_ID_PROD,
  PUBLIC_SQUARE_APP_ID_SANDBOX
} from '$env/static/public';
import { supabaseAdmin } from '$lib/server/supabaseAdmin';
import { backfillVenueFingerprintsForVenue } from '$lib/server/square/backfillVenueFingerprints';

const squareAppId = dev ? PUBLIC_SQUARE_APP_ID_SANDBOX : PUBLIC_SQUARE_APP_ID_PROD;
const squareAppSecret = dev ? PRIVATE_SQUARE_APP_SECRET_SANDBOX : PRIVATE_SQUARE_APP_SECRET_PROD;
const squareTokenUrl = dev
  ? 'https://connect.squareupsandbox.com/oauth2/token'
  : 'https://connect.squareup.com/oauth2/token';
const squareApiBase = dev ? 'https://connect.squareupsandbox.com' : 'https://connect.squareup.com';
const squareVersion = '2025-01-23';

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return 'Unexpected error';
}

export async function GET({ url, cookies }: RequestEvent) {
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const oauthError = url.searchParams.get('error');
  const storedState = cookies.get('square_oauth_state');
  const venueId = cookies.get('square_oauth_venue');

  if (oauthError) {
    throw redirect(302, `/admin?square=error&reason=${encodeURIComponent(oauthError)}`);
  }

  if (!code) {
    throw redirect(302, '/admin?square=error&reason=missing_code');
  }

  const isLocalhost =
    url.origin.startsWith('http://localhost') || url.origin.startsWith('http://127.0.0.1');
  if (!state) {
    throw redirect(302, '/admin?square=error&reason=missing_state');
  }
  if (!storedState) {
    if (!isLocalhost) {
      throw redirect(302, '/admin?square=error&reason=missing_state_cookie');
    }
  } else if (state !== storedState) {
    throw redirect(302, '/admin?square=error&reason=invalid_state');
  }

  cookies.delete('square_oauth_state', { path: '/' });
  cookies.delete('square_oauth_venue', { path: '/' });

  if (!venueId) {
    throw redirect(302, '/admin?square=error&reason=missing_venue');
  }

  if (!squareAppId || !squareAppSecret) {
    throw redirect(302, '/admin?square=error&reason=missing_square_credentials');
  }

  try {
    const redirectUri = `${url.origin}/api/square/callback`;
    const response = await fetch(squareTokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      body: JSON.stringify({
        client_id: squareAppId,
        client_secret: squareAppSecret,
        code,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri
      })
    });

    const payload = await response.json();
    if (!response.ok) {
      const reason = encodeURIComponent(payload?.message ?? 'token_exchange_failed');
      throw redirect(302, `/admin?square=error&reason=${reason}`);
    }

    const expiresAt = payload.expires_at ? new Date(payload.expires_at).toISOString() : null;
    let merchantName: string | null = null;
    if (payload.access_token) {
      try {
        const merchantResponse = await fetch(`${squareApiBase}/v2/merchants`, {
          headers: {
            Authorization: `Bearer ${payload.access_token}`,
            Accept: 'application/json',
            'Square-Version': squareVersion
          }
        });
        const merchantPayload = await merchantResponse.json().catch(() => null);
        if (merchantResponse.ok && Array.isArray(merchantPayload?.merchant)) {
          const merchantMatch = merchantPayload.merchant.find(
            (m: { id?: string }) => m?.id && m.id === payload.merchant_id
          );
          const merchantRecord = merchantMatch ?? merchantPayload.merchant[0];
          merchantName = merchantRecord?.business_name ?? merchantRecord?.name ?? null;
        }
      } catch {
        merchantName = null;
      }
    }
    const { error: upsertError } = await supabaseAdmin
      .from('square_connections')
      .upsert(
        {
          venue_id: venueId,
          merchant_id: payload.merchant_id ?? null,
          merchant_name: merchantName,
          access_token: payload.access_token ?? null,
          refresh_token: payload.refresh_token ?? null,
          expires_at: expiresAt,
          scope: payload.scope ?? null,
          token_type: payload.token_type ?? null,
          updated_at: new Date().toISOString()
        },
        { onConflict: 'venue_id' }
      );

    if (upsertError) {
      const reason = encodeURIComponent(upsertError.message || 'token_save_failed');
      throw redirect(302, `/admin?square=error&reason=${reason}`);
    }

    const { error: venueFlagError } = await supabaseAdmin
      .from('venues')
      .update({ square_public: true })
      .eq('id', venueId);
    if (venueFlagError) {
      const reason = encodeURIComponent(venueFlagError.message || 'venue_flag_update_failed');
      throw redirect(302, `/admin?square=error&reason=${reason}`);
    }

    let backfillStatus = 'failed';
    try {
      await backfillVenueFingerprintsForVenue(venueId);
      backfillStatus = 'done';
    } catch (error) {
      console.error('[square callback] fingerprint backfill failed', {
        venueId,
        error: getErrorMessage(error)
      });
    }

    const merchantNameParam = merchantName ? `&merchant_name=${encodeURIComponent(merchantName)}` : '';
    const backfillStatusParam = `&fingerprint_backfill=${encodeURIComponent(backfillStatus)}`;
    throw redirect(
      302,
      `/admin?square=connected${merchantNameParam}&merchant=${encodeURIComponent(payload.merchant_id ?? '')}${backfillStatusParam}`
    );
  } catch (error) {
    if (
      error &&
      typeof error === 'object' &&
      'status' in error &&
      'location' in error
    ) {
      throw error;
    }
    const reason = encodeURIComponent(getErrorMessage(error));
    throw redirect(302, `/admin?square=error&reason=${reason}`);
  }
}
