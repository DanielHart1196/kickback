alter table public.payouts
  add column if not exists bsb text,
  add column if not exists account_number text,
  add column if not exists payout_method text;
