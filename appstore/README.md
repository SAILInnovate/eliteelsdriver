# App Store screenshots — ELS Elite Driver

Same system as the passenger app (`../../eliteels/appstore`). Renders App Store
frames at exact pixel sizes with headless Chrome.

    ./generate.sh

Output lands in `out/6.5in` (1242x2688) and `out/6.7in` (1284x2778). Both are
19.5:9, so a single layout serves both — the CSS is in `vh` units and scales
exactly, no reframing.

## The six frames

1. Editorial opener — chauffeur photograph, wordmark, caption
2. **Start of shift** — pre-shift check: registration, walk-around, Go Online
3. **Guest brief** — door, cabin temperature, music, conversation
4. **Live journey** — map with the route, On Location / POB / Complete
5. **Hours and expenses** — My Shifts, or the expense sheet on a job
6. Closing statement — invitation only

## Adding the real screenshots

Frames 2–5 show a phone with a slot in it. Capture the screen on a 6.7" device
(iPhone 14 Plus / 15 Pro Max / 16 Pro Max, or the matching simulator), drop it
into `shots/` named for its frame — `02.png`, `03.png`, `04.png`, `05.png` —
and it replaces the placeholder on the next run. Anything narrower still works;
the frame crops from the top.

Capture them from a real driver account on a real shift, with a real assigned
job. Two rules Apple cares about:

- No other company's branding, no Apple hardware in the shot
- Guest names, phone numbers and addresses in the screenshots are personal
  data. Use a test booking, or blur them before dropping the file in.

## Editing

`frames.html` holds every frame. Two kinds:

- **bleed** — full-bleed photograph with a caption over it, for opening and
  section frames
- **stack** — headline above a device, for feature frames

Type sizes are all `vh`, so nothing needs adjusting per size. Render a subset
while iterating:

    FRAMES="1 6" ./generate.sh

## Assets

`img/` is self-contained so this folder does not depend on the passenger repo.

- `img/opener.png` — chauffeur and Range Rover, frame 1
- `img/closer.webp` — spare editorial photograph, unused at present
- `img/wordmark.png` — black-on-white wordmark, light frames only
- `mark-white.png` — white knockout mark, for photographs
