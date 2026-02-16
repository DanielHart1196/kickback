alter table public.payouts
  alter column claim_ids type text[]
  using (
    case
      when claim_ids is null then '{}'::text[]
      else array(select unnest(claim_ids)::text)
    end
  );
