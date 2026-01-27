import { supabase } from '$lib/supabase';
import type { Claim, ClaimInsert, ClaimStatus } from './types';

export async function fetchClaimsForUser(userId: string): Promise<Claim[]> {
  const { data, error } = await supabase
    .from('claims')
    .select('*')
    .or(`submitter_id.eq.${userId},referrer_id.eq.${userId}`)
    .order('purchased_at', { ascending: false });

  if (error) throw error;
  return data ?? [];
}

export async function fetchAllClaims(): Promise<Claim[]> {
  const { data, error } = await supabase
    .from('claims')
    .select('*')
    .order('purchased_at', { ascending: false });

  if (error) throw error;
  return data ?? [];
}

export async function fetchClaimsForVenueId(venueId: string): Promise<Claim[]> {
  const { data, error } = await supabase
    .from('claims')
    .select('*')
    .eq('venue_id', venueId)
    .order('purchased_at', { ascending: false });

  if (error) throw error;
  return data ?? [];
}

export async function insertClaim(claim: ClaimInsert): Promise<Claim> {
  const { data, error } = await supabase.from('claims').insert([claim]).select('*').single();
  if (error) throw error;
  return data;
}

export async function upsertProfileLast4(userId: string, last4: string): Promise<void> {
  const { error } = await supabase.from('profiles').upsert({
    id: userId,
    last_4: last4,
    updated_at: new Date().toISOString()
  });

  if (error) throw error;
}

export async function deleteClaim(claimId: string): Promise<void> {
  const { error } = await supabase.from('claims').delete().eq('id', claimId);
  if (error) throw error;
}

export async function updateClaimStatus(claimId: string, status: ClaimStatus): Promise<void> {
  const { error } = await supabase.from('claims').update({ status }).eq('id', claimId);
  if (error) throw error;
}

export async function updateClaimWithSquareMatch(
  claimId: string,
  status: ClaimStatus,
  squareMatch: {
    paymentId: string;
    fingerprint: string;
    locationId?: string | null;
  }
): Promise<void> {
  const { error } = await supabase
    .from('claims')
    .update({
      status,
      square_payment_id: squareMatch.paymentId,
      square_card_fingerprint: squareMatch.fingerprint,
      square_location_id: squareMatch.locationId ?? null
    })
    .eq('id', claimId);
  if (error) throw error;
}
