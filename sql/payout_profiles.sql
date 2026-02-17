-- Create payout_profiles table
CREATE TABLE IF NOT EXISTS public.payout_profiles (
    user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    full_name TEXT,
    pay_id TEXT,
    abn TEXT,
    is_hobbyist BOOLEAN DEFAULT FALSE,
    hobbyist_confirmed_at TIMESTAMPTZ,
    dob TEXT,
    address TEXT,
    stripe_account_id TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE public.payout_profiles ENABLE ROW LEVEL SECURITY;

-- Create policies
CREATE POLICY "Users can view their own payout profile"
    ON public.payout_profiles
    FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own payout profile"
    ON public.payout_profiles
    FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own payout profile"
    ON public.payout_profiles
    FOR UPDATE
    USING (auth.uid() = user_id);

-- Create trigger for updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_payout_profiles_updated_at
    BEFORE UPDATE ON public.payout_profiles
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
