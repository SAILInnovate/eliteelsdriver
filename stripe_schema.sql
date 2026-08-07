-- 1. Create a secure secure table to track subscriptions
-- We do not attach this to auth.users as we need strict Row Level Security (RLS)
CREATE TABLE public.user_subscriptions (
    user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    tier TEXT NOT NULL DEFAULT 'free' CHECK (tier IN ('free', 'pro')),
    stripe_customer_id TEXT UNIQUE,
    stripe_subscription_id TEXT UNIQUE,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 2. Enable Row Level Security (CRITICAL FOR SECURITY)
ALTER TABLE public.user_subscriptions ENABLE ROW LEVEL SECURITY;

-- 3. Create RLS Policies
-- Users can READ their own subscription tier (so the React app knows if they are Pro)
CREATE POLICY "Users can view own subscription" 
ON public.user_subscriptions FOR SELECT 
TO authenticated
USING (auth.uid() = user_id);

-- EXTREMELY IMPORTANT:
-- Notice there are NO 'INSERT', 'UPDATE', or 'DELETE' policies created for 'authenticated' users.
-- This guarantees that a user CANNOT hack their client (e.g. changing local JS) to maliciously upgrade themselves.
-- Only Supabase's secure backend (via Service Role Key inside the Edge Function) can update this table!

-- 4. Create an automatic trigger to insert a 'free' row when a new user signs up
CREATE OR REPLACE FUNCTION public.handle_new_user_subscription()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO public.user_subscriptions (user_id, tier)
  VALUES (new.id, 'free');
  RETURN new;
END;
$$;

-- Attach trigger to auth.users
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user_subscription();
