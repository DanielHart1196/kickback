create table if not exists pending_invitations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  venue_id text not null,
  venue_name text not null,
  referrer_code text not null,
  created_at timestamptz not null default now()
);

create unique index if not exists pending_invitations_unique
  on pending_invitations (user_id, venue_id, referrer_code);

alter table pending_invitations enable row level security;

create policy "Pending invitations are viewable by owner"
  on pending_invitations for select
  using (auth.uid() = user_id);

create policy "Pending invitations are insertable by owner"
  on pending_invitations for insert
  with check (auth.uid() = user_id);

create policy "Pending invitations are deletable by owner"
  on pending_invitations for delete
  using (auth.uid() = user_id);
