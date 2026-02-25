-- Hardening + dedupe migration for launch readiness
-- Focus: claims, payout_profiles, square_card_bindings, payment tables

begin;

-- ------------------------------------------------------------
-- 1) CLAIMS: remove risky broad policies and re-add tight ones
-- ------------------------------------------------------------

drop policy if exists "Enable read for everyone" on public.claims;
drop policy if exists "Enable insert for everyone" on public.claims;
drop policy if exists "Users can view their own claims" on public.claims;
drop policy if exists "claims read own" on public.claims;
drop policy if exists "claims insert own" on public.claims;
drop policy if exists "Users can delete own claims" on public.claims;
drop policy if exists "Admins can read claims" on public.claims;
drop policy if exists "owners can update claim status" on public.claims;

create policy claims_select_own_or_referrer
  on public.claims
  for select
  to authenticated
  using (
    submitter_id = auth.uid()
    or referrer_id = auth.uid()::text
  );

create policy claims_insert_own
  on public.claims
  for insert
  to authenticated
  with check (
    submitter_id = auth.uid()
    and coalesce(status, 'pending') = 'pending'
  );

create policy claims_insert_guest_pending
  on public.claims
  for insert
  to anon
  with check (
    submitter_id is null
    and coalesce(status, 'pending') = 'pending'
  );

create policy claims_delete_own
  on public.claims
  for delete
  to authenticated
  using (
    submitter_id = auth.uid()
  );

create policy claims_admin_select
  on public.claims
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.role = 'admin'::public.user_role
    )
  );

-- Owner/admin can update claims only for venues they own (admins bypass ownership)
create policy claims_owner_admin_update_scoped
  on public.claims
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and (
          p.role = 'admin'::public.user_role
          or (
            p.role = 'owner'::public.user_role
            and exists (
              select 1
              from public.venue_owners vo
              where vo.venue_id = claims.venue_id
                and vo.owner_id = auth.uid()
            )
          )
        )
    )
  )
  with check (
    exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and (
          p.role = 'admin'::public.user_role
          or (
            p.role = 'owner'::public.user_role
            and exists (
              select 1
              from public.venue_owners vo
              where vo.venue_id = claims.venue_id
                and vo.owner_id = auth.uid()
            )
          )
        )
    )
  );

-- ------------------------------------------------------------
-- 2) PAYOUT_PROFILES: dedupe overlapping policies
-- ------------------------------------------------------------

drop policy if exists "Users can insert their own payout profile" on public.payout_profiles;
drop policy if exists "Users can read own payout profile" on public.payout_profiles;
drop policy if exists "Users can update own payout profile" on public.payout_profiles;
drop policy if exists "Users can update their own payout profile" on public.payout_profiles;
drop policy if exists "Users can upsert own payout profile" on public.payout_profiles;
drop policy if exists "Users can view their own payout profile" on public.payout_profiles;
drop policy if exists "insert_own_payout_profile" on public.payout_profiles;
drop policy if exists "select_own_payout_profile" on public.payout_profiles;
drop policy if exists "update_own_payout_profile" on public.payout_profiles;

create policy payout_profiles_select_own
  on public.payout_profiles
  for select
  to authenticated
  using (user_id = auth.uid());

create policy payout_profiles_insert_own
  on public.payout_profiles
  for insert
  to authenticated
  with check (user_id = auth.uid());

create policy payout_profiles_update_own
  on public.payout_profiles
  for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ------------------------------------------------------------
-- 3) SQUARE_CARD_BINDINGS: enable RLS + lock to admin/service
-- ------------------------------------------------------------

alter table public.square_card_bindings enable row level security;

-- Optional but recommended: force RLS so even table owner obeys policy
-- alter table public.square_card_bindings force row level security;

drop policy if exists square_card_bindings_admin_read on public.square_card_bindings;
create policy square_card_bindings_admin_read
  on public.square_card_bindings
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.role = 'admin'::public.user_role
    )
  );

-- No client write policy: service role bypasses RLS and can still write.

-- ------------------------------------------------------------
-- 4) PAYMENT TABLES: add missing owner/admin read policies
-- ------------------------------------------------------------

drop policy if exists venue_payment_agreements_admin_read on public.venue_payment_agreements;
drop policy if exists venue_payment_agreements_owner_read on public.venue_payment_agreements;

create policy venue_payment_agreements_admin_read
  on public.venue_payment_agreements
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.role = 'admin'::public.user_role
    )
  );

create policy venue_payment_agreements_owner_read
  on public.venue_payment_agreements
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.venue_owners vo
      where vo.venue_id = venue_payment_agreements.venue_id
        and vo.owner_id = auth.uid()
    )
  );

drop policy if exists venue_payment_requests_admin_read on public.venue_payment_requests;
drop policy if exists venue_payment_requests_owner_read on public.venue_payment_requests;

create policy venue_payment_requests_admin_read
  on public.venue_payment_requests
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.role = 'admin'::public.user_role
    )
  );

create policy venue_payment_requests_owner_read
  on public.venue_payment_requests
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.venue_owners vo
      where vo.venue_id = venue_payment_requests.venue_id
        and vo.owner_id = auth.uid()
    )
  );

commit;
