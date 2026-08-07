import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
  const { data: { session }, error: authErr } = await supabase.auth.signInWithPassword({
    email: 'test@eliteels.app', // Assuming we can't do this, wait, we don't know a password!
  });
}
run();
