# Fixing the Guideline 2.1(a) rejection

Submission `e68130cf-f9b4-4e88-b628-3ed23500749d`, rejected 7 Sep 2026.

This is a **TestFlight beta** rejection, not an App Store one, and 2.1(a) is
"information needed" — Apple has paused the review, not failed the build.
**No new build is required.** Give them a working sign-in, reply to the
message, and the same build resumes review.

Two things have to be true before you reply, and the second is the one that is
easy to miss.

---

## 1. A phone number that signs in without an SMS

The app authenticates with a phone number and a one-time SMS code. The reviewer
is in California and cannot receive a UK SMS, which is why they could not get
in. Supabase can hand out a fixed code for a specific number, with no SMS sent
at all.

**Supabase → Authentication → Sign In / Providers → Phone → Test phone numbers**

The field takes `<phone>=<otp>` pairs, comma separated, with the **plus sign
stripped** — its own example, `18005550123=789012`, is a US number in E.164
without the `+`. So the value is:

    447700900123=123456

The app still sends `+447700900123` when signing in; Supabase normalises, so the
plus in the app and the missing plus in this field are both right.

`07700 900xxx` is Ofcom's reserved test range — it can never be issued to a real
person, so this can never collide with an actual driver.

Then sign in once on your own device with that number and code. That first
sign-in is what creates the `auth.users` row; nothing else can.

## 2. An account that is already on the roster

This is the part that would fail a second review if you skipped it.

A driver who signs in to a fresh account does not reach the app. They land in
onboarding, which requires a name, vehicle details, **a photograph of a DVLA
driving licence**, and a signed NDA before it will let go. A reviewer has no
driving licence to upload, so they would get stuck one screen further in and
reject it again — this time for a reason that reads like a bug.

The account has to arrive past all of that, with a job waiting:

```bash
SUPABASE_SERVICE_ROLE_KEY=... node appstore/seed-review-driver.mjs +447700900123
```

Get the key from Supabase → Project Settings → API → `service_role`. Add `--dry`
first if you want to see what it will write without writing it.

It sets the display name, marks the driver profile approved, records the NDA
acceptance at version `2026-07`, marks the five documents on file, and dispatches
one airport job for tomorrow morning with a guest brief attached — so the
reviewer sees the pre-shift check, the brief, and the journey controls rather
than an empty "waiting for dispatch" screen.

The script asks PostgREST for the live table shape before it writes, because
the repo carries two different `rides` definitions and only the database knows
which one is real.

### Check it yourself first

Sign in as `+447700900123` on a device and walk it through: registration →
walk-around video → Go Online → the job appears. If it works for you it will
work for them. If the job does not appear, the likely cause is the `status`
value — the app looks for `pending`, `scheduled`, `dispatched`, `en_route`,
`arrived` or `in_progress`.

---

## 3. Fill in Beta App Review Information

Apple's message names the exact place, and it is **not** the App Store version
page you filled in earlier:

**TestFlight → Test Information → Beta App Review Information**

- Tick **Sign-in required**
- **User Name** — `+447700900123`
- **Password** — `123456`
- Save

Put the same values in **Distribution → App Review Information** as well, so the
1.0 App Store submission does not hit the identical wall.

---

## 4. Reply to Apple

> Thank you for the review.
>
> ELS Elite Driver signs in with a phone number and a one-time SMS code, which is why the app could not be accessed — a code could not be delivered to a reviewer's device.
>
> We have provisioned a test number that returns a fixed code, so no SMS is sent and no phone is needed. The credentials are now in Beta App Review Information:
>
> User Name: +447700900123
> Password: 123456
>
> Enter the number on the first screen and tap Continue, then enter the code on the next screen. Please select the United Kingdom (+44) country flag if the field defaults elsewhere.
>
> This account is an approved chauffeur on our roster with a job already dispatched to it, so the full functionality is available: the pre-shift vehicle check, the dispatched job with its guest brief, the live journey stages (On Location, Passenger On Board, Complete), in-app messaging with our operations team, shift hours and expenses.
>
> One note on permissions: the app requests Always location. It is used only while a chauffeur is on shift, so that the passenger who booked the car can follow it on a live tracking link and our operations team can dispatch the nearest vehicle. Location collection stops entirely when the driver ends their shift.
>
> Please let us know if anything else is needed and we will respond the same day.

Replace the number and code if you used different ones.

---

## Afterwards

Delete the test account once 1.0 is approved: the `auth.users` row, its
`driver_profiles` row, and the `ELS-REVIEW-01` job. Leave the Supabase test
number in place — every future submission will need it.

Worth knowing: Apple re-reviews a beta build when the binary changes, so the
next build will face this again. The seeded account and the test number both
persist, so it should pass on the credentials already on file.
