# Google Play Console — ELS Driver, Default store listing

`com.eliteels.driver` · ELS ELITE LTD · English (United Kingdom)

Everything on the **Store listings → Default store listing** page, ready to paste
or upload. Fields marked **[you]** need something only you have.

The App Store copy this is adapted from is in [../README.md](../README.md);
keep the two in step when either changes.

---

## App name — 30 max

    ELS Elite Driver

16 characters. The field currently reads `ELS Driver`.

Worth changing, for two reasons. It matches the iOS listing, so a driver
sent a link by the office finds the same name on both platforms. And Play
indexes the app name heavily, where "Elite" is the word an existing driver
would actually type.

The launcher label under the icon stays `ELS Driver`
([strings.xml](../../android/app/src/main/res/values/strings.xml)) and should:
the store name and the home-screen name are separate fields and short is
better under an icon.

## Short description — 80 max

    Shifts, dispatch, guest briefs and expenses, for ELS Elite chauffeurs only.

75 characters. Also in [copy-short-description.txt](copy-short-description.txt).

This is the line Play shows in search results and at the top of the listing
before anyone expands. The restriction is in it deliberately: anyone who finds
this app and installs it cannot sign in, and an app that cannot be signed into
collects one-star reviews from people who were never the audience.

## Full description — 4,000 max

Paste from [copy-full-description.txt](copy-full-description.txt). 2,491
characters.

Two things to know before you edit it:

- **Headings are in sentence case, not capitals.** The iOS description uses
  `START AND END OF SHIFT`. Play's metadata policy calls out capitalisation
  used for emphasis, and the store listing is the one surface it is enforced
  on. Sentence case costs nothing and avoids the argument.
- **The first paragraph states that sign-up is closed.** Same reasoning as the
  short description, and it is also the first thing a Play reviewer reads.

## App icon — 512x512, PNG or JPEG, 1MB max

    icon-512.png

Rendered from [resources/icon.png](../../resources/icon.png), the same 1024px
artwork the iOS and Android app icons are built from. 512x512, no alpha
channel, 154KB.

No transparency is deliberate. Play composites the icon onto its own
backgrounds and applies its own mask; a transparent ground renders
unpredictably across launcher themes, and Play rejects icons with alpha in
some flows. The mark sits well inside the safe circle, so the mask cannot
clip the wings.

## Feature graphic — 1024x500, PNG or JPEG, 15MB max

    feature.png

Built by [generate.sh](generate.sh) from [feature.html](feature.html). 667KB.

The type sits in the left third and the centre is kept clear, because Play
lays a play button across the middle of this graphic if you ever attach a
promo video.

## Video — leave empty

There is no promo video, and a bad one is worse than none. The field only
accepts a public or unlisted YouTube URL with ads off and no age restriction.

## Phone screenshots — 2 to 8, PNG or JPEG, 8MB each

    out/01.png  editorial opener
    out/06.png  invitation only

Both 1080x1920, which is 9:16 — Play's tallest allowed shape. **The App Store
exports cannot be reused**: `../out/6.5in` is 1242x2688 and `../out/6.7in` is
1284x2778, both 19.5:9, and Play will not accept a screenshot taller than 9:16.
[frames.html](../frames.html) carries a `@media (min-aspect-ratio: 1/2)` block
so the one layout renders correctly at both stores' shapes.

    ./generate.sh            # feature graphic + all six frames
    FRAMES="1 6" ./generate.sh

### Frames 2 to 5 are not ready

`out/02.png` through `out/05.png` render as striped placeholders reading
"drop shots/NN.png", exactly as they do for the App Store. **Do not upload
them.** Uploading two editorial cards and no screen of the app also invites
Play to ask whether the screenshots represent the app, so this is the one
thing on this page still genuinely outstanding.

Fix it the same way as for iOS — capture the four screens on a device signed
in as a seeded review driver and drop them into [../shots](../shots) as
`02.png`, `03.png`, `04.png`, `05.png`. See [../README.md](../README.md) for
which screen each frame wants, and
[../review-rejection-2.1a.md](../review-rejection-2.1a.md) for the seed script
that gets an account past onboarding with a job already dispatched to it.

Also worth having, though neither is required: a 7-inch and a 10-inch tablet
screenshot. Without them Play shows the phone shots to tablet users and marks
the listing as not optimised for larger screens.

---

## Not on this page, and each one blocks publishing

- **App content → Privacy policy URL.** Mandatory, and there is still no
  privacy policy at any URL — the same gap that holds up the iOS submission.
  It has to cover on-shift location, the vehicle walk-around video and the
  driver identity documents. **[you]**
- **App content → App access.** The app cannot be signed into without a
  roster account, so Play needs credentials or it gets rejected the way the
  TestFlight build did. Use the Supabase test number and fixed code from
  [../review-rejection-2.1a.md](../review-rejection-2.1a.md) and the same
  walkthrough notes. **[you]**
- **App content → Data safety.** Declare precise location (collected and
  shared, app functionality), phone number, photos and videos, files and docs,
  messages, and device identifiers for push. This form is checked against the
  app's actual behaviour, and getting it wrong is a common takedown.
- **App content → Foreground service permissions.** Required because the app
  targets SDK 36 and declares `FOREGROUND_SERVICE_LOCATION`. Justification:
  location is tracked only between Go Online and End Shift, so Operations can
  dispatch and the booked passenger can follow the car on a live link.
  A short screen recording of the flow is expected.

  Note that the app does **not** request `ACCESS_BACKGROUND_LOCATION`, so the
  separate and much slower background-location declaration does not apply.
- **Content rating questionnaire.** Answer messaging/chat honestly — the app
  has driver-to-office and driver-to-guest messaging. Same answer as iOS.
- **Target audience, Ads (none), Government apps (no), Financial features
  (no), Health (no).**

## Worth considering

Play has the same objection Apple does to a public listing for an app nobody
outside one company can use. The equivalent of Apple's Unlisted App
Distribution is **Managed Google Play** or a **closed track** with the drivers'
accounts on it. Either removes the "why is this in the store" question and
drivers still install from a link the office sends them, which is how they
will get it anyway.
