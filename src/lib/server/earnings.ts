import { supabaseAdmin } from '$lib/server/supabaseAdmin';
import { sendPushToUser, isPushEnabled } from '$lib/server/push';
import { env } from '$env/dynamic/private';

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

type ClaimRow = {
  id: string;
  venue: string | null;
  venue_id: string;
  amount: number | null;
  purchased_at: string;
  status: string | null;
  submitter_id: string | null;
  referrer_id: string | null;
  kickback_guest_rate: number | null;
  kickback_referrer_rate: number | null;
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

export async function createEarningsForClaimId(
  claimId: string,
  options?: { requesterId?: string | null; requireOwner?: boolean; allowGuestWithoutSubmitter?: boolean }
): Promise<{ ok: boolean; error?: string; already_exists?: boolean }> {
  const { data: claim, error: claimError } = await supabaseAdmin
    .from('claims')
    .select('id, venue, venue_id, amount, purchased_at, status, submitter_id, referrer_id, kickback_guest_rate, kickback_referrer_rate')
    .eq('id', claimId)
    .maybeSingle();

  if (claimError || !claim) {
    return { ok: false, error: claimError?.message ?? 'claim_not_found' };
  }

  const typedClaim = claim as ClaimRow;

  if (options?.requireOwner && options.requesterId && typedClaim.submitter_id !== options.requesterId) {
    return { ok: false, error: 'not_claim_owner' };
  }

  const guestWithoutSubmitter = Boolean(options?.allowGuestWithoutSubmitter && !typedClaim.submitter_id);

  if (!typedClaim.submitter_id && !guestWithoutSubmitter) {
    return { ok: false, error: 'missing_submitter' };
  }
  if (!typedClaim.referrer_id) {
    return { ok: false, error: 'missing_referrer' };
  }

  const { data: existing } = await supabaseAdmin
    .from('earnings')
    .select('id')
    .eq('claim_id', typedClaim.id)
    .limit(1);
  if ((existing ?? []).length > 0) {
    return { ok: true, already_exists: true };
  }

  const amount = Number(typedClaim.amount ?? 0);
  const guestRate = Number(typedClaim.kickback_guest_rate ?? 0) / 100;
  const referrerRate = Number(typedClaim.kickback_referrer_rate ?? 0) / 100;
  const guestAmount = guestWithoutSubmitter ? 0 : Number((amount * guestRate).toFixed(2));
  const referrerAmount = Number((amount * referrerRate).toFixed(2));
  const platformFee = Number((amount * 0.02).toFixed(2));
  const venueFee = Number((referrerAmount + platformFee + (guestWithoutSubmitter ? 0 : guestAmount)).toFixed(2));

  const guestLastPaid = guestWithoutSubmitter
    ? null
    : await supabaseAdmin
        .from('payouts')
        .select('paid_at')
        .eq('user_id', typedClaim.submitter_id)
        .eq('status', 'paid')
        .order('paid_at', { ascending: false })
        .limit(1)
        .maybeSingle();

  const { data: referrerLastPaid } = await supabaseAdmin
    .from('payouts')
    .select('paid_at')
    .eq('user_id', typedClaim.referrer_id)
    .eq('status', 'paid')
    .order('paid_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const guestStatus = guestWithoutSubmitter
    ? null
    : getInitialEarningStatus(guestLastPaid?.data?.paid_at ?? null, typedClaim.purchased_at);
  const referrerStatus = getInitialEarningStatus(referrerLastPaid?.paid_at ?? null, typedClaim.purchased_at);

  const earningsRows: Array<Record<string, unknown>> = [];
  if (!guestWithoutSubmitter) {
    earningsRows.push({
      claim_id: typedClaim.id,
      user_id: typedClaim.submitter_id,
      role: 'guest',
      amount: guestAmount,
      rate_pct: Number(typedClaim.kickback_guest_rate ?? 0),
      venue_id: typedClaim.venue_id,
      purchased_at: typedClaim.purchased_at,
      status: guestStatus
    });
  }
  earningsRows.push({
    claim_id: typedClaim.id,
    user_id: typedClaim.referrer_id,
    role: 'referrer',
    amount: referrerAmount,
    rate_pct: Number(typedClaim.kickback_referrer_rate ?? 0),
    venue_id: typedClaim.venue_id,
    purchased_at: typedClaim.purchased_at,
    status: referrerStatus
  });

  const { error: earningsError } = await supabaseAdmin
    .from('earnings')
    .insert(earningsRows);

  if (earningsError) {
    return { ok: false, error: earningsError.message };
  }

  const { error: feeError } = await supabaseAdmin
    .from('venue_fees')
    .insert({
      claim_id: typedClaim.id,
      venue_id: typedClaim.venue_id,
      amount: venueFee,
      platform_fee: platformFee,
      status: 'unbilled'
    });

  if (feeError) {
    return { ok: false, error: feeError.message };
  }

  return { ok: true };
}

export async function sendEarningsNotificationsForClaims(claimIds: string[]): Promise<void> {
  if (!isPushEnabled() || claimIds.length === 0) return;
  const { data: claims } = await supabaseAdmin
    .from('claims')
    .select('id, venue, amount, status, submitter_id, referrer_id, kickback_guest_rate, kickback_referrer_rate, submitter_referral_code')
    .in('id', claimIds);
  if (!claims || claims.length === 0) return;
  const userIds = Array.from(
    new Set(
      claims.flatMap((c) => [String(c.submitter_id ?? ''), String(c.referrer_id ?? '')]).filter(Boolean)
    )
  );
  if (userIds.length === 0) return;
  const { data: profiles } = await supabaseAdmin
    .from('profiles')
    .select('id, notify_approved_claims')
    .in('id', userIds);
  const notifySet = new Set(
    (profiles ?? [])
      .filter((p) => p.notify_approved_claims)
      .map((p) => String(p.id))
  );
  if (notifySet.size === 0) return;
  const appUrl = (
    env.PRIVATE_APP_URL ||
    env.PUBLIC_APP_URL ||
    'https://kkbk.app'
  ).replace(/\/+$/, '');
  const dashboardUrl = `${appUrl}/`;

  for (const claim of claims as any[]) {
    const claimStatus = String(claim.status ?? '').toLowerCase();
    if (!['approved', 'paid', 'guestpaid', 'refpaid', 'paidout'].includes(claimStatus)) continue;
    const amount = Number(claim.amount ?? 0);
    const guestRate = Number(claim.kickback_guest_rate ?? 0) / 100;
    const refRate = Number(claim.kickback_referrer_rate ?? 0) / 100;
    const venueName = String(claim.venue ?? '').trim() || 'venue';
    if (claim.submitter_id && notifySet.has(String(claim.submitter_id))) {
      const earned = Math.max(0, Number((amount * guestRate).toFixed(2)));
      await sendPushToUser(String(claim.submitter_id), {
        title: `+$${earned.toFixed(2)} earned`,
        body: `from ${venueName}`,
        url: dashboardUrl,
        tag: `earnings:${claim.id}:guest`
      });
    }
    if (claim.referrer_id && notifySet.has(String(claim.referrer_id))) {
      const earned = Math.max(0, Number((amount * refRate).toFixed(2)));
      await sendPushToUser(String(claim.referrer_id), {
        title: `+$${earned.toFixed(2)} earned`,
        body: `${String(claim.submitter_referral_code ?? 'member')} used your code at ${venueName}`,
        url: dashboardUrl,
        tag: `earnings:${claim.id}:referrer`
      });
    }
  }
}
