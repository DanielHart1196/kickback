import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { createHash } from 'crypto';
import { supabaseAdmin } from '$lib/server/supabaseAdmin';
import { createEarningsForClaimId } from '$lib/server/earnings';

export async function POST({ request }: RequestEvent) {
  const authHeader = request.headers.get('authorization') ?? '';
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!bearer) {
    return json({ ok: false, error: 'missing_token' }, { status: 401 });
  }

  const { data: requesterData, error: requesterError } = await supabaseAdmin.auth.getUser(bearer);
  if (requesterError || !requesterData?.user) {
    return json({ ok: false, error: 'invalid_token' }, { status: 401 });
  }
  const userId = requesterData.user.id;

  const body = await request.json().catch(() => null);
  const token = typeof body?.token === 'string' ? body.token.trim() : '';
  if (!token) {
    return json({ ok: false, error: 'missing_activation_token' }, { status: 400 });
  }

  const tokenHash = createHash('sha256').update(token).digest('hex');

  const { data: tokenRow, error: tokenError } = await supabaseAdmin
    .from('activation_claim_tokens')
    .select('id, claim_id, expires_at, claimed_at, claimed_by')
    .eq('token_hash', tokenHash)
    .maybeSingle();

  if (tokenError) {
    return json({ ok: false, error: tokenError.message }, { status: 500 });
  }
  if (!tokenRow) {
    return json({ ok: false, error: 'activation_token_not_found' }, { status: 404 });
  }
  if (tokenRow.claimed_at) {
    return json({ ok: true, already_claimed: true, claim_id: tokenRow.claim_id });
  }
  if (new Date(tokenRow.expires_at).getTime() < Date.now()) {
    return json({ ok: false, error: 'activation_token_expired' }, { status: 410 });
  }

  const { data: claim, error: claimReadError } = await supabaseAdmin
    .from('claims')
    .select('id, submitter_id, venue_id, square_card_fingerprint, purchased_at')
    .eq('id', tokenRow.claim_id)
    .maybeSingle();

  if (claimReadError) {
    return json({ ok: false, error: claimReadError.message }, { status: 500 });
  }
  if (!claim?.id) {
    return json({ ok: false, error: 'claim_not_found' }, { status: 404 });
  }

  if (claim.submitter_id && claim.submitter_id !== userId) {
    return json({ ok: false, error: 'claim_already_attached' }, { status: 409 });
  }

  if (claim.venue_id && claim.square_card_fingerprint) {
    const { data: existingBinding, error: bindingReadError } = await supabaseAdmin
      .from('square_card_bindings')
      .select('user_id')
      .eq('venue_id', claim.venue_id)
      .eq('card_fingerprint', claim.square_card_fingerprint)
      .maybeSingle();

    if (bindingReadError) {
      return json({ ok: false, error: bindingReadError.message }, { status: 500 });
    }

    if (existingBinding?.user_id && existingBinding.user_id !== userId) {
      return json({ ok: false, error: 'card_bound_to_other_user' }, { status: 409 });
    }

    if (!existingBinding?.user_id) {
      const { error: seedBindingError } = await supabaseAdmin
        .from('square_card_bindings')
        .upsert(
          {
            venue_id: claim.venue_id,
            card_fingerprint: claim.square_card_fingerprint,
            user_id: userId,
            first_claim_id: String(claim.id),
            first_purchased_at: claim.purchased_at ?? null,
            updated_at: new Date().toISOString()
          },
          { onConflict: 'venue_id,card_fingerprint', ignoreDuplicates: true }
        );
      if (seedBindingError) {
        return json({ ok: false, error: seedBindingError.message }, { status: 500 });
      }

      const { data: bindingAfterSeed, error: bindingAfterSeedError } = await supabaseAdmin
        .from('square_card_bindings')
        .select('user_id')
        .eq('venue_id', claim.venue_id)
        .eq('card_fingerprint', claim.square_card_fingerprint)
        .maybeSingle();
      if (bindingAfterSeedError) {
        return json({ ok: false, error: bindingAfterSeedError.message }, { status: 500 });
      }
      if (bindingAfterSeed?.user_id && bindingAfterSeed.user_id !== userId) {
        return json({ ok: false, error: 'card_bound_to_other_user' }, { status: 409 });
      }
    }
  }

  if (!claim.submitter_id) {
    const { error: attachError } = await supabaseAdmin
      .from('claims')
      .update({ submitter_id: userId })
      .eq('id', claim.id)
      .is('submitter_id', null);
    if (attachError) {
      return json({ ok: false, error: attachError.message }, { status: 500 });
    }
  }

  const { error: markError } = await supabaseAdmin
    .from('activation_claim_tokens')
    .update({
      claimed_by: userId,
      claimed_at: new Date().toISOString()
    })
    .eq('id', tokenRow.id);

  if (markError) {
    return json({ ok: false, error: markError.message }, { status: 500 });
  }

  const earningsResult = await createEarningsForClaimId(String(claim.id), {
    requesterId: userId,
    requireOwner: true
  });
  if (!earningsResult.ok) {
    return json({ ok: false, error: earningsResult.error ?? 'failed_to_create_earnings' }, { status: 500 });
  }

  return json({ ok: true, claim_id: claim.id });
}
