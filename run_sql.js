import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY; 

const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
    // Note: Cannot easily run ALTER TABLE from client with anon key.
    // I will write this to test the existence of the column instead
    console.log("Supabase URL loaded:", supabaseUrl);
}

run();
