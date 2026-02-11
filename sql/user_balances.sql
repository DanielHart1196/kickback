create table if not exists public.user_balances (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  type text not null,
  amount numeric not null,
  currency text not null default 'aud',
  claim_id uuid,
  venue_id uuid,
  week_start date,
  week_end date,
  source_invoice_id text,
  source_charge_id text,
  status text not null default 'available',
  created_at timestamptz not null default now()
);

create index if not exists user_balances_user_id_idx
  on public.user_balances (user_id);

create index if not exists user_balances_status_idx
  on public.user_balances (status);

alter table public.user_balances enable row level security;

drop policy if exists user_balances_self_read on public.user_balances;
create policy user_balances_self_read
  on public.user_balances
  for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists user_balances_no_write_client on public.user_balances;
create policy user_balances_no_write_client
  on public.user_balances
  for insert
  to authenticated
  with check (false);
