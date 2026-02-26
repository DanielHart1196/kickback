create table if not exists earnings (
  id uuid primary key default gen_random_uuid(),
  claim_id bigint not null references claims(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  venue_id uuid not null references venues(id) on delete cascade,
  role text not null check (role in ('guest', 'referrer')),
  amount numeric not null,
  rate_pct numeric not null,
  purchased_at timestamptz not null,
  status text not null default 'unpaid' check (status in ('unpaid', 'scheduled', 'paid', 'denied')),
  scheduled_payout_id uuid,
  paid_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists earnings_user_status_idx on earnings (user_id, status);
create index if not exists earnings_claim_idx on earnings (claim_id);

alter table earnings enable row level security;

create policy "Earnings are viewable by owner"
  on earnings for select
  using (auth.uid() = user_id);
