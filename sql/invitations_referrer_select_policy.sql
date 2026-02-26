-- Allow referrers to read invitations addressed to their referral code
drop policy if exists "Invitations are viewable by referrer" on invitations;
create policy "Invitations are viewable by referrer"
  on invitations for select
  using (
    exists (
      select 1
      from profiles p
      where p.id = auth.uid()
        and (
          lower(p.referral_code) = lower(invitations.referrer_code)
          or lower(p.referral_code_original) = lower(invitations.referrer_code)
        )
    )
  );
