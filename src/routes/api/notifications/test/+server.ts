import { json } from '@sveltejs/kit';

export async function POST({ request }) {
  void request;
  return json({ ok: false, error: 'browser_push_disabled' }, { status: 410 });
}
