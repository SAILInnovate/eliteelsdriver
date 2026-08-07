# Elite ELS — Design & Engineering Manifesto

> This document defines the feel, the standard, and the rules.
> Every screen, every interaction, every line of code must honour this.

---

## What We're Building

A private chauffeured transport platform for **Premier League footballers, executives, and high-net-worth individuals**. Not a taxi app. Not Uber. This is **Wheely-tier** — the kind of app that sits next to their private banking app and their Centurion card.

The user opens this app in the back of a Range Rover. Their agent books through it. Their club manager sees a dashboard of every journey. The chauffeur gets a clean job manifest. Every touchpoint must feel like it belongs in that world.

---

## The Feel

### One word: **Quiet confidence.**

- No bright colours screaming for attention
- No emoji, no playful copy, no exclamation marks
- No visual clutter — every pixel earns its place
- The app should feel like a **hand-finished interior** — dark leather, brushed metal, soft lighting

### References
- Wheely rider app
- Rolls-Royce configurator
- Amex Centurion app
- Net-A-Porter checkout

### What it is NOT
- Not Uber (functional, mass-market)
- Not Bolt (cheap, loud)
- Not a tech demo (no gratuitous animation)

---

## Design System

### Colour Palette

| Token | Value | Usage |
|---|---|---|
| `--color-primary-black` | `#000000` | Background, primary |
| `--color-surface` | `#111111` | Cards, elevated surfaces |
| `--color-gold` | `#D4CFC9` | Accent — pale champagne, not gold |
| `--color-gold-light` | `#E6E2DE` | Hover states |
| `--color-gold-dim` | `#222222` | Borders, dividers |
| `--color-warm-white` | `#FFFFFF` | Primary text, CTAs |
| `--color-warm-gray` | `#888888` | Secondary text |

**Rules:**
- Never use raw hex — always use CSS variables
- No colour outside this palette unless it's a status indicator
- Status colours: `#4CAF50` (active/green), `#FF3B30` (error/red), `#D4AF37` (gold membership only)

### Typography

| Use | Font | Weight | Size |
|---|---|---|---|
| Body / UI | Montserrat | 300–600 | 0.625rem – 1.125rem |
| Display / Prices | Cormorant Garamond | 300, 600 | 1.375rem – 3rem |

**Rules:**
- All caps for labels and badges — always with `letter-spacing: 2px+`
- No bold body text — use weight 400–500 max for body
- Minimum font size: `0.625rem` (10px). Nothing smaller, ever.
- Everything must be **legible at arm's length** on a phone screen

### Spacing & Layout
- Padding: 24px horizontal on all sheets
- Safe areas: Always respect `env(safe-area-inset-top/bottom)`
- Sheets slide up from bottom — never more than 65% screen height
- Map always visible above the sheet — minimum 35% viewport
- No horizontal scroll anywhere

### Icons
- Lucide React — stroke style, 16–24px
- No emoji. No unicode glyphs as icons.
- Icons are secondary — they support text, never replace it

### No-Go List
- ❌ Emoji anywhere in the UI
- ❌ Rounded corners > 0px on buttons/cards (sharp = premium)
- ❌ Gradients on backgrounds (flat black/charcoal only)
- ❌ Drop shadows on cards (use borders instead)
- ❌ Placeholder images — generate real assets or leave empty
- ❌ Lorem ipsum — use real copy or leave blank

---

## Interaction & Animation

### Philosophy
Animations exist to **communicate state change**, not to entertain. Every animation must have a purpose. If removing it doesn't hurt comprehension, remove it.

### Rules

| Element | Animation | Duration | Easing |
|---|---|---|---|
| Sheet slide-up | translateY 100% → 0 | 250ms | `[0.25, 0.46, 0.45, 0.94]` |
| Sheet dismiss | translateY 0 → 100% | 150ms | `easeIn` |
| Button press | scale → 0.97 | 150ms | spring |
| Page transition | opacity 0 → 1 | 200ms | ease |
| List items | staggered fadeUp | 300ms, 50ms stagger | ease |
| Status badge | scale 0.9 → 1 + fade | 300ms | ease |

**Performance rules:**
- Only animate `transform` and `opacity` — never `width`, `height`, `top`, `left`, `margin`
- Use `will-change: transform` on animated containers
- Use `contain: layout paint` on scroll containers
- All animations must run at **60fps on WKWebView** — test on a real iPhone, not Chrome
- Framer Motion: use `tween` transitions only, never `spring` with high stiffness
- No `layout` prop on motion elements unless absolutely necessary

