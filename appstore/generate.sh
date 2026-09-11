#!/usr/bin/env bash
# Renders each ELS Elite Driver frame to PNG at both App Store iPhone sizes.
#
#   1242x2688  6.5"  (XS Max / 11 Pro Max)
#   1284x2778  6.7"  (12-13 Pro Max / 14 Plus)
#
# Both are 19.5:9, so one layout serves both — the CSS is in vh units and
# scales exactly. Drop real screenshots in shots/ as 01.png, 02.png ... and
# they replace the placeholders automatically.
set -euo pipefail
cd "$(dirname "$0")"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
FRAMES="${FRAMES:-1 2 3 4 5 6}"

for size in "1242,2688:6.5in" "1284,2778:6.7in"; do
  dims="${size%%:*}"; label="${size##*:}"
  mkdir -p "out/$label"
  for f in $FRAMES; do
    "$CHROME" --headless --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
      --virtual-time-budget=10000 \
      --window-size="$dims" \
      --screenshot="out/$label/$(printf '%02d' "$f").png" \
      "file://$PWD/frames.html?frame=$f" 2>/dev/null
    echo "  $label/$(printf '%02d' "$f").png"
  done
done
echo "Done. Upload out/6.7in (and out/6.5in if you want both)."
