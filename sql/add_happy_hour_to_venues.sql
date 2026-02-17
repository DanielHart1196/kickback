ALTER TABLE public.venues
ADD COLUMN IF NOT EXISTS happy_hour_start_time TEXT;

ALTER TABLE public.venues
ADD COLUMN IF NOT EXISTS happy_hour_end_time TEXT;

ALTER TABLE public.venues
ADD COLUMN IF NOT EXISTS happy_hour_days TEXT[] DEFAULT '{}';
