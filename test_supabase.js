// test_supabase.js
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl) {
  console.error("Missing SUPABASE env vars.");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
  const cleanPhone = '447368995149'; // See in the image

  const res1 = await supabase.from('clinches').select('id, recipient_phone, terms').or(`recipient_phone.eq.%2B${cleanPhone},recipient_phone.eq.${cleanPhone}`);
  console.log('Result %2B:', res1.data?.length, res1.error);

  const res2 = await supabase.from('clinches').select('id, recipient_phone, terms').or(`recipient_phone.eq.+${cleanPhone},recipient_phone.eq.${cleanPhone}`);
  console.log('Result raw +:', res2.data?.length, res2.error);

  const res3 = await supabase.from('clinches').select('id, recipient_phone, terms').in('recipient_phone', [cleanPhone, `+${cleanPhone}`]);
  console.log('Result .in:', res3.data?.length, res3.error);
}

run();
