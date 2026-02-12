-- Migrate legacy 'available' balances to new 'venuepaid' status
update public.user_balances
set status = 'venuepaid'
where status = 'available';

