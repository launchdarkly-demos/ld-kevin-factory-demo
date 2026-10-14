#!/usr/bin/env bash
# Capture the deck to PNG frames on a timer, for turning a demo run into a GIF.
#
#   scripts/capture.sh [interval_seconds] [outdir]
#
# Defaults: one frame every 10 seconds into docs/media/frames/. Stop with
# Ctrl-C. Each frame is named by UTC time so the sequence sorts. Then build the
# GIF with scripts/make-gif.sh.
#
# Uses headless Google Chrome, no extra dependencies. The deck must be running
# at DECK_URL (default http://localhost:7777/).
set -euo pipefail

cd "$(dirname "$0")/.."
INTERVAL="${1:-10}"
OUTDIR="${2:-docs/media/frames}"
DECK_URL="${DECK_URL:-http://localhost:7777/}"
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"

if [ ! -x "$CHROME" ]; then
  echo "Chrome not found at $CHROME (set CHROME=/path/to/chrome)" >&2
  exit 1
fi
mkdir -p "$OUTDIR"
echo "capturing $DECK_URL every ${INTERVAL}s into $OUTDIR (Ctrl-C to stop)"

while true; do
  stamp="$(date -u +%Y%m%dT%H%M%SZ)"
  # virtual-time-budget lets the page poll /api/state and draw before the shot.
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars --window-size=1280,720 --force-device-scale-factor=1 \
    --virtual-time-budget=3000 --screenshot="$OUTDIR/$stamp.png" "$DECK_URL" >/dev/null 2>&1 \
    && echo "  $stamp.png" || echo "  $stamp failed" >&2
  sleep "$INTERVAL"
done
