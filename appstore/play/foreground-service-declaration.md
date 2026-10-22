# Passing the Play foreground service review

Rejection received 2 October 2026, version code 2.

> We are unable to approve your app's use of FOREGROUND_SERVICE permission
> because we found the following information provided to be insufficient…
> - The video link you provided in the Play Console declaration and/or
> - The app description in the Google Play store.

**Read that as a paperwork rejection, not a technical one.** Google is not
saying the app may not use a foreground service. They are saying the submission
did not *demonstrate* why it needs one. Nothing in `src/` or `android/` has to
change to fix it.

---

## Short answer: no, do not switch to background location

Three reasons, in order of how badly each would hurt.

### 1. It would make approval harder, not easier

`ACCESS_BACKGROUND_LOCATION` is the single most-rejected permission on Play. It
has its own declaration form, its own dedicated review, and a higher bar than
the foreground service one — Google's review team must independently verify the
feature ([background location permissions policy][bgpolicy]). The foreground
service declaration we are already in is the *lighter* of the two.

Worth noting the app already does the right thing here: it deliberately does
**not** request `ACCESS_BACKGROUND_LOCATION`, which is why the background
location declaration does not apply to us at all.

### 2. It is the inaccurate option — it would break the feature

This is the part that matters for "I need it to be accurate."

Since Android 8.0, a backgrounded app **without** a foreground service receives
location updates only a few times per hour, and Doze batches them further
([background location limits][limits]). The 10-metre `distanceFilter` in
`src/hooks/useBackgroundLocation.js` is only achievable *because* the foreground
service exempts us from those limits.

Take the service away and a passenger watching the live link sees the car jump
once every ~15 minutes. That is not a less accurate tracker, it is a broken one.

### 3. Android 14+ leaves no other option

An app targeting SDK 34+ that wants continuous location must run a foreground
service of type `location`. There is no continuous-location path that avoids it.
The manifest already declares exactly that, via the plugin:

```xml
<service
    android:name="…BackgroundGeolocationService"
    android:foregroundServiceType="location" />
```

**Keep the foreground service. Fix the demonstration.**

---

## Fix 1 — the declaration video (this is the actual failure)

The video is what Google reviews against. It must show the feature, the
notification, and the dependency — not a tour of the app.

### Rules

- Unlisted YouTube link, **ads off**, no age restriction. The Console video
  field rejects anything else.
- 60–120 seconds. Screen recording plus the notification shade. No music, no
  voiceover needed — but if you narrate, narrate *why*, not *what*.
- Do it on a **real phone**, not the emulator. Google is checking that this is a
  shipping feature, and an emulator's location simulation is visible in the
  status bar.
- Use the test account from Fix 2, so the reviewer sees the same thing you did.

### Shot list

| # | Shot | Why it is in the video |
|---|---|---|
| 1 | Sign in as `+44 7700 900123`, code `123456` | Proves the credentials in App Access work |
| 2 | Home screen, tap **Go Online** | The user-initiated action that starts the service — policy requires the service be user-started |
| 3 | Location permission dialog, tap **While using the app**, then **Allow** | Shows the permission is requested in context, not at launch |
| 4 | **Pull down the notification shade.** Hold 4s. Notification reads *On Shift — ELS Driver* / *Sharing your location with your passenger.* | **The single most important shot.** The notification *is* the foreground service made visible to the user |
| 5 | Back in the app: the amber *"Sharing your location."* banner and the driver marker on the map | The feature's in-app surface |
| 6 | **Press Home.** App goes to background. Notification is still in the shade | Proves it is a foreground service and not just in-app location |
| 7 | On a **second device or a laptop**, open the passenger live tracking link. Show the car moving | **The money shot.** This is the core functionality that *depends* on the service — the passenger follows the car while the driver's app is closed |
| 8 | Optionally repeat 7 with the screen locked | Shows it survives the screen going off |
| 9 | Return to the app, tap **End Shift** | |
| 10 | **Notification disappears.** Close on the shade, empty | Policy requires the user be able to stop it. Show, don't claim |

Deliver `+447700900123 / 123456` on screen as text at the top of the recording,
and keep the full walkthrough unedited — a jump-cut through the background step
is exactly the thing that gets a video rejected a second time.

### Declaration free-text

For the Console field asking why the app needs the permission:

> ELS Elite Driver is a chauffeur dispatch app used only by drivers on the ELS
> ELITE LTD roster. A driver starts work by tapping **Go Online**; from that
> moment until they tap **End Shift**, the app runs a foreground service of type
> `location` with a permanent notification reading "On Shift — ELS Driver".
>
> The service exists so two user-facing features work while the app is not on
> screen:
>
> 1. **The passenger's live tracking link.** A guest who has booked a car opens a
>    link and watches it approach. This is the feature the passenger is paying
>    for, and it necessarily runs while the driver's phone is in a cradle with
>    the screen off.
> 2. **Operations dispatch.** Our office assigns the nearest available car, which
>    requires knowing where cars are between jobs.
>
> Neither can be deferred: a position that arrives fifteen minutes late does not
> tell a passenger where their car is. The service runs only between Go Online
> and End Shift, and the driver can stop it at any time by ending the shift — at
> which point the notification is removed and collection stops entirely. The app
> does not request `ACCESS_BACKGROUND_LOCATION` and collects nothing outside a
> shift.
>
> The attached video shows the shift starting, the notification, the passenger's
> live view updating while the driver's app is in the background, and the driver
> ending the shift.

