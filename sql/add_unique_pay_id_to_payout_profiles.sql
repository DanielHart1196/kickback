-- Add unique constraint to pay_id in payout_profiles
-- This ensures that no two users can share the same PayID.
-- In PostgreSQL, multiple NULL values are allowed even with a UNIQUE constraint.

ALTER TABLE public.payout_profiles
ADD CONSTRAINT payout_profiles_pay_id_key UNIQUE (pay_id);
