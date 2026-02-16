import { json } from '@sveltejs/kit';
import { supabaseAdmin } from '$lib/server/supabaseAdmin';

export async function POST({ request }) {
  try {
    const body = await request.json().catch(() => null);
    const claimIds: string[] = Array.isArray(body?.claim_ids) ? body.claim_ids : [];
    const rangeStartBody: string | undefined = typeof body?.range_start === 'string' ? body.range_start : undefined;
    const rangeEndBody: string | undefined = typeof body?.range_end === 'string' ? body.range_end : undefined;
    if (!claimIds || claimIds.length === 0) {
      return json({ ok: false, error: 'missing_claim_ids' }, { status: 400 });
    }

    const { data: claims, error: claimsError } = await supabaseAdmin
      .from('claims')
      .select('id, venue_id, amount, status, purchased_at')
      .in('id', claimIds);
    if (claimsError) {
      return json({ ok: false, error: claimsError.message }, { status: 500 });
    }
    const rows = (claims ?? []).filter((c) => c.venue_id);
    if (rows.length === 0) {
      return json({ ok: false, error: 'no_venue_claims' }, { status: 400 });
    }

    const totals = new Map<string, number>();
    const ranges = new Map<string, { min: number; max: number }>();
    for (const claim of rows) {
      const status = (claim.status ?? 'approved') as string;
      if (status !== 'approved') continue;
      const vId = claim.venue_id as string;
      totals.set(vId, (totals.get(vId) ?? 0) + Number(claim.amount || 0));
      const t = new Date((claim as any).purchased_at).getTime();
      if (!Number.isNaN(t)) {
        const existing = ranges.get(vId);
        if (!existing) {
          ranges.set(vId, { min: t, max: t });
        } else {
          if (t < existing.min) existing.min = t;
          if (t > existing.max) existing.max = t;
        }
      }
    }
    if (totals.size === 0) {
      return json({ ok: false, error: 'no_approved_claims' }, { status: 400 });
    }

    const venueIds = Array.from(totals.keys());
    const { data: venues, error: venuesError } = await supabaseAdmin
      .from('venues')
      .select('id, name, billing_email')
      .in('id', venueIds);
    if (venuesError) {
      return json({ ok: false, error: venuesError.message }, { status: 500 });
    }

    const results: {
      venue_id: string;
      ok: boolean;
      error?: string;
      subtotal?: number;
      total?: number;
      amount_due?: number;
      memo?: string;
      line_items?: { amount: number; description: string | null }[];
    }[] = [];

    let week_start: string | null = null;
    let week_end: string | null = null;

    for (const venue of venues ?? []) {
      const total = totals.get(venue.id) ?? 0;
      if (!total || total <= 0) continue;
      if (!venue.billing_email) {
        results.push({ venue_id: venue.id, ok: false, error: 'missing_billing_email' });
        continue;
      }

      const referrerFee = total * 0.05;
      const guestFee = total * 0.05;
      const platformFee = total * 0.02;
      const subtotal = referrerFee + guestFee + platformFee;
      const totalWithGst = subtotal;

      const range = ranges.get(venue.id);
      const startLabel =
        rangeStartBody ??
        (range ? new Date(range.min).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10));
      const endLabel = rangeEndBody ?? (range ? new Date(range.max).toISOString().slice(0, 10) : startLabel);
      week_start = week_start ?? startLabel;
      week_end = week_end ?? endLabel;

      const memo = `Kickback invoice ($${Number(total || 0).toFixed(2)} total referred revenue from ${startLabel} to ${endLabel})`;
      const line_items = [
        { amount: Number(referrerFee.toFixed(2)), description: 'Kickback Marketing & Referral Services - Referrer commission (5%)' },
        { amount: Number(guestFee.toFixed(2)), description: 'Kickback Marketing & Referral Services - New customer cashback (5%)' },
        { amount: Number(platformFee.toFixed(2)), description: 'Kickback Marketing & Referral Services - Platform fee (2%)' }
      ];

      results.push({
        venue_id: venue.id,
        ok: true,
        subtotal,
        total: totalWithGst,
        amount_due: totalWithGst,
        line_items,
        memo
      });
    }

    return json({
      ok: true,
      week_start,
      week_end,
      range_start: week_start,
      range_end: week_end,
      results,
      totals: Array.from(totals.entries()).map(([venue_id, total]) => ({ venue_id, total }))
    });
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : 'preview_failed' }, { status: 500 });
  }
}
