import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';

export async function GET() {
  const publicKey = env.PRIVATE_VAPID_PUBLIC_KEY || '';
  return json({ publicKey });
}
