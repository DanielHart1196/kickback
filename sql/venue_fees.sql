create table if not exists venue_fees (
  id uuid primary key default gen_random_uuid(),
  claim_id bigint not null references claims(id) on delete cascade,
  venue_id uuid not null references venues(id) on delete cascade,
  amount numeric not null,
  platform_fee numeric not null,
  status text not null default 'unbilled' check (status in ('unbilled', 'billed', 'paid', 'denied')),
  billed_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists venue_fees_claim_idx on venue_fees (claim_id);
create index if not exists venue_fees_status_idx on venue_fees (status);

alter table venue_fees enable row level security;
