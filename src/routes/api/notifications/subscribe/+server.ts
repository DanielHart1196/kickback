import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';

export async function POST({ request }: RequestEvent) {
  void request;
  return json({ ok: false, error: 'browser_push_disabled' }, { status: 410 });
}


