create table if not exists public.venue_payment_agreements (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues(id) on delete cascade,
  pay_id text not null,
  pay_id_type text not null,
  payer_name text not null,
  limit_amount numeric not null,
  description text not null,
  external_id text,
  payment_agreement_type text not null,
  agreement_start_date date not null,
  frequency text not null,
  status text,
  helloclever_record_id bigint,
  payment_agreement_id text,
  client_transaction_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_status_at timestamptz
);

create index if not exists venue_payment_agreements_venue_id_idx
  on public.venue_payment_agreements (venue_id);

create index if not exists venue_payment_agreements_payment_agreement_id_idx
  on public.venue_payment_agreements (payment_agreement_id);
