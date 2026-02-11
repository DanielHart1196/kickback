import { json } from '@sveltejs/kit';
import { supabaseAdmin } from '$lib/server/supabaseAdmin';

export async function POST() {
  try {
    const { data: claims, error: claimsError } = await supabaseAdmin
      .from('claims')
      .select('id, amount, kickback_guest_rate, kickback_referrer_rate, status, submitter_id, referrer_id');
    if (claimsError) {
      return json({ ok: false, error: claimsError.message }, { status: 500 });
    }

    const totals = new Map<string, number>();
    const keyFor = (userId: string, status: string) => `${userId}|${status}`;

    for (const claim of claims ?? []) {
      const amount = Number(claim.amount ?? 0);
      if (!(amount > 0)) continue;
      const guestRate = Number(claim.kickback_guest_rate ?? 5);
      const referrerRate = Number(claim.kickback_referrer_rate ?? 5);
      const guestAmt = Number(((amount * guestRate) / 100).toFixed(2));
      const refAmt = Number(((amount * referrerRate) / 100).toFixed(2));
      const rawStatus = (claim?.status ?? 'approved') as string;
      const ledgerStatus = rawStatus === 'paid' ? 'available' : rawStatus;

      if (claim.submitter_id && guestAmt > 0) {
        const k = keyFor(String(claim.submitter_id), ledgerStatus);
        totals.set(k, (totals.get(k) ?? 0) + guestAmt);
      }
      if (claim.referrer_id && refAmt > 0) {
        const k = keyFor(String(claim.referrer_id), ledgerStatus);
        totals.set(k, (totals.get(k) ?? 0) + refAmt);
      }
    }

    let written = 0;
    let updated = 0;
    let failed = 0;

    for (const [key, sum] of totals.entries()) {
      const [userId, status] = key.split('|');
      try {
        const { count } = await supabaseAdmin
          .from('user_balances')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', userId)
          .eq('type', 'summary')
          .eq('status', status)
          .is('claim_id', null);
        if ((count ?? 0) > 0) {
          const { error: upErr } = await supabaseAdmin
            .from('user_balances')
            .update({
              amount: sum,
              currency: 'aud',
              week_start: null,
              week_end: null,
              source_invoice_id: null,
              status,
              created_at: new Date().toISOString()
            })
            .eq('user_id', userId)
            .eq('type', 'summary')
            .eq('status', status)
            .is('claim_id', null);
          if (!upErr) updated += 1;
          else failed += 1;
        } else {
          const { error } = await supabaseAdmin.from('user_balances').insert({
            user_id: userId,
            type: 'summary',
            amount: sum,
            currency: 'aud',
            claim_id: null,
            venue_id: null,
            week_start: null,
            week_end: null,
            source_invoice_id: null,
            status,
            created_at: new Date().toISOString()
          });
          if (!error) written += 1;
          else failed += 1;
        }
      } catch {
        failed += 1;
      }
    }

    return json({ ok: true, written, updated, failed, keys: totals.size });
  } catch (error) {
    const message = error instanceof Error ? error.message || 'backfill_summary_failed' : 'backfill_summary_failed';
    return json({ ok: false, error: message }, { status: 500 });
  }
}
