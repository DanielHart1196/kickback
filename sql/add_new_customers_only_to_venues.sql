ALTER TABLE public.venues
ADD COLUMN IF NOT EXISTS new_customers_only boolean DEFAULT false;
