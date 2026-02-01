import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';
import { supabaseAdmin } from '$lib/server/supabaseAdmin';

export const zeptoBaseUrl = dev
  ? 'https://api.sandbox.zeptopayments.com'
  : 'https://api.zeptopayments.com';

export async function getZeptoAccessToken(venueId?: string | null): Promise<string | null> {
  if (venueId) {
    const { data, error } = await supabaseAdmin
      .from('zepto_connections')
      .select('access_token')
      .eq('venue_id', venueId)
      .maybeSingle();
    if (!error && data?.access_token) return data.access_token;
  }

  const { data: connection, error: connectionError } = await supabaseAdmin
    .from('zepto_connections')
    .select('access_token')
    .eq('connection_id', 'sandbox')
    .maybeSingle();
  if (!connectionError && connection?.access_token) return connection.access_token;

  return dev ? env.PRIVATE_ZEPTO_ACCESS_TOKEN_SANDBOX ?? null : env.PRIVATE_ZEPTO_ACCESS_TOKEN_PROD ?? null;
}
