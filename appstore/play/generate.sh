#!/usr/bin/env bash
# Renders the Google Play store-listing graphics.
#
#   feature.png       1024x500   feature graphic
#   out/NN.png        1080x1920  phone screenshots (9:16 — Play's tallest)
#
# The App Store frames are 1242x2688 (19.5:9), which Play rejects: it will not
# take a screenshot taller than 9:16. frames.html carries a @media block for
# the squatter frame, so both stores render from the one layout.
set -euo pipefail
cd "$(dirname "$0")"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
FRAMES="${FRAMES:-1 2 3 4 5 6}"
mkdir -p out

"$CHROME" --headless --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
  --virtual-time-budget=10000 --window-size=1024,500 \
  --screenshot="feature.png" "file://$PWD/feature.html" 2>/dev/null
echo "  feature.png"

for f in $FRAMES; do
  "$CHROME" --headless --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
    --virtual-time-budget=10000 --window-size=1080,1920 \
    --screenshot="out/$(printf '%02d' "$f").png" \
    "file://$PWD/../frames.html?frame=$f" 2>/dev/null
  echo "  out/$(printf '%02d' "$f").png"
done
