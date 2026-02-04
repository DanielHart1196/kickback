import { json } from '@sveltejs/kit';
import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';

function getStripeKey(): string | null {
  if (dev) return env.PRIVATE_STRIPE_SECRET_KEY_SANDBOX ?? null;
  return env.PRIVATE_STRIPE_SECRET_KEY_PROD ?? null;
}

async function stripePost(path: string) {
  const key = getStripeKey();
  if (!key) throw new Error('missing_stripe_key');
  const response = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    }
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const message = data?.error?.message ?? `stripe_${response.status}`;
    throw new Error(message);
  }
  return data;
}

export async function POST({ request }) {
  try {
    const body = await request.json().catch(() => null);
    const invoiceId = body?.invoice_id as string | undefined;
    if (!invoiceId) {
      return json({ ok: false, error: 'missing_invoice_id' }, { status: 400 });
    }
    await stripePost(`invoices/${invoiceId}/send`);
    return json({ ok: true });
  } catch (error) {
    return json(
      { ok: false, error: error instanceof Error ? error.message : 'stripe_send_failed' },
      { status: 500 }
    );
  }
}
