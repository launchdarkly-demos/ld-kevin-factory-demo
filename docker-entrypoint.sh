#!/bin/sh
# Flight Deck container start.
#
# The demo needs the deck to run whatever is on the repo's main branch,
# including the flag commit the GitHub App pushes mid-demo. When the
# container has a GitHub token and repo, clone main into a work directory
# and run from there with self-deploy on, so a merge reaches the floor within
# 30 seconds exactly as it does on a laptop. Without a token, run the copy
# baked into the image.
set -eu

if [ -n "${GITHUB_REPO:-}" ] && [ -n "${GITHUB_TOKEN:-}" ] && [ "${FLIGHT_DECK_CLONE:-1}" != "0" ]; then
  LIVE="${FLIGHT_DECK_LIVE_DIR:-/app/live}"
  echo "[flight-deck] cloning https://github.com/${GITHUB_REPO} (main) into ${LIVE}"
  rm -rf "$LIVE"
  git clone --quiet --branch main "https://x-access-token:${GITHUB_TOKEN}@github.com/${GITHUB_REPO}.git" "$LIVE"
  # The demo PRs never touch package.json, so the image's modules serve the clone.
  ln -s /app/node_modules "$LIVE/node_modules"
  cd "$LIVE"
  export FLIGHT_DECK_AUTO_DEPLOY="${FLIGHT_DECK_AUTO_DEPLOY_LIVE:-1}"
  unset FLIGHT_DECK_NO_CODE_CHECK
fi

exec node server.mjs
