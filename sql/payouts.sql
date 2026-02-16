create table if not exists public.payouts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  amount numeric not null default 0,
  currency text not null default 'aud',
  claim_ids text[] not null default '{}',
  claim_count integer not null default 0,
  status text not null default 'unpaid' check (status in ('unpaid', 'paid')),
  pay_id text,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists payouts_user_id_idx
  on public.payouts (user_id);

create index if not exists payouts_status_idx
  on public.payouts (status);

create index if not exists payouts_paid_at_idx
  on public.payouts (paid_at desc);

alter table public.payouts enable row level security;

drop policy if exists payouts_self_read on public.payouts;
create policy payouts_self_read
  on public.payouts
  for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists payouts_no_write_client on public.payouts;
create policy payouts_no_write_client
  on public.payouts
  for all
  to authenticated
  using (false)
  with check (false);
