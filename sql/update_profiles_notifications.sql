-- Add notification preference columns to the profiles table
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS notify_approved_claims BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS notify_payout_confirmation BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS notify_essential BOOLEAN DEFAULT TRUE;

-- Update existing profiles to have notify_essential as TRUE if not set
UPDATE public.profiles SET notify_essential = TRUE WHERE notify_essential IS NULL;

-- Note: No additional RLS policies are typically needed if they already exist for the 'profiles' table.
-- Usually: 
-- CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE USING (auth.uid() = id);
-- CREATE POLICY "Users can view own profile" ON public.profiles FOR SELECT USING (auth.uid() = id);
