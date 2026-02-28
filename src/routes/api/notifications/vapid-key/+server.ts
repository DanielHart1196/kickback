import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';

export async function GET() {
  const publicKey = env.PRIVATE_VAPID_PUBLIC_KEY || '';
  if (!publicKey) {
    return json({ ok: false, error: 'missing_vapid_key' }, { status: 500 });
  }
  return json({ ok: true, publicKey });
}