---

## Fix 2 — testing credentials (the part that fails second reviews)

The email also asks you to *"Ensure valid testing credentials are provided."*
This is the same trap as the [iOS 2.1(a) rejection](../review-rejection-2.1a.md),
and it is the one most likely to waste another review cycle.

`useBackgroundLocation(shiftState === 'ONLINE', …)` — **the service only starts
when the driver is on shift.** If the reviewer signs in and lands in onboarding,
they never reach Go Online, never see the notification, and cannot verify
anything. That reads to them as a non-functional app.

So the test account must already be past onboarding. The script that does this
exists:

```bash
SUPABASE_SERVICE_ROLE_KEY=... node appstore/seed-review-driver.mjs +447700900123
```

Add `--dry` first to see the plan without writing. It needs the test number to
have signed in once already, because that first sign-in is what creates the
`auth.users` row.

Then verify by hand, on a device, signed in as the test account:

1. Does it land on the portal, not on `CompleteProfilePage`?
2. Can you tap **Go Online** without being asked for a licence photograph?
3. Does a job appear?
4. Does the notification appear, and does it survive pressing Home?

If any of those four fail for you, they fail for the reviewer.

In **Play Console → App content → App access**, give them the same thing you
gave Apple:

- Sign-in required: **yes**
- Username: `+44 7700 900123`
- Password: `123456`
- Notes: *Enter the number, tap Continue, then enter the code. Select the United
  Kingdom (+44) flag if the field defaults elsewhere. This account is an approved
  chauffeur with a job already dispatched, so the full shift flow — including the
  location foreground service — is reachable.*

---

## Fix 3 — the store description

The full description already carries a Location paragraph that does the right
job:

> While you are on shift, ELS Elite Driver shares your location so that
> Operations can dispatch to you and your guest can follow the car on a live
> tracking link. It runs as a foreground service with a permanent notification
> for as long as you are online, so the guest does not lose sight of the car when
> the app is off screen. Nothing is collected once you end your shift.

Two changes make it harder for a reviewer to miss:

1. **Confirm it is actually live.** The description has to be *published* before
   or with the review submission. If the store listing was submitted without the
   full description pasted in, that alone explains the second bullet of the
   rejection. `copy-full-description.txt` is the source of truth.

2. **Add one sentence to the opening paragraph**, because a reviewer reads the
   first paragraph and skims the rest:

   > Chauffeurs go online to start a shift, and from that moment the app shares
   > their location so Operations can dispatch to them and the booked guest can
   > follow the car on a live link.

Keep the sentence-case headings — Play's metadata policy enforces that on the
listing and it costs nothing.

---

## Submitting

Version code 2 is dead; it cannot be repaired. You need a new upload, and you
already have one: local `versionCode 3` / `versionName "3.0"` carries the R8
minification that clears the separate *"DEX code optimization below threshold —
Obfuscation (4%)"* warning on release 2.

So one submission fixes both findings:

1. Run the Fix 2 verification above; seed the account if needed.
2. Record the video from the shot list. Upload to YouTube as **unlisted**.
3. Fill in **App content → Foreground service permissions** with the free-text
   above and the video link.
4. Confirm the full description is pasted and published.
5. Build the signed AAB (`bundleRelease`) and upload as version code 3.
6. Send for review.

Do not submit an appeal. An appeal argues the original decision was wrong; the
declaration was genuinely thin, and an appeal costs up to seven days before you
can submit the fix anyway.

---

## Still outstanding, and separately blocking

- **App content → Privacy policy URL.** Mandatory. Must cover on-shift location,
  the walk-around video, and driver identity documents.
- **App content → Data safety.** Declare precise location (collected and shared,
  app functionality). Checked against actual behaviour.
- **Phone screenshots.** `out/02.png`–`05.png` are still placeholders. Only the
  two editorial cards are uploadable. A screenshot of the live-tracking screen
  would also reinforce the declaration.
- **Signing.** `android/app/build.gradle` still has no `signingConfig`, so
  `bundleRelease` produces an unsigned bundle.

Also worth reading the last section of
[README.md](README.md) — Managed Google Play or a closed track removes the
"why is this app public" question entirely for a roster-only chauffeur app.

[bgpolicy]: https://support.google.com/googleplay/android-developer/answer/9799150
[limits]: https://developer.android.com/about/versions/oreo/background-location-limits
