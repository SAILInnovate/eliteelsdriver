# ELS Driver App

> **If you have just inherited this codebase, read the full continuity manual first:**
> **`HANDOVER.md` in the `SAILInnovate/els-elite` repository.** It covers accounts, deployment,
> the data model, and known issues across the whole platform.

## What this repo is

Despite the GitHub repo being named **`clinch`** (a legacy project codename), this is the
**ELS Elite driver app** — the app chauffeurs use to accept jobs, navigate, and complete rides.

React 19 + Vite 7 + Supabase, wrapped with Capacitor 8 for **iOS and Android**.
App ID: `com.eliteels.driver`.

It is one of three repositories:

| Repo | Purpose |
|---|---|
| `SAILInnovate/els-elite` | Passenger app + PA/Ops app + **all authoritative edge functions** |
| `SAILInnovate/clinch` | **This repo** — driver app |
| `SAILInnovate/eliteels-website` | Marketing website |

All three share **one Supabase project**.

## ⚠ Do not deploy edge functions from this repo

This repo contains a `supabase/functions/` directory. **It is stale** (May 2026) and has
**diverged** from the authoritative copies in `els-elite` (July 2026). Six functions differ,
including payment code — the copy of `charge-ride` here is missing an authorization check that
exists in the live version.

**Always deploy edge functions from `els-elite`.** The directory here should be deleted.

## Running locally

```bash
npm install
npm run dev
```

Create a `.env` from `.env.example`:

```
VITE_SUPABASE_URL=https://<project>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon key>
```

## Building for release

```bash
npm run build          # web assets → dist/

npx cap sync ios
npx cap open ios       # Xcode → Archive → Distribute

npx cap sync android
npx cap open android   # Build → Generate Signed Bundle
```

> The Android signing keystore is **unrecoverable if lost** — the app could never be updated
> again. Confirm its backup location before your first release. See `HANDOVER.md` Section 3.

## Layout

```
src/
  components/   DriverApp, RideApp, chat, tabs, drawers
  pages/        Dashboard, Onboarding, Settings, legal pages
  lib/          supabase client, ridePricing.js, londonZones.js
  hooks/        location tracking, push notifications
  content/      driver NDA, client conduct text
  i18n/         translations
```

**Note:** `src/lib/ridePricing.js` is a *separate* pricing implementation from the one in
`els-elite/src/lib/rateCard.js`. If a commercial rate changes, check whether both need updating.

## Known issues

See `HANDOVER.md` Section 9. Most urgent in this repo: gift card redemption in
`src/components/DrawerViews.jsx:550` runs entirely client-side and lets any logged-in user set
their own credit balance.
