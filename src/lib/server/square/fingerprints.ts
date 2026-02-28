import { supabaseAdmin } from '$lib/server/supabaseAdmin';
import type { SquarePayment } from '$lib/server/square/payments';

const dayMs = 24 * 60 * 60 * 1000;

export function getFingerprintCutoffs(now = new Date()) {
  const minAgeCutoff = new Date(now.getTime() - dayMs);
  const sixMonthsAgo = new Date(now);
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
  return { minAgeCutoff, sixMonthsAgo };
}

type FingerprintWindow = { first: string; last: string };

function updateWindow(existing: FingerprintWindow | undefined, seenAt: string): FingerprintWindow {
  if (!existing) return { first: seenAt, last: seenAt };
  const existingFirst = new Date(existing.first).getTime();
  const existingLast = new Date(existing.last).getTime();
  const seenTime = new Date(seenAt).getTime();
  if (!Number.isFinite(seenTime)) return existing;
  const first = !Number.isFinite(existingFirst) || seenTime < existingFirst ? seenAt : existing.first;
  const last = !Number.isFinite(existingLast) || seenTime > existingLast ? seenAt : existing.last;
  return { first, last };
}

export async function cleanupOldFingerprints(venueId: string, cutoff: Date) {
  await supabaseAdmin
    .from('venue_card_fingerprints')
    .delete()
    .eq('venue_id', venueId)
    .lt('last_seen_at', cutoff.toISOString());
}

export async function upsertVenueFingerprints(args: {
  venueId: string;
  payments: SquarePayment[];
  allowedLocationIds?: Set<string>;
  now?: Date;
}) {
  const now = args.now ?? new Date();
  const windows = new Map<string, FingerprintWindow>();

  for (const payment of args.payments) {
    if (payment.status && payment.status !== 'COMPLETED') continue;
    const fingerprint =
      payment.card_details?.card?.fingerprint ??
      payment.card_details?.card?.card_fingerprint ??
      null;
    const createdAt = payment.created_at;
    if (!fingerprint || !createdAt) continue;
    if (args.allowedLocationIds && args.allowedLocationIds.size > 0 && payment.location_id) {
      if (!args.allowedLocationIds.has(payment.location_id)) continue;
    }
    windows.set(fingerprint, updateWindow(windows.get(fingerprint), createdAt));
  }

  const fingerprints = Array.from(windows.keys());
  if (fingerprints.length === 0) return { upserted: 0 };

  const { data: existing, error: existingError } = await supabaseAdmin
    .from('venue_card_fingerprints')
    .select('card_fingerprint,first_seen_at,last_seen_at')
    .eq('venue_id', args.venueId)
    .in('card_fingerprint', fingerprints);

  if (existingError) {
    throw existingError;
  }

  const existingMap = new Map<string, FingerprintWindow>();
  for (const row of existing ?? []) {
    if (!row.card_fingerprint) continue;
    existingMap.set(row.card_fingerprint, {
      first: row.first_seen_at ?? row.last_seen_at ?? now.toISOString(),
      last: row.last_seen_at ?? row.first_seen_at ?? now.toISOString()
    });
  }

  const rows = fingerprints.map((fingerprint) => {
    const window = windows.get(fingerprint);
    const existingWindow = existingMap.get(fingerprint);
    const combined = updateWindow(existingWindow, window?.first ?? now.toISOString());
    const combinedFinal = window?.last ? updateWindow(combined, window.last) : combined;
    return {
      venue_id: args.venueId,
      card_fingerprint: fingerprint,
      first_seen_at: combinedFinal.first,
      last_seen_at: combinedFinal.last,
      updated_at: now.toISOString()
    };
  });

  const { error: upsertError } = await supabaseAdmin
    .from('venue_card_fingerprints')
    .upsert(rows, { onConflict: 'venue_id,card_fingerprint' });

  if (upsertError) throw upsertError;

  return { upserted: rows.length };
}

export async function isFingerprintBlocked(args: {
  venueId: string;
  fingerprint: string;
  now?: Date;
}) {
  const now = args.now ?? new Date();
  const { minAgeCutoff, sixMonthsAgo } = getFingerprintCutoffs(now);
  await cleanupOldFingerprints(args.venueId, sixMonthsAgo);

  const { data, error } = await supabaseAdmin
    .from('venue_card_fingerprints')
    .select('card_fingerprint,last_seen_at')
    .eq('venue_id', args.venueId)
    .eq('card_fingerprint', args.fingerprint)
    .gte('last_seen_at', sixMonthsAgo.toISOString())
    .lte('last_seen_at', minAgeCutoff.toISOString())
    .limit(1);

  if (error) throw error;
  return (data ?? []).length > 0;
}
