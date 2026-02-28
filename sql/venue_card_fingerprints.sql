create table if not exists venue_card_fingerprints (
  venue_id uuid not null references venues(id) on delete cascade,
  card_fingerprint text not null,
  first_seen_at timestamptz not null,
  last_seen_at timestamptz not null,
  updated_at timestamptz not null default now(),
  primary key (venue_id, card_fingerprint)
);

create index if not exists venue_card_fingerprints_last_seen_idx
  on venue_card_fingerprints (venue_id, last_seen_at desc);

alter table venue_card_fingerprints enable row level security;

create policy "No access to venue fingerprints"
  on venue_card_fingerprints
  for all
  using (false)
  with check (false);
