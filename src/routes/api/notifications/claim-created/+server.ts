import { json } from '@sveltejs/kit';
import { supabaseAdmin } from '$lib/server/supabaseAdmin';

export async function POST({ request }) {
  try {
    const body = await request.json().catch(() => null);
    const claimId = body?.claim_id as string | undefined;
    if (!claimId) {
      return json({ ok: false, error: 'missing_claim_id' }, { status: 400 });
    }
    const { data: claim, error: claimError } = await supabaseAdmin
      .from('claims')
      .select('*')
      .eq('id', claimId)
      .maybeSingle();
    if (claimError || !claim) {
      return json({ ok: false, error: claimError?.message ?? 'claim_not_found' }, { status: 404 });
    }
    const claimStatus = String(claim.status ?? '').toLowerCase();
    if (claimStatus !== 'approved' && claimStatus !== 'paid') {
      return json({ ok: true, skipped: 'claim_not_approved' });
    }
    const amount = Number(claim.amount || 0);
    const venueName = String(claim.venue || '');
    const guestRate = Number(claim.kickback_guest_rate || 0) / 100;
    const refRate = Number(claim.kickback_referrer_rate || 0) / 100;
    const submitterId = String(claim.submitter_id || '');
    const referrerId = String(claim.referrer_id || '');
    const codeUsed = String(claim.submitter_referral_code || 'member');

    const targets: {
      userId: string;
      emailSubject: string;
      emailText: string;
      emailHtml?: string;
    }[] = [];
    if (submitterId) {
      const earned = Math.max(0, Number((amount * guestRate).toFixed(2)));
      const earnedText = `+$${earned.toFixed(2)} earned`;
      const detailText = `from ${venueName}`;
      targets.push({
        userId: submitterId,
        emailSubject: earnedText,
        emailText: `${earnedText}\n${detailText}\n\nView your dashboard at https://kkbk.app/`,
        emailHtml: `${earnedText}<br>${detailText}<br><br>View your dashboard at https://kkbk.app/`
      });
    }
    if (referrerId) {
      const earned = Math.max(0, Number((amount * refRate).toFixed(2)));
      const earnedText = `+$${earned.toFixed(2)} earned`;
      const detailText = `${codeUsed} used your code at ${venueName}`;
      targets.push({
        userId: referrerId,
        emailSubject: earnedText,
        emailText: `${earnedText}\n${detailText}\n\nView your dashboard at https://kkbk.app/`,
        emailHtml: `${earnedText}<br>${detailText}<br><br>View your dashboard at https://kkbk.app/`
      });
    }

    const sentPush: string[] = [];
    const sentEmail: string[] = [];
    for (const t of targets) {
      // Approved-claim email notifications are intentionally disabled.
      // App notifications (PWA push/native push) should be handled via a dedicated push pipeline.
      void t;
    }

    return json({ ok: true, sentPush, sentEmail, skippedEmail: 'approved_claim_email_disabled' });
  } catch (error) {
    return json({ ok: false, error: 'failed_to_send' }, { status: 500 });
  }
}
