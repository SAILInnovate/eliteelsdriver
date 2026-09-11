# ELS Driver App

> **If you have just inherited this codebase, read the full continuity manual first:**
> **`HANDOVER.md` in the `SAILInnovate/els-elite` repository.** It covers accounts, deployment,
> the data model, and known issues across the whole platform.

## What this repo is

Despite the GitHub repo being named **`clinch`** (a legacy project codename), this is the
**ELS Elite driver app** — the app chauffeurs use to accept jobs, navigate, and complete rides.

React 19 + Vite 7 + Supabase, wrapped with Capacitor 8 for **iOS and Android**.
App ID: `com.els-elite.driver` on iOS (Apple team `KL5W5JNP42`, the company account —
the APNs auth key that serves both apps is issued under it), `com.eliteels.driver` on
Android (hyphens are not valid in an Android `applicationId`, so the iOS id cannot be
reused there).

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

This is a single, coherent driver app — the legacy "clinch" UI (DriverApp, RideApp,
Dashboard, tabs/drawers pages, gift-card drawer) has been removed. Shipped code only:

```
src/
  pages/        PlayerPortal (main), OnboardingPage, CompleteProfilePage
  components/   PlayerPortal helpers: JourneyControls, GuestBrief, FlightStatusCard,
                DriverProfileDrawer, CallOverlay, RideChat, OpsChat, SafetyNet
  lib/          supabase client, journey, rideCall, londonZones, capacitor, keyboard
  hooks/        location / background-location / push notifications
  content/      driver NDA, client conduct text
  i18n/         translations (en, de, es, fr, ar, ur)
```

**Rate pricing** lives in the authoritative `els-elite` repo (`src/lib/rateCard.js`).
Do not re-introduce a second pricing implementation here.

## Known issues

See `HANDOVER.md` Section 9. The former client-side gift-card redemption in
`src/components/DrawerViews.jsx` **has been removed** along with the rest of the legacy
"clinch" UI, so that credit-balance self-serve vector is no longer present in this repo.
It may still exist in the passenger app (`els-elite`) — verify there.
