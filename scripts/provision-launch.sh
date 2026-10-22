#!/usr/bin/env bash
# Provision (or tear down) a disposable Flight Deck launch: a GitHub repo
# created from the template, a LaunchDarkly project with the two guardrail
# metrics and the guarded release policy, and the Release AutoPilot mapping
# between the two. Everything the Demo Depot would do at launch and teardown.
#
#   scripts/provision-launch.sh <launch-id>              create
#   scripts/provision-launch.sh <launch-id> --teardown   delete repo, mapping, project
#
# Needs: gh (logged in, SAML-authorised for the org), curl, LD_API_KEY in .env
# or the environment (admin or a role allowed to create projects and write
# account factory settings). Prints the env the container needs at the end.
#
# The mapping calls are not in the public API reference. They were captured
# from Settings > Release autopilot on 2026-10-21 and need `LD-API-Version: beta`:
#   GET    /api/v2/account/factory-settings            account switches
#   GET    /api/v2/account/factory-settings/repos      every repo -> project mapping
#   PATCH  /api/v2/account/factory-settings/repos/{githubRepoId}
#          {"projectKey": "...", "autoFlagging": {"enabled": true}, "autoReleasing": {"enabled": true}}
#   DELETE /api/v2/account/factory-settings/repos/{githubRepoId}
set -euo pipefail

TEMPLATE="${FLIGHT_DECK_TEMPLATE_REPO:-launchdarkly-demos/ld-kevin-factory-demo}"
ORG="${TEMPLATE%%/*}"
LD="https://app.launchdarkly.com"

usage() { sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'; exit 1; }
[ $# -ge 1 ] || usage
ID="$1"; shift
TEARDOWN=0
[ "${1:-}" = "--teardown" ] && TEARDOWN=1

HERE="$(cd "$(dirname "$0")/.." && pwd)"
if [ -z "${LD_API_KEY:-}" ] && [ -f "$HERE/.env" ]; then
  LD_API_KEY="$(grep '^LD_API_KEY=' "$HERE/.env" | cut -d= -f2- | tr -d '"' || true)"
fi
[ -n "${LD_API_KEY:-}" ] || { echo "LD_API_KEY is not set" >&2; exit 1; }

REPO="$ORG/ld-flight-deck-$ID"
PROJECT="flight-deck-$ID"

ld() { # method path [json]
  local m="$1" p="$2" body="${3:-}"
  if [ -n "$body" ]; then
    curl -sS -X "$m" "$LD$p" -H "Authorization: $LD_API_KEY" -H "LD-API-Version: beta" -H 'Content-Type: application/json' -d "$body"
  else
    curl -sS -X "$m" "$LD$p" -H "Authorization: $LD_API_KEY" -H "LD-API-Version: beta"
  fi
}

if [ "$TEARDOWN" = 1 ]; then
  echo "== Tearing down $REPO and $PROJECT"
  FAILED=0
  REPO_ID="$(gh api "repos/$REPO" --jq .id 2>/dev/null || true)"
  if [ -n "$REPO_ID" ]; then
    echo "  unmapping repo $REPO_ID"
    ld DELETE "/api/v2/account/factory-settings/repos/$REPO_ID" >/dev/null || { echo "  unmap failed" >&2; FAILED=1; }
  else
    echo "  repo $REPO not found on GitHub (already deleted?)"
  fi
  echo "  deleting project $PROJECT"
  ld DELETE "/api/v2/projects/$PROJECT" >/dev/null || { echo "  project delete failed" >&2; FAILED=1; }
  if [ -n "$REPO_ID" ]; then
    echo "  deleting repo $REPO"
    # needs the delete_repo scope: gh auth refresh -h github.com -s delete_repo
    gh repo delete "$REPO" --yes || FAILED=1
  fi
  [ "$FAILED" = 0 ] && echo "Done." || { echo "Finished with errors; re-run after fixing them." >&2; exit 1; }
  exit 0
fi

echo "== Creating $REPO from $TEMPLATE"
VIS="$(gh api "repos/$TEMPLATE" --jq .visibility)"
gh repo create "$REPO" --template "$TEMPLATE" "--$VIS" --description "Flight Deck launch $ID (disposable)" >/dev/null
for _ in 1 2 3 4 5 6; do
  REPO_ID="$(gh api "repos/$REPO" --jq .id 2>/dev/null || true)"
  [ -n "$REPO_ID" ] && gh api "repos/$REPO/commits?per_page=1" --jq '.[0].sha' >/dev/null 2>&1 && break
  sleep 3
done
echo "  repo id $REPO_ID"

echo "== Creating project $PROJECT"
ld POST /api/v2/projects "{\"key\":\"$PROJECT\",\"name\":\"Flight Deck $ID\",\"tags\":[\"flight-deck\",\"depot-launch\"]}" >/dev/null

echo "== Metrics"
ld POST "/api/v2/metrics/$PROJECT" '{"key":"boarding-time-ms","name":"Boarding time","kind":"custom","eventKey":"boarding-time-ms","isNumeric":true,"unit":"ms","successCriteria":"LowerThanBaseline","randomizationUnits":["user"],"unitAggregationType":"average","analysisType":"mean","eventDefault":{"disabled":true},"description":"Gate-to-seat time per boarded passenger, in simulated milliseconds. Lower is better."}' >/dev/null
ld POST "/api/v2/metrics/$PROJECT" '{"key":"missed-boarding","name":"Missed boarding","kind":"custom","eventKey":"missed-boarding","isNumeric":false,"successCriteria":"LowerThanBaseline","randomizationUnits":["user"],"unitAggregationType":"average","analysisType":"mean","eventDefault":{"disabled":false,"value":0},"description":"Passenger arrived at the gate after the door closed. Lower is better."}' >/dev/null

echo "== Release policy (guarded, 10%/1m, 25%/1m, 50%/2m, auto-rollback)"
ld POST "/api/v2/projects/$PROJECT/release-policies" '{"key":"release-auto-pilot-demo","name":"Release AutoPilot Demo","releaseMethod":"guarded-release","scope":{"environmentKeys":["production"]},"guardedReleaseConfig":{"metricKeys":["boarding-time-ms","missed-boarding"],"rollbackOnRegression":true,"rolloutContextKindKey":"user","stages":[{"allocation":10000,"durationMillis":60000},{"allocation":25000,"durationMillis":60000},{"allocation":50000,"durationMillis":120000}]}}' >/dev/null

echo "== Mapping $REPO -> $PROJECT (Release AutoPilot)"
ld PATCH "/api/v2/account/factory-settings/repos/$REPO_ID" "{\"projectKey\":\"$PROJECT\",\"autoFlagging\":{\"enabled\":true},\"autoReleasing\":{\"enabled\":true}}" >/dev/null

cat <<EOF

Done. Container environment for this launch:
  GITHUB_REPO=$REPO
  LD_PROJECT_KEY=$PROJECT
  LD_ENV_KEY=production
  LD_SDK_KEY=<production SDK key of $PROJECT: GET /api/v2/projects/$PROJECT/environments/production .apiKey>
  GITHUB_TOKEN=<token of a LaunchDarkly-connected GitHub user, repo scope on $REPO>
  LD_API_KEY=<this token or a writer on $PROJECT>
  FLIGHT_DECK_OPS_TOKEN=<shared secret for the Operate menu>

Tear down with: scripts/provision-launch.sh $ID --teardown
EOF
