# App Store Connect — ELS Elite Driver, iOS 1.0

Apple ID 6809052667 · ELS ELITE LTD · English (U.K.)

Everything below is ready to paste into the version page. Fields marked
**[you]** need something only you have.

---

## Promotional Text — 170 max

> Dispatch, guest briefs, live routing, shift hours and expenses — the working app for chauffeurs on the ELS Elite roster.

120 characters. Editable without a new build, so this is the field to change
when something is worth announcing.

---

## Description — 4,000 max

> ELS Elite Driver is the working app for chauffeurs on the ELS Elite roster. It is issued to vetted drivers by ELS ELITE LTD and is not open to the public — you cannot create an account or take work through it unless the office has put you on the roster.
>
> Everything a chauffeur does across a shift happens here: clocking on, the vehicle check, the job itself, and the paperwork at the end of it.
>
> START AND END OF SHIFT
> Record the registration of the car you are in, film a walk-around of its condition, flag fuel or a fault, and go online. Ending a shift takes a second walk-around and any closing notes, so the car is documented at both ends of the day.
>
> THE JOB
> Dispatch comes straight to your phone. Each job carries the pickup, the drop-off, the timings and the guest brief — how the guest likes the door handled, the cabin temperature, the music, and whether conversation is welcome. Airport pickups show live flight status, so you know before you set off whether the aircraft is early or held.
>
> ON THE ROAD
> The route is drawn on the map with the next manoeuvre in front of you. Move the job through its stages with a tap each — On Location, Passenger On Board, Complete. The office and the guest see each stage as it happens, so nobody has to ring to ask where you are.
>
> TALKING TO THE OFFICE
> Message Operations from inside the app, or the guest directly, without either of you handing over a personal number.
>
> HOURS AND EXPENSES
> Every shift is logged with clock-in, clock-out and duration, and you can correct your own hours with a note if something was recorded wrong. Add parking, tolls, the congestion charge, ULEZ, waiting time or cleaning to a job as you incur it, and it reaches the office with the booking rather than as a receipt in a glovebox.
>
> DOCUMENTS
> Keep your DVLA driving licence, PCO / private hire licence, DVLA check code, proof of identity and profile photograph on file, and see at a glance what is still outstanding.
>
> LOCATION
> While you are on shift, ELS Elite Driver shares your location so Operations can dispatch to you and your guest can follow the car. It continues in the background so the guest does not lose sight of you when the app is not on screen. Nothing is shared while you are offline.
>
> LANGUAGES
> English, French, German, Spanish and Arabic.
>
> ELS Elite Driver requires an ELS Elite chauffeur account. To join the roster, contact ELS ELITE LTD.

Roughly 2,400 characters. Only the first ~3 lines show before "more", which is
why the restriction is stated first — it heads off the "I downloaded it and
couldn't sign up" one-star review.

---

## Keywords — 100 max

    chauffeur,shift,dispatch,private hire,PCO,limousine,executive,fleet,logbook,airport,rota,expenses

97 characters. No spaces after the commas — a space costs a character.
"ELS", "Elite" and "Driver" are deliberately absent: Apple already indexes the
app name, so repeating them wastes the field.

---

## Support URL — **[you]**, and it is not ready

Apple requires a page that a user can actually get help from, and it checks.
`els-elite.co.uk` is currently a one-page site: `/support`, `/contact`,
`/privacy` and `/drivers` all return 404.

Publish something at:

    https://els-elite.co.uk/driver-support

One page is enough — who the app is for, a contact email, a phone number, and
office hours. A dead or irrelevant Support URL is a routine rejection.

## Marketing URL — optional

    https://els-elite.co.uk

## Version

    1.0

## Copyright — 200 max

    2026 ELS ELITE LTD

Year first, no "©" — Apple adds it.

## Routing App Coverage File

Leave empty. That field is for apps that hand routing to Maps; this is not one.

---

## App Review Information

### Sign-In Information

**Tick "Sign-in required".** This is the field that decides whether 1.0 gets
reviewed or rejected, because the app signs in with a phone number and an SMS
code and **a reviewer in Cupertino cannot receive a UK SMS.**

> This is no longer hypothetical: the TestFlight build was rejected under
> Guideline 2.1(a) on 7 Sep 2026 for exactly this. See
> [review-rejection-2.1a.md](review-rejection-2.1a.md) for the fix and the
> reply to Apple. Use the same credentials in both places.

