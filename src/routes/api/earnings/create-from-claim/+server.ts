import { json, type RequestHandler } from '@sveltejs/kit';
import { supabaseAdmin } from '$lib/server/supabaseAdmin';

const timeZone = 'Australia/Melbourne';
const weekdayIndex: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6
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

function toZonedDateOnly(value: Date, zone: string): string {
  const parts = getZonedDateParts(value, zone);
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  return formatDateOnly(date);
}

function getLastSundayDateOnly(now: Date, zone: string): string {
  const parts = getZonedDateParts(now, zone);
  const localDate = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  const lastSunday = new Date(localDate);
  lastSunday.setUTCDate(lastSunday.getUTCDate() - parts.weekday);
  return formatDateOnly(lastSunday);
}

function getInitialEarningStatus(lastPaidAt: string | null, purchasedAt: string): 'scheduled' | 'unpaid' {
  const cutoffDate = getLastSundayDateOnly(new Date(), timeZone);
  const purchasedDate = toZonedDateOnly(new Date(purchasedAt), timeZone);
  if (!lastPaidAt) return 'scheduled';
  const lastPaidDate = toZonedDateOnly(new Date(lastPaidAt), timeZone);
  if (purchasedDate <= cutoffDate) return 'scheduled';
  if (lastPaidDate >= cutoffDate) return 'scheduled';
  return 'unpaid';
}

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

  const { data: claim, error: claimError } = await supabaseAdmin
    .from('claims')
    .select('id, venue_id, amount, purchased_at, submitter_id, referrer_id, kickback_guest_rate, kickback_referrer_rate')
    .eq('id', claimId)
    .maybeSingle();

  if (claimError || !claim) {
    return json({ ok: false, error: claimError?.message ?? 'claim_not_found' }, { status: 404 });
  }

  if (claim.submitter_id !== requesterData.user.id) {
    return json({ ok: false, error: 'not_claim_owner' }, { status: 403 });
  }

  if (!claim.referrer_id) {
    return json({ ok: false, error: 'missing_referrer' }, { status: 400 });
  }

  const guestRate = Number(claim.kickback_guest_rate ?? 0) / 100;
  const referrerRate = Number(claim.kickback_referrer_rate ?? 0) / 100;
  const amount = Number(claim.amount ?? 0);
  const guestAmount = Number((amount * guestRate).toFixed(2));
  const referrerAmount = Number((amount * referrerRate).toFixed(2));
  const platformFee = Number((amount * 0.02).toFixed(2));
  const venueFee = Number((guestAmount + referrerAmount + platformFee).toFixed(2));

  const { data: guestLastPaid } = await supabaseAdmin
    .from('payouts')
    .select('paid_at')
    .eq('user_id', claim.submitter_id)
    .eq('status', 'paid')
    .order('paid_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: referrerLastPaid } = await supabaseAdmin
    .from('payouts')
    .select('paid_at')
    .eq('user_id', claim.referrer_id)
    .eq('status', 'paid')
    .order('paid_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const guestStatus = getInitialEarningStatus(guestLastPaid?.paid_at ?? null, claim.purchased_at);
  const referrerStatus = getInitialEarningStatus(referrerLastPaid?.paid_at ?? null, claim.purchased_at);

  const { error: earningsError } = await supabaseAdmin
    .from('earnings')
    .insert([
      {
        claim_id: claim.id,
        user_id: claim.submitter_id,
        role: 'guest',
        amount: guestAmount,
        rate_pct: Number(claim.kickback_guest_rate ?? 0),
        venue_id: claim.venue_id,
        purchased_at: claim.purchased_at,
        status: guestStatus
      },
      {
        claim_id: claim.id,
        user_id: claim.referrer_id,
        role: 'referrer',
        amount: referrerAmount,
        rate_pct: Number(claim.kickback_referrer_rate ?? 0),
        venue_id: claim.venue_id,
        purchased_at: claim.purchased_at,
        status: referrerStatus
      }
    ]);

  if (earningsError) {
    return json({ ok: false, error: earningsError.message }, { status: 500 });
  }

  const { error: feeError } = await supabaseAdmin
    .from('venue_fees')
    .insert({
      claim_id: claim.id,
      venue_id: claim.venue_id,
      amount: venueFee,
      platform_fee: platformFee,
      status: 'unbilled'
    });

  if (feeError) {
    return json({ ok: false, error: feeError.message }, { status: 500 });
  }

  return json({ ok: true, guest_status: guestStatus, referrer_status: referrerStatus });
};
