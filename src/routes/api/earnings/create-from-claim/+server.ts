import { json, type RequestHandler } from '@sveltejs/kit';
import { supabaseAdmin } from '$lib/server/supabaseAdmin';
import { createEarningsForClaimId } from '$lib/server/earnings';

export const POST: RequestHandler = async ({ request }) => {
  const authHeader = request.headers.get('authorization') ?? '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!token) {
    return json({ ok: false, error: 'missing_token' }, { status: 401 });
  }

  const { data: requesterData, error: requesterError } = await supabaseAdmin.auth.getUser(token);
  if (requesterError || !requesterData?.user) {
    return json({ ok: false, error: 'invalid_token' }, { status: 401 });
  }

  const { claim_id: claimId } = await request.json().catch(() => ({ claim_id: '' }));
  if (!claimId) {
    return json({ ok: false, error: 'missing_claim_id' }, { status: 400 });
  }
  const result = await createEarningsForClaimId(claimId, {
    requesterId: requesterData.user.id,
    requireOwner: true
  });

  if (!result.ok) {
    const status = result.error === 'not_claim_owner' ? 403 : result.error === 'claim_not_found' ? 404 : 500;
    return json({ ok: false, error: result.error ?? 'failed_to_create' }, { status });
  }

  return json({ ok: true, already_exists: Boolean(result.already_exists) });
};
