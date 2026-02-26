create unique index if not exists claims_square_payment_id_unique_idx
  on public.claims (square_payment_id)
  where square_payment_id is not null;
