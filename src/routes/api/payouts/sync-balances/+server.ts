import { json } from '@sveltejs/kit';
import { supabaseAdmin } from '$lib/server/supabaseAdmin';

export async function POST({ request }) {
  try {
    const body = await request.json().catch(() => null);
    const invoiceId = typeof body?.stripe_invoice_id === 'string' ? body.stripe_invoice_id : null;
    if (!invoiceId) {
      const { data: claims, error: claimsError } = await supabaseAdmin
        .from('claims')
        .select(
          'id, amount, kickback_guest_rate, kickback_referrer_rate, status, submitter_id, referrer_id, purchased_at, venue_id'
        );
      if (claimsError) {
        return json({ ok: false, error: claimsError.message }, { status: 500 });
      }
      let written = 0;
      let updated = 0;
      let failures = 0;
      let pendingTotal = 0;
      let approvedTotal = 0;
      let deniedTotal = 0;
      let availableTotal = 0;
      for (const claim of claims ?? []) {
        const amount = Number(claim.amount ?? 0);
        const guestRate = Number(claim.kickback_guest_rate ?? 5);
        const referrerRate = Number(claim.kickback_referrer_rate ?? 5);
        const guestCents = Math.round((amount * guestRate) / 100 * 100);
        const referrerCents = Math.round((amount * referrerRate) / 100 * 100);
        const transfers: { type: 'guest' | 'referrer'; userId: string; cents: number }[] = [];
        if (claim.submitter_id && guestCents > 0) {
          transfers.push({ type: 'guest', userId: claim.submitter_id as string, cents: guestCents });
        }
        if (claim.referrer_id && referrerCents > 0) {
          transfers.push({ type: 'referrer', userId: claim.referrer_id as string, cents: referrerCents });
        }
        for (const t of transfers) {
          try {
            const rawStatus = (claim?.status ?? 'approved') as string;
            const ledgerStatus = rawStatus === 'paid' ? 'venuepaid' : rawStatus;
            const ledgerAmount = t.cents / 100;
            if (ledgerStatus === 'pending') pendingTotal += ledgerAmount;
            else if (ledgerStatus === 'approved') approvedTotal += ledgerAmount;
            else if (ledgerStatus === 'denied') deniedTotal += ledgerAmount;
            else if (ledgerStatus === 'available') availableTotal += ledgerAmount;
            const { count: existCount, error: existErr } = await supabaseAdmin
              .from('user_balances')
              .select('id', { count: 'exact', head: true })
              .eq('user_id', t.userId)
              .eq('claim_id', claim.id ?? null)
              .eq('type', t.type);
            if (!existErr && (existCount ?? 0) > 0) {
              const { error: upErr } = await supabaseAdmin
                .from('user_balances')
                .update({
                  amount: ledgerAmount,
                  currency: 'aud',
                  venue_id: claim.venue_id ?? null,
                  week_start: null,
                  week_end: null,
                  source_invoice_id: null,
                  status: ledgerStatus,
                  created_at: new Date().toISOString()
                })
                .eq('user_id', t.userId)
                .eq('claim_id', claim.id ?? null)
                .eq('type', t.type);
              if (!upErr) updated += 1;
              else failures += 1;
            } else {
              const { error } = await supabaseAdmin.from('user_balances').insert({
                user_id: t.userId,
                type: t.type,
                amount: ledgerAmount,
                currency: 'aud',
                claim_id: claim.id ?? null,
                venue_id: claim.venue_id ?? null,
                week_start: null,
                week_end: null,
                source_invoice_id: null,
                status: ledgerStatus,
                created_at: new Date().toISOString()
              });
              if (!error) written += 1;
              else failures += 1;
            }
          } catch {
            failures += 1;
          }
        }
      }
      return json({
        ok: true,
        written,
        updated,
        failed: failures,
        claims_considered: (claims ?? []).length,
        totals: { pending: pendingTotal, approved: approvedTotal, denied: deniedTotal, available: availableTotal }
      });
    }
    const { data: vi, error: viError } = await supabaseAdmin
      .from('venue_invoices')
      .select('venue_id, week_start, week_end')
      .eq('stripe_invoice_id', invoiceId)
      .maybeSingle();
    if (viError || !vi) {
      return json({ ok: false, error: viError?.message ?? 'invoice_not_found' }, { status: 404 });
    }
    const venueId: string = String(vi.venue_id);
    const startIso: string = String(vi.week_start);
    const endIso: string = String(vi.week_end);
    const endNext = new Date(endIso);
    endNext.setDate(endNext.getDate() + 1);
    const endNextIso = endNext.toISOString();
    const { data: byRange, error: byRangeError } = await supabaseAdmin
      .from('claims')
      .select('id, amount, kickback_guest_rate, kickback_referrer_rate, status, submitter_id, referrer_id, purchased_at, venue_id, venue')
      .gte('purchased_at', startIso)
      .lt('purchased_at', endNextIso);
    if (byRangeError) {
      return json({ ok: false, error: byRangeError.message }, { status: 500 });
    }
    const { data: venue } = await supabaseAdmin.from('venues').select('name').eq('id', venueId).maybeSingle();
    const venueName = String(venue?.name ?? '').trim().toLowerCase();
    const items = (byRange ?? []).filter((c) => {
      const idMatch = String(c?.venue_id ?? '') === venueId;
      const nameMatch =
        venueName.length > 0 && String(c?.venue ?? '').trim().toLowerCase() === venueName;
      return idMatch || nameMatch;
    });
    let written = 0;
    let updated = 0;
    let pendingTotal = 0;
    let approvedTotal = 0;
    let deniedTotal = 0;
    let availableTotal = 0;
    for (const claim of items) {
      const amount = Number(claim.amount ?? 0);
      const guestRate = Number(claim.kickback_guest_rate ?? 5);
      const referrerRate = Number(claim.kickback_referrer_rate ?? 5);
      const guestCents = Math.round((amount * guestRate) / 100 * 100);
      const referrerCents = Math.round((amount * referrerRate) / 100 * 100);
      const transfers: { type: 'guest' | 'referrer'; userId: string; cents: number }[] = [];
      if (claim.submitter_id && guestCents > 0) {
        transfers.push({ type: 'guest', userId: claim.submitter_id as string, cents: guestCents });
      }
      if (claim.referrer_id && referrerCents > 0) {
        transfers.push({ type: 'referrer', userId: claim.referrer_id as string, cents: referrerCents });
      }
      for (const t of transfers) {
        const rawStatus = (claim?.status ?? 'approved') as string;
        const ledgerStatus = rawStatus === 'paid' ? 'available' : rawStatus;
        const ledgerAmount = t.cents / 100;
        if (ledgerStatus === 'pending') pendingTotal += ledgerAmount;
        else if (ledgerStatus === 'approved') approvedTotal += ledgerAmount;
        else if (ledgerStatus === 'denied') deniedTotal += ledgerAmount;
        else if (ledgerStatus === 'available') availableTotal += ledgerAmount;
        const { count: existCount, error: existErr } = await supabaseAdmin
          .from('user_balances')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', t.userId)
          .eq('claim_id', claim.id ?? null)
          .eq('type', t.type)
          .eq('source_invoice_id', invoiceId)
          .throwOnError();
        if (!existErr && (existCount ?? 0) > 0) {
          const { error: upErr } = await supabaseAdmin
            .from('user_balances')
            .update({
              amount: ledgerAmount,
              currency: 'aud',
              venue_id: venueId,
              week_start: startIso.slice(0, 10),
              week_end: endIso.slice(0, 10),
              status: ledgerStatus,
              created_at: new Date().toISOString()
            })
            .eq('user_id', t.userId)
            .eq('claim_id', claim.id ?? null)
            .eq('type', t.type)
            .eq('source_invoice_id', invoiceId);
          if (!upErr) updated += 1;
        } else {
          const { error } = await supabaseAdmin.from('user_balances').insert({
            user_id: t.userId,
            type: t.type,
            amount: ledgerAmount,
            currency: 'aud',
            claim_id: claim.id ?? null,
            venue_id: venueId,
            week_start: startIso.slice(0, 10),
            week_end: endIso.slice(0, 10),
            source_invoice_id: invoiceId,
            status: ledgerStatus,
            created_at: new Date().toISOString()
          });
          if (!error) written += 1;
        }
      }
      if (claim.id) {
        await supabaseAdmin.from('claims').update({ status: claim.status ?? null }).eq('id', claim.id);
      }
    }
    return json({
      ok: true,
      written,
      updated,
      claims_considered: items.length,
      totals: {
        pending: pendingTotal,
        approved: approvedTotal,
        denied: deniedTotal,
        available: availableTotal
      }
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message || 'sync_failed'
        : 'sync_failed';
    return json({ ok: false, error: message }, { status: 500 });
  }
}
