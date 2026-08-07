import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function check() {
  // Query driver_shifts to get the latest driver_id
  const { data: shifts, error: shiftsErr } = await supabase.from('driver_shifts').select('driver_id').order('started_at', { ascending: false }).limit(1);
  if (shiftsErr) {
    console.error("Error fetching shifts:", shiftsErr);
    return;
  }
  
  if (!shifts || shifts.length === 0) {
    console.log("No driver shifts found.");
    return;
  }
  
  const driverId = shifts[0].driver_id;
  console.log("Latest driver_id in driver_shifts:", driverId);
  
  // Try to query global_users for this driverId (note: anon key might be blocked by RLS, but we can try)
  const { data: users, error: usersErr } = await supabase.from('global_users').select('id, role').eq('id', driverId);
  console.log("Global users lookup:", users, "Error:", usersErr);
}
check();
