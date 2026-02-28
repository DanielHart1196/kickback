alter table public.venues
  add column if not exists happy_hour_start_time_2 text,
  add column if not exists happy_hour_end_time_2 text,
  add column if not exists happy_hour_days_2 text[],
  add column if not exists happy_hour_start_time_3 text,
  add column if not exists happy_hour_end_time_3 text,
  add column if not exists happy_hour_days_3 text[];
