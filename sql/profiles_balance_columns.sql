-- Adds aggregate balance columns to profiles for Ops/Dashboard access
alter table public.profiles
  add column if not exists pending_balance numeric not null default 0,
  add column if not exists approved_balance numeric not null default 0,
  add column if not exists available_balance numeric not null default 0,
  add column if not exists paid_balance numeric not null default 0;
--
-- Keep profile balance columns in sync automatically with user_balances
--
create or replace function public.refresh_profile_balances(p_user_id uuid)
returns void
language plpgsql
as $$
declare
  v_pending numeric := 0;
  v_approved numeric := 0;
  v_available numeric := 0;
  v_paid numeric := 0;
begin
  select
    coalesce(sum(case when status = 'pending' then amount else 0 end), 0),
    coalesce(sum(case when status in ('approved','venuepaid') then amount else 0 end), 0),
    coalesce(sum(case when status = 'available' then amount else 0 end), 0),
    coalesce(sum(case when status = 'paid' then amount else 0 end), 0)
  into v_pending, v_approved, v_available, v_paid
  from public.user_balances
  where user_id = p_user_id;

  update public.profiles
  set pending_balance = v_pending,
      approved_balance = v_approved,
      available_balance = v_available,
      paid_balance = v_paid
  where id = p_user_id;
end;
$$;

create or replace function public.user_balances_refresh_profiles()
returns trigger
language plpgsql
as $$
begin
  if (tg_op = 'INSERT') then
    perform public.refresh_profile_balances(new.user_id);
  elsif (tg_op = 'UPDATE') then
    if (new.user_id <> old.user_id) then
      perform public.refresh_profile_balances(old.user_id);
    end if;
    perform public.refresh_profile_balances(new.user_id);
  elsif (tg_op = 'DELETE') then
    perform public.refresh_profile_balances(old.user_id);
  end if;
  return null;
end;
$$;

drop trigger if exists user_balances_refresh_profiles on public.user_balances;
create trigger user_balances_refresh_profiles
after insert or update or delete on public.user_balances
for each row execute function public.user_balances_refresh_profiles();
