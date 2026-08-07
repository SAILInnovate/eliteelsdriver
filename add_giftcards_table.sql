CREATE TABLE IF NOT EXISTS gift_cards (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code TEXT UNIQUE NOT NULL,
  value DECIMAL(10, 2) NOT NULL,
  status TEXT DEFAULT 'active', -- 'active', 'redeemed'
  redeemed_by UUID REFERENCES auth.users(id),
  redeemed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Turn on RLS
ALTER TABLE gift_cards ENABLE ROW LEVEL SECURITY;

-- Allow anyone to read a code to redeem it (or you can restrict to authenticated)
CREATE POLICY "Anyone can read gift cards" ON gift_cards FOR SELECT USING (true);
CREATE POLICY "Authenticated users can insert gift cards" ON gift_cards FOR INSERT WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "Authenticated users can update gift cards (redeem)" ON gift_cards FOR UPDATE USING (auth.role() = 'authenticated');
