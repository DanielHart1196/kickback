-- Prevent accidental admin -> non-admin role changes.
-- Service role is allowed to bypass this guard.

create or replace function public.prevent_admin_role_downgrade()
returns trigger
language plpgsql
as $$
begin
  if old.role = 'admin'::public.user_role
     and new.role <> 'admin'::public.user_role then
    if current_setting('request.jwt.claim.role', true) = 'service_role' then
      return new;
    end if;
    raise exception 'Cannot downgrade admin role';
  end if;

  return new;
end;
$$;

drop trigger if exists prevent_admin_role_downgrade_trigger on public.profiles;
create trigger prevent_admin_role_downgrade_trigger
before update on public.profiles
for each row
execute function public.prevent_admin_role_downgrade();
