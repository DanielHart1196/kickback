import { json } from '@sveltejs/kit';
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

const squareAppId = dev ? PUBLIC_SQUARE_APP_ID_SANDBOX : PUBLIC_SQUARE_APP_ID_PROD;
const squareAppSecret = dev ? PRIVATE_SQUARE_APP_SECRET_SANDBOX : PRIVATE_SQUARE_APP_SECRET_PROD;
const squareRevokeUrl = dev
  ? 'https://connect.squareupsandbox.com/oauth2/revoke'
  : 'https://connect.squareup.com/oauth2/revoke';

export async function POST({ request }) {
  const body = await request.json().catch(() => null);
  const venueId = body?.venue_id;

  if (!venueId) {
    return json({ ok: false, error: 'missing_venue_id' }, { status: 400 });
  }

  const { data, error: fetchError } = await supabaseAdmin
    .from('square_connections')
    .select('access_token')
    .eq('venue_id', venueId)
    .maybeSingle();
  if (fetchError) {
    return json({ ok: false, error: fetchError.message }, { status: 500 });
  }

  if (data?.access_token) {
    if (!squareAppId || !squareAppSecret) {
      return json({ ok: false, error: 'missing_square_credentials' }, { status: 500 });
    }

    const revokeResponse = await fetch(squareRevokeUrl, {
      method: 'POST',
      headers: {
        Authorization: `Client ${squareAppSecret}`,
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      body: JSON.stringify({
        client_id: squareAppId,
        access_token: data.access_token
      })
    });

    if (!revokeResponse.ok) {
      const payload = await revokeResponse.json().catch(() => null);
      return json(
        {
          ok: false,
          error: payload?.message ?? 'revoke_failed',
          status: revokeResponse.status
        },
        { status: 502 }
      );
    }
  }

  const { error } = await supabaseAdmin.from('square_connections').delete().eq('venue_id', venueId);
  if (error) {
    return json({ ok: false, error: error.message }, { status: 500 });
  }

  return json({ ok: true });
}
