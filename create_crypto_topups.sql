-- =============================================
-- CRYPTO TOP-UPS — tracking table
-- Run in Supabase SQL Editor
-- =============================================

CREATE TABLE IF NOT EXISTS crypto_topups (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id),
  order_id TEXT NOT NULL UNIQUE,
  nowpayments_invoice_id TEXT,
  nowpayments_payment_id TEXT,
  amount_gbp DECIMAL(10,2) NOT NULL,
  pay_currency TEXT,         -- BTC, ETH, USDT, etc.
  pay_amount DECIMAL(18,8),  -- Amount in crypto
  status TEXT NOT NULL DEFAULT 'waiting',
  credited BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_crypto_topups_user ON crypto_topups(user_id);
CREATE INDEX IF NOT EXISTS idx_crypto_topups_order ON crypto_topups(order_id);

ALTER TABLE crypto_topups ENABLE ROW LEVEL SECURITY;

-- Users can see their own top-ups
CREATE POLICY "Users can read own topups"
  ON crypto_topups FOR SELECT
  USING (user_id = auth.uid());
