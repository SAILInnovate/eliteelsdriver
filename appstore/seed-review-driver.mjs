#!/usr/bin/env node
/**
 * Seeds the App Review test driver.
 *
 * Apple rejected the TestFlight build under Guideline 2.1(a) because sign-in is
 * a phone number and an SMS code, and a reviewer cannot receive a UK SMS. The
 * fix is a Supabase test phone number with a fixed code — but a reviewer who
 * signs in to a bare account lands in onboarding, which demands a driving
 * licence upload they cannot produce. So the account has to arrive already on
 * the roster, with a job dispatched to it.
 *
 * This script puts it there: driver profile, NDA acceptance, documents on file,
 * and one dispatched job for tomorrow morning.
 *
 * Run it AFTER the test number has signed in once (that first sign-in is what
 * creates the auth user):
 *
 *   SUPABASE_SERVICE_ROLE_KEY=... node appstore/seed-review-driver.mjs +447700900123
 *
 * The service role key is read from the environment and never written anywhere.
 * Get it from Supabase → Project Settings → API. Pass --dry to see the plan
 * without writing.
 *
 * The repo holds two different `rides` definitions (els_platform_schema.sql and
 * full_database_setup.sql), so rather than guess, the script asks PostgREST for
 * the live table shape and sends only columns that actually exist.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const NDA_VERSION = '2026-07';   // keep in sync with src/content/driverNda.js
const HERE = path.dirname(fileURLToPath(import.meta.url));

const phone = process.argv.find(a => a.startsWith('+'));
const dryRun = process.argv.includes('--dry');
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!phone) die('Pass the test phone number in full international form, e.g. +447700900123');
if (!key) die('Set SUPABASE_SERVICE_ROLE_KEY (Supabase → Project Settings → API → service_role)');

const env = fs.readFileSync(path.join(HERE, '..', '.env'), 'utf8');
const url = env.match(/VITE_SUPABASE_URL=(.*)/)?.[1].trim();
if (!url) die('No VITE_SUPABASE_URL in .env');

const headers = {
  apikey: key,
  Authorization: `Bearer ${key}`,
  'Content-Type': 'application/json'
};

function die(msg) { console.error(`\n  ${msg}\n`); process.exit(1); }

async function api(pathname, init = {}) {
  const res = await fetch(`${url}${pathname}`, { ...init, headers: { ...headers, ...init.headers } });
  const text = await res.text();
  if (!res.ok) throw new Error(`${init.method || 'GET'} ${pathname} → ${res.status}\n${text}`);
  return text ? JSON.parse(text) : null;
}

/** Columns PostgREST reports for a table, so we never send one that isn't there. */
async function columnsOf(schema, table) {
  return Object.keys(schema.definitions?.[table]?.properties ?? {});
}

/** Drop any key the live table doesn't have, and say which were dropped. */
function fit(row, cols, label) {
  const kept = {}, dropped = [];
  for (const [k, v] of Object.entries(row)) (cols.includes(k) ? (kept[k] = v) : dropped.push(k));
  if (dropped.length) console.log(`     (${label}: no such column, skipped — ${dropped.join(', ')})`);
  return kept;
}

async function upsert(table, row, onConflict) {
  if (dryRun) { console.log(`     would upsert into ${table}:`, JSON.stringify(row)); return null; }
  const q = onConflict ? `?on_conflict=${onConflict}` : '';
  return api(`/rest/v1/${table}${q}`, {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify(row)
  });
}

const schema = await api('/rest/v1/', { headers: { Accept: 'application/openapi+json' } })
  .catch(e => die(
    /401/.test(e.message)
      ? 'That key was rejected. This needs the service_role key, not the anon key.'
      : e.message
  ));

// --- the auth user -------------------------------------------------------
// Admin API, not PostgREST: auth.users is not exposed over REST.
const search = new URLSearchParams({ page: '1', per_page: '200' });
const { users } = await api(`/auth/v1/admin/users?${search}`);
const user = users.find(u => u.phone === phone.replace('+', '') || u.phone === phone);

