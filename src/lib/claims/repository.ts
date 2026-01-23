import { supabase } from '$lib/supabase';
import type { Claim, ClaimInsert } from './types';

export async function fetchClaimsForUser(userId: string): Promise<Claim[]> {
  const { data, error } = await supabase
    .from('claims')
    .select('*')
    .eq('submitter_id', userId)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data ?? [];
}

export async function fetchAllClaims(): Promise<Claim[]> {
  const { data, error } = await supabase
    .from('claims')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data ?? [];
}

export async function insertClaim(claim: ClaimInsert): Promise<void> {
  const { error } = await supabase.from('claims').insert([claim]);
  if (error) throw error;
}

export async function upsertProfileLast4(userId: string, last4: string): Promise<void> {
  const { error } = await supabase.from('profiles').upsert({
    id: userId,
    last_4: last4,
    updated_at: new Date().toISOString()
  });

  if (error) throw error;
}
