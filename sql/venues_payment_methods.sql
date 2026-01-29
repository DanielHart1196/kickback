alter table public.venues
  add column if not exists payment_methods text[] not null default '{}';
