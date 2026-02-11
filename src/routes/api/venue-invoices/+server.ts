import { json } from '@sveltejs/kit';
import { supabaseAdmin } from '$lib/server/supabaseAdmin';

export async function GET({ url }) {
  try {
    const venueId = url.searchParams.get('venue_id') ?? undefined;
    if (!venueId) {
      return json({ ok: false, error: 'missing_venue_id' }, { status: 400 });
    }
    const { data, error } = await supabaseAdmin
      .from('venue_invoices')
      .select('week_start, week_end, stripe_invoice_url, status')
      .eq('venue_id', venueId)
      .order('created_at', { ascending: false })
      .limit(5);
    if (error) {
      return json({ ok: false, error: error.message }, { status: 500 });
    }
    return json({ ok: true, invoices: data ?? [] });
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : 'load_failed' }, { status: 500 });
  }
}
