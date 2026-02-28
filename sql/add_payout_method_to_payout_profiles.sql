alter table public.payout_profiles
  add column if not exists payout_method text;