### Haptics
- Light tap: navigation, toggles
- Medium tap: selections, drawer open
- Heavy tap: booking confirmed, cancel confirmed

---

## Performance Standards

### The 3-Second Rule
The app must be **interactive within 3 seconds** of cold launch on an iPhone 12. No loading spinners on the main screen.

### Bundle
- Total JS < 800KB (gzipped < 250KB)
- Vendor libraries split into cached chunks
- No dynamic imports that block the critical path

### Data Loading
- **localStorage first**: Profile, credits, tier, saved card, saved places — cached on first load, hydrated instantly on next open
- **Background refresh**: Supabase fetch happens after UI is painted, silently updates cache
- **Realtime**: Only for active ride status changes — one subscription, not multiple

### Network
- Assume the user is on 4G in a moving vehicle
- All Supabase queries must use `.maybeSingle()` or `.limit()` — never unbounded
- Search debounce: 300ms minimum
- Map tiles: cache aggressively, don't reload on view change

### Capacitor / iOS
- `scroll-behavior: auto` — never `smooth` (WKWebView jank)
- `overscroll-behavior: none` on html and body
- `user-select: none` globally
- `touch-action: manipulation` globally
- `-webkit-tap-highlight-color: transparent` globally
- Test on real device, not simulator

---

## Architecture

### Client App (This Repo)
The rider-facing Capacitor app. Read-only for rates. Writes rides.

### Driver App (Future)
Separate app. Subscribes to `rides` where `status = 'pending'`. Updates timing fields, GPS breadcrumbs, status events.

### Club Dashboard (Future)
Web dashboard for club admins. Queries rides by `corporate_account_id`. Views all players, all rides, all drivers.

### Data Flow

```
Client books ride
  → rides.insert({ status: 'pending', service_type, metadata })
  
Driver accepts
  → rides.update({ driver_id, driver_name, status: 'dispatched' })
  
Driver arrives
  → rides.update({ status: 'arrived', arrived_at })
  → ride_events.insert({ event_type: 'on_location' })
  
Passengers on board
  → rides.update({ status: 'in_progress', pob_at })
  → ride_events.insert({ event_type: 'pob' })
  
Journey
  → driver_locations.insert({ coords, speed, heading }) every 5-10s
  
Drop-off
  → rides.update({ status: 'completed', dropoff_at, distance_miles, journey_time_mins })
  → Billing engine calculates final_calculated_price
  → Stripe charge
```

### Rate Card
- Rates live in the database (`vehicle_rates`, `zone_rates`, `airport_rates`, `security_packages`, `surcharges`)
- Client app caches rates in localStorage on first fetch
- Admin updates rates via Supabase dashboard (future: admin UI)
- Never hardcode prices in the frontend — always pull from DB or cache

### Ride Record
Every ride stores its full billing manifest as top-level columns:
`service_type`, `vehicle_class`, `booked_hours`, `base_rate`, `subtotal`, `actual_hours`, `distance_miles`, `wait_time_mins`, `surcharges_applied`, `vat_amount`, `final_calculated_price`

This means the driver app, billing engine, and club dashboard can all query rides directly without parsing JSON.

---

## Code Standards

### File Structure
- `src/pages/` — Full-screen page components
- `src/components/` — Reusable components and sub-views
- `src/hooks/` — Custom React hooks (auth, location, language)
- `src/lib/` — Utilities and Supabase client
- `src/i18n/` — Translation files

### Style
- Inline styles for layout (Capacitor apps don't benefit from CSS-in-JS extraction)
- CSS file for: keyframes, global resets, GPU hints, utility classes
- CSS variables for all colours, fonts, spacing
- No Tailwind. No styled-components.

### State
- `useState` for local UI state
- `localStorage` for persistent cache
- Supabase realtime for live data
- No Redux, no Zustand — the app is not complex enough

### Copy
- British English: "colour", "favour", "organisation"
- No contractions in formal labels: "Cancel Ride" not "Cancel your ride"
- All-caps for: badges, section headers, button labels
- Sentence case for: descriptions, body text

---

## The Test

Before shipping any screen, ask:

1. **Would a Premier League player's agent be embarrassed showing this to their client?** If yes, redo it.
2. **Can I read everything without squinting?** If no, increase font size.
3. **Does it feel instant?** If there's a visible loading state on navigation, fix it.
4. **Is there anything that looks "techy" or "startup-y"?** Remove it.
5. **Would this look right next to the Amex Platinum app?** That's the bar.
