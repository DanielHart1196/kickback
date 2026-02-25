create table if not exists public.activation_claim_tokens (
  id uuid primary key default gen_random_uuid(),
  claim_id bigint not null references public.claims(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  claimed_by uuid references auth.users(id) on delete set null,
  claimed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists activation_claim_tokens_claim_id_idx
  on public.activation_claim_tokens (claim_id);

create unique index if not exists activation_claim_tokens_active_claim_unique
  on public.activation_claim_tokens (claim_id)
  where claimed_at is null;

alter table public.activation_claim_tokens enable row level security;
