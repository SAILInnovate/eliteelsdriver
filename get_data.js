import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY);

async function run() {
  const { data, error } = await supabase.from('clinches').select('id, sender_id, sender_name, sender_phone, recipient_phone, agreed_by, status');
  console.log(JSON.stringify(data, null, 2));
}
run();
