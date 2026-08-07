import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  'https://mojiieykecrmyyoyapxl.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1vamlpZXlrZWNybXl5b3lhcHhsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc0NjcyNDMsImV4cCI6MjA5MzA0MzI0M30.7cU8G_8oLmacc1S4qREJq7tk-bkdH3yZIgxB0ksLGY8'
);

const tables = [
  'global_users',
  'corporate_accounts', 
  'passenger_profiles',
  'driver_businesses',
  'drivers',
  'vehicles',
  'rate_cards',
  'rides',
  'vehicle_audits',
  'invoices'
];

async function verify() {
  console.log('\n🔍 ELS Schema Verification\n');
  
  for (const table of tables) {
    const { data, error } = await supabase.from(table).select('*').limit(0);
    if (error) {
      console.log(`  ❌  ${table.padEnd(22)} — ${error.message}`);
    } else {
      console.log(`  ✅  ${table}`);
    }
  }
  
  console.log('\nDone.\n');
}

verify();
