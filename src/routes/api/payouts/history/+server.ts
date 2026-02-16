import { json, type RequestHandler } from '@sveltejs/kit';
import { supabaseAdmin } from '$lib/server/supabaseAdmin';

type HistoryRow = {
  id: string;
  claim_ids: string[] | null;
  amount: number | null;
  currency: string | null;
  pay_id: string | null;
  paid_at: string | null;
  claim_count: number | null;
  created_at: string | null;
};

type ClaimRow = {
  id: string;
  venue: string | null;
  amount: number | null;
  submitter_id: string | null;
  referrer_id: string | null;
  kickback_guest_rate: number | null;
  kickback_referrer_rate: number | null;
};

export const GET: RequestHandler = async ({ request }) => {
  const authHeader = request.headers.get('authorization') ?? '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!token) {
    return json({ ok: false, error: 'missing_token' }, { status: 401 });
  }

  const { data: requesterData, error: requesterError } = await supabaseAdmin.auth.getUser(token);
  if (requesterError || !requesterData?.user) {
    return json({ ok: false, error: 'invalid_token' }, { status: 401 });
  }

  const userId = requesterData.user.id;
  const { data: rows, error } = await supabaseAdmin
    .from('payouts')
    .select('id, claim_ids, amount, currency, pay_id, paid_at, claim_count, created_at')
    .eq('user_id', userId)
    .eq('status', 'paid')
    .order('paid_at', { ascending: false })
    .limit(1000);

  if (error) {
    return json({ ok: false, error: error.message }, { status: 500 });
  }
  const payoutRows = (rows ?? []) as HistoryRow[];
  const allClaimIds = Array.from(
    new Set(
      payoutRows.flatMap((row) => (Array.isArray(row.claim_ids) ? row.claim_ids : [])).map((id) => String(id))
    )
  );
  const claimById = new Map<string, ClaimRow>();

  if (allClaimIds.length > 0) {
    const { data: claims, error: claimsError } = await supabaseAdmin
      .from('claims')
      .select('id, venue, amount, submitter_id, referrer_id, kickback_guest_rate, kickback_referrer_rate')
      .in('id', allClaimIds);
    if (claimsError) {
      return json({ ok: false, error: claimsError.message }, { status: 500 });
    }
    for (const claim of (claims ?? []) as ClaimRow[]) {
      claimById.set(String(claim.id), claim);
    }
  }

  const payouts = payoutRows
    .map((row) => {
      const claimIds = (Array.isArray(row.claim_ids) ? row.claim_ids : []).map((id) => String(id));
      const venueTotals = new Map<string, number>();
      for (const claimId of claimIds) {
        const claim = claimById.get(claimId);
        if (!claim) continue;
        const venueName = String(claim.venue ?? 'Unknown venue').trim() || 'Unknown venue';
        const amount = Number(claim.amount ?? 0);
        if (!Number.isFinite(amount) || amount <= 0) continue;
        let payoutAmount = 0;
        if (String(claim.submitter_id ?? '') === userId) {
          const rate = Number(claim.kickback_guest_rate ?? 5) / 100;
          payoutAmount += amount * rate;
        }
        if (String(claim.referrer_id ?? '') === userId) {
          const rate = Number(claim.kickback_referrer_rate ?? 5) / 100;
          payoutAmount += amount * rate;
        }
        if (payoutAmount <= 0) continue;
        venueTotals.set(venueName, (venueTotals.get(venueName) ?? 0) + payoutAmount);
      }

      return {
        id: String(row.id),
        amount: Number(Number(row.amount ?? 0).toFixed(2)),
        currency: String(row.currency ?? 'aud').toLowerCase(),
        paid_at: row.paid_at ?? row.created_at ?? new Date().toISOString(),
        pay_id: String(row.pay_id ?? ''),
        claim_count: Number(row.claim_count ?? claimIds.length),
        venue_totals: Array.from(venueTotals.entries())
          .map(([venue, total_amount]) => ({ venue, total_amount: Number(total_amount.toFixed(2)) }))
          .sort((a, b) => b.total_amount - a.total_amount)
      };
    })
    .sort((a, b) => new Date(b.paid_at).getTime() - new Date(a.paid_at).getTime());

  return json({ ok: true, payouts });
};
