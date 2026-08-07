ALTER TABLE gift_cards ADD COLUMN IF NOT EXISTS purchased_by UUID REFERENCES auth.users(id);
