import { json } from '@sveltejs/kit';
import { supabaseAdmin } from '$lib/server/supabaseAdmin';

type PromoteAction = 'pending_to_approved' | 'approved_to_available' | 'all';

export async function POST({ request }) {
  try {
    const body = await request.json().catch(() => null);
    const action: PromoteAction =
      (['pending_to_approved', 'approved_to_available', 'all'].includes(body?.action)
        ? body?.action
        : 'all') as PromoteAction;

    let pendingToApproved = 0;
    let approvedToAvailable = 0;

    if (action === 'pending_to_approved' || action === 'all') {
      const { error: upErr, data } = await supabaseAdmin
        .from('user_balances')
        .update({ status: 'approved', created_at: new Date().toISOString() })
        .eq('status', 'pending')
        .select('id');
      if (upErr) {
        return json({ ok: false, error: upErr.message }, { status: 500 });
      }
      pendingToApproved = data?.length ?? 0;
    }

    if (action === 'approved_to_available' || action === 'all') {
      const { error: upErr, data } = await supabaseAdmin
        .from('user_balances')
        .update({ status: 'available', created_at: new Date().toISOString() })
        .eq('status', 'approved')
        .select('id');
      if (upErr) {
        return json({ ok: false, error: upErr.message }, { status: 500 });
      }
      approvedToAvailable = data?.length ?? 0;
    }

    return json({ ok: true, pending_to_approved: pendingToApproved, approved_to_available: approvedToAvailable });
  } catch (error) {
    const message = error instanceof Error ? error.message || 'promote_failed' : 'promote_failed';
    return json({ ok: false, error: message }, { status: 500 });
  }
}
