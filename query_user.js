import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

if (!process.env.VITE_SUPABASE_URL) {
  console.error("Missing SUPABASE env vars.");
  process.exit(1);
}

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY)

async function test() {
  const { data, error } = await supabase
    .from('clinches')
    .select('recipient_phone, sender_phone, agreed_by, sender_id')
    .limit(5)
  console.log('clinches data:', data, error)
}
test()
