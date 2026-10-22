#!/bin/sh
# Flight Deck container start: provision, run, supervise, tear down.
#
# In Demo Depot every instance gets its own LaunchDarkly project and keys, but
# Release AutoPilot also needs a GitHub repository mapped to that project. With
# DD_INSTANCE_ID, GITHUB_TOKEN and LD_API_KEY present, scripts/launch.mjs
# creates (or finds) this launch's repo from the template, adds the guardrail
# metrics and the release policy to the project, maps the repo, and hands the
# repo name back as GITHUB_REPO. Without those inputs (a verification run, a
# laptop) it does nothing and the ordinary path applies.
#
# The demo needs the deck to run whatever is on the repo's main branch,
# including the flag commit the GitHub App pushes mid-demo. When the
# container has a GitHub token and repo, clone main into a work directory
# and run from there with self-deploy on, so a merge reaches the floor within
# 30 seconds exactly as it does on a laptop. Without a token, run the copy
# baked into the image.
#
# This shell stays PID 1 and supervises the server: when the server has
# pulled new code it exits 75 and is started again (a detached re-exec would
# end the container), and on SIGTERM the server is stopped and this launch's
# repository and mapping are removed with this image's scripts/launch.mjs,
# whatever version of the code the clone was running.
set -u

IMAGE_DIR="$(pwd)"

if [ -z "${GITHUB_REPO:-}" ]; then
  # Skips quietly when inputs are absent. On failure it sets FLIGHT_DECK_LAUNCH_ERROR and the deck
  # starts from the baked copy so the failure is visible on the page instead of in a crash loop.
  out="$(node scripts/launch.mjs provision)" || exit 1
  eval "$out"
fi

if [ -n "${GITHUB_REPO:-}" ] && [ -n "${GITHUB_TOKEN:-}" ] && [ "${FLIGHT_DECK_CLONE:-1}" != "0" ]; then
  LIVE="${FLIGHT_DECK_LIVE_DIR:-/app/live}"
  echo "[flight-deck] cloning https://github.com/${GITHUB_REPO} (main) into ${LIVE}"
  rm -rf "$LIVE"
  git clone --quiet --branch main "https://x-access-token:${GITHUB_TOKEN}@github.com/${GITHUB_REPO}.git" "$LIVE" || exit 1
  # The demo PRs never touch package.json, so the image's modules serve the clone.
  ln -s /app/node_modules "$LIVE/node_modules"
  cd "$LIVE"
  export FLIGHT_DECK_AUTO_DEPLOY="${FLIGHT_DECK_AUTO_DEPLOY_LIVE:-1}"
  unset FLIGHT_DECK_NO_CODE_CHECK
fi

export FLIGHT_DECK_SUPERVISED=1
STOPPING=0
CHILD=""
on_term() {
  STOPPING=1
  [ -n "$CHILD" ] && kill -TERM "$CHILD" 2>/dev/null
}
trap on_term TERM INT

while :; do
  node server.mjs &
  CHILD=$!
  wait "$CHILD"
  code=$?
  CHILD=""
  if [ "$STOPPING" = 1 ]; then break; fi
  if [ "$code" = 75 ]; then
    echo "[flight-deck] server asked for a restart on new code"
    continue
  fi
  echo "[flight-deck] server exited with $code"
  break
done

if [ "${FLIGHT_DECK_LAUNCH_TEARDOWN:-0}" = 1 ]; then
  cd "$IMAGE_DIR" && node scripts/launch.mjs teardown || true
fi
exit "${code:-0}"
