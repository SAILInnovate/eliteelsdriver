# App Store Connect — App Information

Applies to every platform and ships with the next version, so it can be filled
in now regardless of what the 1.0 review is doing.

---

## Name — already correct

`ELS Elite Driver`. The "14" beside the field is characters remaining out of 30,
not a field waiting to be filled. Nothing to do.

## Subtitle — 30 max, currently empty

    For ELS Elite chauffeurs only

29 characters. It sits under the name in search results and on the product page.

Saying "only" is deliberate. Anyone who finds this app and downloads it cannot
sign in, and an app that cannot be signed into collects one-star reviews from
people who were never the audience. The subtitle is the cheapest place to head
that off, and it tells App Review what they are looking at before they open it.

If you would rather describe the job than the restriction:

    Shifts, jobs and guest briefs

28 characters.

## Category

- **Primary — Business**
- **Secondary — Travel**

Business is where workforce and dispatch apps sit; Uber Driver and Bolt Driver
are both there. Travel carries the chauffeur context without competing against
Google Maps and Waze on their own turf.

**Navigation** is the tempting alternative, since the app draws a route and
shows the next manoeuvre. Avoid it. The category is browsed by people looking
for a maps app, the comparison is unflattering, and it invites Apple to ask why
the app does not do turn-by-turn.

## Content Rights

    No, it does not contain, show, or access third-party content.

Apple's question is aimed at licensed media — music, video, books, artwork.
Nothing like that is in the app. The guest names, addresses and photographs are
your own operational data, not third-party content.

**But read the next section before you tick it.**

## License Agreement

Leave it on Apple's Standard License Agreement. A custom EULA is worth the
trouble only when you need terms Apple's does not cover, and the driver
relationship is already governed by the NDA they sign in the app and their
contract with you.

## Age Ratings

Work through the questionnaire as follows. Everything not listed is "None" or
"No".

**In-App Controls**
- Parental Controls — No
- Age Assurance — No

**Capabilities**
- Unrestricted Web Access — **No.** The app opens exactly three outside
  destinations, all fixed: `wa.me` for the office WhatsApp line, and Google or
  Apple Maps for navigation hand-off. There is no address bar and no arbitrary
  browsing.
- User-Generated Content — **No.** Drivers record walk-around videos and type
  notes, but nothing is published to an audience; it goes to the office.
- Social Media — No
- Messaging and Chat — **Yes.** Answer honestly. The app has driver-to-office
  messaging and driver-to-guest messaging. Both are closed channels tied to a
  booking, but they are chat, and understating it is the kind of thing that
  gets an app pulled later rather than rejected now.
- Advertising — No

**Mature Themes, Medical or Wellness, Sexuality or Nudity, Violence,
Chance-Based Activities** — None throughout.

Declaring Messaging and Chat will put the rating above 4+; Apple computes the
exact figure from your answers and shows it before you save. Whatever it lands
on is fine for an app only vetted chauffeurs can sign into.

## App Encryption Documentation — done

I added this to `ios/App/App/Info.plist`:

```xml
<key>ITSAppUsesNonExemptEncryption</key>
<false/>
```

The app uses only the HTTPS/TLS the operating system provides, which is the
standard exemption. With the key present, App Store Connect stops asking on
every upload and you upload nothing here. It takes effect on the next build —
the one currently in review is unaffected.

## Everything else on the page

- **Digital Services Act** — already done, identified as a trader. "Add Labels
  and Markings" is EU product-safety marking for physical goods; skip it.
- **Vietnam Game License** — not a game.
- **Regulated Medical Devices** — not a medical app.
- **App Store Server Notifications**, **App-Specific Shared Secret** — both for
  in-app purchases. There are none.
- **Bundle ID, SKU, Apple ID, Primary Language** — set, and not editable in any
  useful sense.

## Not on this page, still required

**Privacy Policy URL** now lives under **App Privacy**, not here. It is
mandatory, and there is no privacy policy at any URL yet — same gap as the
Support URL. It has to cover background location, the vehicle walk-around
video, and the driver identity documents.

---

## The map tiles are a real problem

Not an App Store issue today, and not urgent this hour, but you should know.

Both apps pull map tiles from `https://mt1.google.com/vt/...`
([PlayerPortal.jsx:2236](../src/pages/PlayerPortal.jsx:2236), and the same line
in the passenger app):

- It is an internal Google endpoint, not part of Google Maps Platform. There is
  no API key, no billing, and no licence — it is outside the Google Maps
  Platform Terms of Service.
- Google throttles and blocks this endpoint. When they do, the map goes blank
  for every driver and every passenger following a tracking link, at once, with
  no deploy on your side to blame.
- It also makes "No third-party content" a slightly generous answer to the
  Content Rights question, though that is the least of it.

The fix is to move to a provider you have a licence for — MapTiler, Stadia and
Mapbox all have free tiers well above your volume and are a one-line change to
the `TileLayer` url plus an attribution string. Google's official Maps SDK works
too but is a much larger change.

Worth doing before launch rather than after, because it is the same one-line
change in both apps and the tracking site, and it is far easier to make now than
during an outage. Say the word and I will do it.
