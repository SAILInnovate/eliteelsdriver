-- Add card detail columns to passenger_profiles
-- Run this in Supabase SQL Editor

ALTER TABLE passenger_profiles 
  ADD COLUMN IF NOT EXISTS card_brand TEXT,
  ADD COLUMN IF NOT EXISTS card_last4 TEXT,
  ADD COLUMN IF NOT EXISTS default_payment_method_id TEXT;

COMMENT ON COLUMN passenger_profiles.card_brand IS 'Stripe card brand: visa, mastercard, amex, etc.';
COMMENT ON COLUMN passenger_profiles.card_last4 IS 'Last 4 digits of saved card for display';
COMMENT ON COLUMN passenger_profiles.default_payment_method_id IS 'Stripe PaymentMethod ID for off-session charges';
