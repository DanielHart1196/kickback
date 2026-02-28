alter table public.payout_profiles
  add column if not exists bsb text,
  add column if not exists account_number text;
