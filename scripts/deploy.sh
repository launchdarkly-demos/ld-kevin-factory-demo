#!/usr/bin/env bash
# "Deploy" the deck: hard-restart it on the current origin/main.
#
#   scripts/deploy.sh            # pull main, kill whatever holds the port, start fresh
#   scripts/deploy.sh --no-pull  # just restart on the checked-out code
#
# Run this right after a demo PR merges. The release engine only sees the flag
# once the merged code is evaluating it, and the deck only picks up new code
# on a restart. Logs go to /tmp/flight-deck.log.
set -euo pipefail

cd "$(dirname "$0")/.."
PORT="${PORT:-$(sed -n 's/^PORT=//p' .env 2>/dev/null | head -1)}"
PORT="${PORT:-7777}"

if [ "${1:-}" != "--no-pull" ]; then
  if [ -n "$(git status --porcelain)" ]; then
    echo "working tree is not clean; commit, stash, or use --no-pull" >&2
    exit 1
  fi
  git checkout -q main
  git fetch -q origin
  git reset -q --hard origin/main
fi
echo "code: $(git rev-parse --short HEAD) $(git log -1 --format=%s | cut -c1-70)"

# Kill anything on the port, including a wedged previous instance.
PIDS="$(lsof -ti ":$PORT" || true)"
if [ -n "$PIDS" ]; then
  echo "$PIDS" | xargs kill 2>/dev/null || true
  sleep 1
  PIDS="$(lsof -ti ":$PORT" || true)"
  [ -n "$PIDS" ] && echo "$PIDS" | xargs kill -9 2>/dev/null || true
fi

nohup node server.mjs > /tmp/flight-deck.log 2>&1 &
for _ in $(seq 1 20); do
  sleep 0.5
  if curl -s -m 2 "localhost:$PORT/api/health" >/dev/null 2>&1; then
    curl -s "localhost:$PORT/api/health"; echo
    echo "deck is up at http://localhost:$PORT"
    exit 0
  fi
done
echo "deck did not come up; last log lines:" >&2
tail -20 /tmp/flight-deck.log >&2
exit 1
