import { json } from '@sveltejs/kit';

export async function GET() {
  return json({ ok: false, error: 'browser_push_disabled' }, { status: 410 });
}
