import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function checkRides() {
  const { data: rides, error } = await supabase.from('rides').select('*').order('created_at', { ascending: false }).limit(5);
  console.log("Latest rides:", JSON.stringify(rides, null, 2));
  if (error) console.error(error);
}
checkRides();
