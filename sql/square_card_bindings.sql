create table if not exists public.square_card_bindings (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues(id) on delete cascade,
  card_fingerprint text not null,
  user_id uuid not null,
  first_claim_id text,
  first_purchased_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (venue_id, card_fingerprint)
);

alter table public.square_card_bindings
  alter column first_claim_id type text using first_claim_id::text;

create index if not exists square_card_bindings_venue_user_idx
  on public.square_card_bindings (venue_id, user_id);

insert into public.square_card_bindings (
  venue_id,
  card_fingerprint,
  user_id,
  first_claim_id,
  first_purchased_at
)
select
  seed.venue_id,
  seed.square_card_fingerprint,
  seed.submitter_id,
  seed.id::text,
  seed.purchased_at
from (
  select distinct on (venue_id, square_card_fingerprint)
    id,
    venue_id,
    square_card_fingerprint,
    submitter_id,
    purchased_at,
    created_at
  from public.claims
  where venue_id is not null
    and square_card_fingerprint is not null
    and submitter_id is not null
  order by venue_id, square_card_fingerprint, purchased_at asc, created_at asc
) as seed
on conflict (venue_id, card_fingerprint) do nothing;

create unique index if not exists claims_square_payment_id_unique_idx
  on public.claims (square_payment_id)
  where square_payment_id is not null;