if (!user) die(
  `No auth user for ${phone}.\n` +
  `  Add it first: Supabase → Authentication → Sign In / Providers → Phone →\n` +
  `  Test phone numbers, then sign in once in the app with that number and code.`
);

console.log(`\n  Seeding ${phone}`);
console.log(`  auth user ${user.id}\n`);

const fullName = 'App Review Driver';

// The app checks user_metadata.full_name before it will leave onboarding.
if (!dryRun) {
  await api(`/auth/v1/admin/users/${user.id}`, {
    method: 'PUT',
    body: JSON.stringify({ user_metadata: { ...user.user_metadata, full_name: fullName } })
  });
}
console.log('  ✓ display name');

// --- roster rows ---------------------------------------------------------
const profileCols = await columnsOf(schema, 'driver_profiles');
await upsert('driver_profiles', fit({
  user_id: user.id,
  full_name: fullName,
  phone,
  status: 'approved',          // service role bypasses the column-protect trigger
  owns_vehicle: true,
  vehicle_reg: 'AR26 REV',
  vehicle_make_model: 'Mercedes-Benz V-Class',
  vehicle_colour: 'Obsidian Black',
  approved_at: new Date().toISOString(),
  admin_notes: 'App Review test account — not a real driver. Safe to delete after review.'
}, profileCols, 'driver_profiles'), 'user_id');
console.log('  ✓ driver profile, approved');

const ndaCols = await columnsOf(schema, 'driver_nda_acceptances');
await upsert('driver_nda_acceptances', fit({
  user_id: user.id,
  nda_version: NDA_VERSION,
  full_name: fullName,
  signed_name: fullName,
  phone,
  user_agent: 'seed-review-driver.mjs'
}, ndaCols, 'driver_nda_acceptances'), 'user_id,nda_version');
console.log(`  ✓ NDA acceptance, version ${NDA_VERSION}`);

const docCols = await columnsOf(schema, 'driver_documents');
for (const doc_type of ['driving_licence', 'pco_licence', 'dvla_check_code', 'proof_of_id', 'profile_photo']) {
  await upsert('driver_documents', fit({
    driver_id: user.id,
    doc_type,
    file_url: null,
    verified: true
  }, docCols, 'driver_documents'), 'driver_id,doc_type');
}
console.log('  ✓ documents marked on file');

// --- one dispatched job --------------------------------------------------
// Tomorrow 09:30 local, so the reviewer sees a job whatever day they open it.
const when = new Date();
when.setDate(when.getDate() + 1);
when.setHours(9, 30, 0, 0);

const rideCols = await columnsOf(schema, 'rides');
const existing = await api(`/rest/v1/rides?driver_id=eq.${user.id}&status=eq.dispatched&select=id&limit=1`);

if (existing?.length) {
  console.log(`  · job already dispatched (${existing[0].id}), left alone`);
} else {
  const ride = fit({
    driver_id: user.id,
    status: 'dispatched',
    booking_reference: 'ELS-REVIEW-01',
    passenger_name: 'Mr A. Reviewer',
    client_name: 'Mr A. Reviewer',
    pickup_address: 'The Lowry Hotel, 50 Dearmans Place, Salford M3 5LH',
    dropoff_address: 'Manchester Airport Terminal 2, Manchester M90 4QX',
    scheduled_at: when.toISOString(),
    service_type: 'airport',
    vehicle_reg: 'AR26 REV',
    metadata: {
      guest_brief: {
        door: 'both',            // opened at pickup and drop-off
        temperature: 21,
        music: 'silence',
        conversation: 'quiet'
      },
      note: 'App Review test booking — not a real passenger.'
    }
  }, rideCols, 'rides');

  await upsert('rides', ride);
  console.log('  ✓ job dispatched for tomorrow 09:30');
}

console.log(`
  Done.${dryRun ? ' (dry run — nothing written)' : ''}

  Next:
    1. TestFlight → Test Information → Beta App Review Information
       Tick "Sign-in required", enter ${phone} and the fixed code.
    2. Reply to Apple's message in App Store Connect.

  After review, delete this account: the auth user, its driver_profiles row,
  and the ELS-REVIEW-01 job.
`);
