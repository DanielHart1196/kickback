import { supabase } from '$lib/supabase';
import type { Venue } from './types';

export async function fetchActiveVenues(): Promise<Venue[]> {
  const { data, error } = await supabase
    .from('venues')
    .select('id, name, short_code, logo_url, kickback_guest, kickback_referrer')
    .eq('active', true)
    .order('name', { ascending: true });

  if (error) throw error;
  return data ?? [];
}