Before submitting, set up a test number in Supabase:

Authentication → Providers → Phone → **Test OTP** — add a number and a fixed
code, e.g. `+447700900123` / `123456`. `07700 900xxx` is Ofcom's reserved
drama/test range, so it can never collide with a real driver.

Then, in Supabase, put that test user on the roster the way a real driver is:
a `driver_profiles` row, an accepted `driver_nda_acceptances` row for the
current NDA version, and at least one dispatched job so the reviewer sees the
guest brief and the journey controls rather than an empty "waiting for
dispatch" screen.

Fill the two fields with:

- **User Name** — the test phone number in full international form
- **Password** — the fixed six-digit code

**[you]** — create these in Supabase and type them into App Store Connect
yourself. I have deliberately not put real values in this file.

### Contact Information — **[you]**

First name, last name, phone and email of whoever can answer Apple within 24
hours. Usman Hussain, with a number that will be picked up.

### Notes — 4,000 max

> ELS Elite Driver is an employee/contractor app for ELS ELITE LTD, a licensed private hire and executive chauffeur operator. It is issued to chauffeurs on our roster. There is no public sign-up: an account only exists once our operations team has vetted the driver, checked their DVLA and private hire licences, and added them.
>
> HOW TO SIGN IN
> Sign-in is by phone number and a one-time SMS code. We have provisioned a test number for review, so no SMS is sent and no live phone is needed:
>
> Phone number: [test number]
> Code: [six-digit code]
>
> Enter the number, tap Continue, then enter the code on the next screen. This account is on our roster with a job already dispatched to it, so the full journey flow is available.
>
> WHAT TO EXPECT
> 1. Pre-shift check — enter a vehicle registration, record a short walk-around video of the car, then Go Online.
> 2. A dispatched job appears with the pickup, drop-off, timings and the guest brief.
> 3. The journey moves through On Location, Passenger On Board and Complete, one tap each.
> 4. My Shifts shows logged hours; expenses can be added to a job.
>
> BACKGROUND LOCATION (UIBackgroundModes: location)
> The app uses background location for a single purpose: while a chauffeur is on shift, the passenger who booked the car follows its progress on a live tracking link, and our operations team dispatches the nearest available car. Location is collected only between Go Online and End Shift, and stops entirely when the driver goes offline. With "While Using the App" the passenger loses sight of the car the moment the driver switches to navigation or takes a call, which is why "Always" is requested.
>
> CAMERA AND MICROPHONE
> Used for the vehicle walk-around recording at the start and end of each shift, which is how vehicle damage is evidenced between drivers.
>
> There are no in-app purchases and no subscriptions. If anything is unclear, please contact us before rejecting — we will respond same day.

Replace the two bracketed values with the real test credentials.

---

## App Store Version Release

**Manually release this version.** The driver app is worthless to a chauffeur
until the passenger app and Operations are live behind it, so keep the button
in your hand rather than letting an approval at 3am put it out on its own.

---

## Screenshots

`out/6.7in/*.png` — six frames, 1284×2778. Drag all six into the 6.5" slot;
Apple scales them for the other sizes. `out/6.5in` (1242×2688) is there if you
would rather upload the exact size. Only the first three appear on the install
sheet, so the order matters: opener, start of shift, guest brief.

Frames 2–5 are still placeholders until real screens are dropped into
`shots/` — see README.md.

---

## Not on this page, but 1.0 will not submit without them

- **App Information → Privacy Policy URL** — required, and there is no privacy
  policy at any URL right now. It must cover background location, the
  walk-around video and the identity documents.
- **App Privacy** — declare Location (precise, app functionality, linked to the
  user), Contact Info (phone), User Content (photos/video), Identifiers, and
  **Analytics — the app initialises PostHog**, which is easy to forget and is a
  common cause of a "your privacy answers are inaccurate" rejection.
- **Age Rating** and **Pricing and Availability** (Free; consider limiting
  availability to the UK).

## Worth considering instead

Apple sometimes pushes back on a public listing for an app nobody outside one
company can use (Guideline 4.2 / 3.2). **Unlisted App Distribution** fits this
app exactly: the app ships through the App Store, drivers install it from a
direct link, and it never appears in search or charts. You request it at
developer.apple.com once the build is approved. It removes the "why is this in
the store" argument entirely, and drivers get it from a link you text them,
which is how they will get it anyway.
