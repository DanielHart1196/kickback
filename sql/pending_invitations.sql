create table if not exists invitations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  venue_id text not null,
  venue_name text not null,
  referrer_code text not null,
  status text not null default 'pending',
  activated_at timestamptz,
  expires_at timestamptz,
  last_activity_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index if not exists invitations_unique
  on invitations (user_id, venue_id, referrer_code);

alter table invitations enable row level security;

create policy "Invitations are viewable by owner"
  on invitations for select
  using (auth.uid() = user_id);

create policy "Invitations are insertable by owner"
  on invitations for insert
  with check (auth.uid() = user_id);

create policy "Invitations are updatable by owner"
  on invitations for update
  using (auth.uid() = user_id);

create policy "Invitations are deletable by owner"
  on invitations for delete
  using (auth.uid() = user_id);
