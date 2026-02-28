import { json, type RequestHandler } from '@sveltejs/kit';
import { supabaseAdmin } from '$lib/server/supabaseAdmin';

const timeZone = 'Australia/Sydney';
const weekdayIndex: Record<string, number> = {
  Mon: 0,
  Tue: 1,
  Wed: 2,
  Thu: 3,
  Fri: 4,
  Sat: 5,
  Sun: 6
};

function getZonedDateParts(date: Date, zone: string) {
  const parts = new Intl.DateTimeFormat('en-AU', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short'
  }).formatToParts(date);
  const lookup = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    year: Number(lookup.year),
    month: Number(lookup.month),
    day: Number(lookup.day),
    weekday: weekdayIndex[lookup.weekday] ?? 0
  };
}

function formatDateOnly(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getPayoutWeekRange(paidAtIso: string): { period_start: string; period_end: string } {
  const paidAtDate = new Date(paidAtIso);
  if (!Number.isFinite(paidAtDate.getTime())) {
    const today = formatDateOnly(new Date());
    return { period_start: today, period_end: today };
  }
  const parts = getZonedDateParts(paidAtDate, timeZone);
  const paidLocalDate = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  const currentWeekMonday = new Date(paidLocalDate);
  currentWeekMonday.setUTCDate(currentWeekMonday.getUTCDate() - parts.weekday);
  const payoutWeekMonday = new Date(currentWeekMonday);
  payoutWeekMonday.setUTCDate(payoutWeekMonday.getUTCDate() - 7);
  const payoutWeekSunday = new Date(payoutWeekMonday);
  payoutWeekSunday.setUTCDate(payoutWeekSunday.getUTCDate() + 6);

  return {
    period_start: formatDateOnly(payoutWeekMonday),
    period_end: formatDateOnly(payoutWeekSunday)
  };
}

type HistoryRow = {
  id: string;
  claim_ids: string[] | null;
  amount: number | null;
  currency: string | null;
  pay_id: string | null;
  bsb: string | null;
  account_number: string | null;
  payout_method: string | null;
  paid_at: string | null;
  claim_count: number | null;
  created_at: string | null;
};

type EarningRow = {
  claim_id: string | number | null;
  amount: number | null;
  role: string | null;
  venue_id: string | null;
};

type VenueRow = {
  id: string;
  name: string | null;
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
    .select('id, claim_ids, amount, currency, pay_id, bsb, account_number, payout_method, paid_at, claim_count, created_at')
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
  const earningsByClaimId = new Map<string, EarningRow[]>();
  const venueIds = new Set<string>();

  if (allClaimIds.length > 0) {
    const { data: earnings, error: earningsError } = await supabaseAdmin
      .from('earnings')
      .select('claim_id, amount, role, venue_id')
      .eq('user_id', userId)
      .in('claim_id', allClaimIds);
    if (earningsError) {
      return json({ ok: false, error: earningsError.message }, { status: 500 });
    }
    for (const row of (earnings ?? []) as EarningRow[]) {
      const claimId = String(row.claim_id ?? '');
      if (!claimId) continue;
      const list = earningsByClaimId.get(claimId);
      if (list) list.push(row);
      else earningsByClaimId.set(claimId, [row]);
      if (row.venue_id) venueIds.add(String(row.venue_id));
    }
  }

  const venueNameById = new Map<string, string>();
  if (venueIds.size > 0) {
    const { data: venues, error: venuesError } = await supabaseAdmin
      .from('venues')
      .select('id, name')
      .in('id', Array.from(venueIds));
    if (venuesError) {
      return json({ ok: false, error: venuesError.message }, { status: 500 });
    }
    for (const venue of (venues ?? []) as VenueRow[]) {
      venueNameById.set(String(venue.id), String(venue.name ?? '').trim());
    }
  }

  const payouts = payoutRows
    .map((row) => {
      const claimIds = (Array.isArray(row.claim_ids) ? row.claim_ids : []).map((id) => String(id));
      const venueTotals = new Map<string, number>();
      let referralRewards = 0;
      let cashback = 0;
      for (const claimId of claimIds) {
        const earningRows = earningsByClaimId.get(claimId);
        if (!earningRows || earningRows.length === 0) continue;
        for (const earning of earningRows) {
          const amount = Number(earning.amount ?? 0);
          if (!Number.isFinite(amount) || amount <= 0) continue;
          const role = String(earning.role ?? '');
          if (role === 'guest') cashback += amount;
          if (role === 'referrer') referralRewards += amount;
          const venueName =
            (earning.venue_id ? venueNameById.get(String(earning.venue_id)) : null) ||
            'Unknown venue';
          venueTotals.set(venueName, (venueTotals.get(venueName) ?? 0) + amount);
        }
      }
      const paidAtFallback = row.paid_at ?? row.created_at ?? new Date().toISOString();
      const paidAtFallbackMs = new Date(paidAtFallback).getTime();
      const paidAtFallbackIso = Number.isFinite(paidAtFallbackMs)
        ? new Date(paidAtFallbackMs).toISOString()
        : new Date().toISOString();
      const payoutWeek = getPayoutWeekRange(paidAtFallbackIso);

      return {
        id: String(row.id),
        amount: Number(Number(row.amount ?? 0).toFixed(2)),
        currency: String(row.currency ?? 'aud').toLowerCase(),
        paid_at: paidAtFallbackIso,
        pay_id: String(row.pay_id ?? ''),
        bsb: String(row.bsb ?? ''),
        account_number: String(row.account_number ?? ''),
        payout_method: String(row.payout_method ?? ''),
        claim_count: Number(row.claim_count ?? claimIds.length),
        period_start: payoutWeek.period_start,
        period_end: payoutWeek.period_end,
        referral_rewards: Number(referralRewards.toFixed(2)),
        cashback: Number(cashback.toFixed(2)),
        venue_totals: Array.from(venueTotals.entries())
          .map(([venue, total_amount]) => ({ venue, total_amount: Number(total_amount.toFixed(2)) }))
          .sort((a, b) => b.total_amount - a.total_amount)
      };
    })
    .sort((a, b) => new Date(b.paid_at).getTime() - new Date(a.paid_at).getTime());

  return json({ ok: true, payouts });
};
