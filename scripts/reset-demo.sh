#!/usr/bin/env bash
# Reset the Release AutoPilot demo to its starting state.
#
#   1. Close any open pull requests on the demo repo and delete the branches
#      that were pull-request heads (never main or develop).
#   2. Force main back to the flag-free baseline (tag demo-baseline).
#   3. Delete every feature flag in the LaunchDarkly demo project, which also
#      removes their release configurations.
#   4. Restart the local deck on the baseline.
#
# Merged pull requests stay in GitHub's history; GitHub has no way to delete
# them. Each demo run gets new PR numbers.
#
# Needs: gh (authenticated, SSO-authorized for the org), and LD_API_KEY in
# .env (a LaunchDarkly API access token with flag delete permission on the
# project).
#
#   scripts/reset-demo.sh                        # show what would happen
#   scripts/reset-demo.sh --yes                  # do it
#   scripts/reset-demo.sh --yes --discard-main   # even if main has stray commits
#
# main is disposable: the reset rewrites it. Keep your own changes on develop
# and move the demo-baseline tag (see docs/demo-runbook.md).
set -euo pipefail

cd "$(dirname "$0")/.."
REPO="launchdarkly-demos/ld-kevin-factory-demo"
BASELINE_TAG="demo-baseline"
DO_IT="${1:-}"

# Load .env without exporting anything else.
if [ -f .env ]; then
  LD_API_KEY="${LD_API_KEY:-$(sed -n 's/^LD_API_KEY=//p' .env | tr -d '"'"'" )}"
  LD_PROJECT_KEY="${LD_PROJECT_KEY:-$(sed -n 's/^LD_PROJECT_KEY=//p' .env | tr -d '"'"'" )}"
fi
LD_PROJECT_KEY="${LD_PROJECT_KEY:-kevinc-release-autopilot-demo}"

if [ -z "${LD_API_KEY:-}" ]; then
  echo "LD_API_KEY is not set (put it in .env)" >&2
  exit 1
fi

ld() {
  curl -sS -H "Authorization: $LD_API_KEY" -H "Content-Type: application/json" "$@"
}

echo "== Pull requests"
OPEN_PRS="$(gh pr list --repo "$REPO" --state open --json number,headRefName --jq '.[] | "\(.number) \(.headRefName)"')"
if [ -n "$OPEN_PRS" ]; then echo "$OPEN_PRS" | sed 's/^/  close #/'; else echo "  none open"; fi

echo "== Branches to delete"
# Only branches that were pull-request heads. Never main or develop.
PR_HEADS="$(gh pr list --repo "$REPO" --state all --limit 200 --json headRefName --jq '.[].headRefName' | sort -u)"
EXISTING="$(gh api "repos/$REPO/branches" --jq '.[].name' | sort -u)"
BRANCHES="$(comm -12 <(echo "$PR_HEADS") <(echo "$EXISTING") | grep -vE '^(main|develop)$' || true)"
if [ -n "$BRANCHES" ]; then echo "$BRANCHES" | sed 's/^/  /'; else echo "  none"; fi

echo "== main"
git fetch -q origin --tags
BASE_SHA="$(git rev-parse "$BASELINE_TAG")"
echo "  force origin/main from $(git rev-parse --short origin/main) to $BASELINE_TAG ($(git rev-parse --short "$BASE_SHA"))"
# Anything on origin/main that the baseline does not contain would be lost.
# Demo merges (the two PRs plus the GitHub App's gating commits) are expected;
# anything else is a human commit that belongs on develop first.
# git cherry marks with '+' the commits whose patch is not already in the
# baseline, so a change cherry-picked onto develop stops counting as stray.
# Commits authored by the GitHub App (Vega) and the two stored demo PRs are
# expected; anything else is a human commit that belongs on develop.
stray_commits() {
  local sha author email subject
  git cherry "$BASE_SHA" origin/main | awk '/^\+/ {print $2}' | while read -r sha; do
    author="$(git log -1 --format='%an' "$sha")"
    email="$(git log -1 --format='%ae' "$sha")"
    subject="$(git log -1 --format='%s' "$sha")"
    # The GitHub App has signed its commits as "Vega <vega@launchdarkly.com>"
    # and as "LaunchDarkly <noreply@launchdarkly.com>".
    case "$author" in *Vega*|LaunchDarkly) continue ;; esac
    case "$email" in vega@launchdarkly.com|noreply@launchdarkly.com) continue ;; esac
    case "$subject" in "Add an express boarding lane"*|"Offer paid upgrades"*|"Merge pull request"*) continue ;; esac
    echo "$(git rev-parse --short "$sha") $subject"
  done
}
STRAY="$(stray_commits || true)"
if [ -n "$STRAY" ]; then
  echo "  WARNING: commits on origin/main that are not in $BASELINE_TAG and do not look like demo PRs:"
  echo "$STRAY" | sed 's/^/    /'
  if [ "$DO_IT" = "--yes" ] && [ "${2:-}" != "--discard-main" ]; then
    echo "  Refusing to reset main. Cherry-pick them onto develop and move the tag, or re-run with --yes --discard-main." >&2
    exit 1
  fi
fi

echo "== LaunchDarkly flags in $LD_PROJECT_KEY"
FLAGS="$(ld "https://app.launchdarkly.com/api/v2/flags/$LD_PROJECT_KEY?summary=true" | python3 -c 'import json,sys; print("\n".join(i["key"] for i in json.load(sys.stdin)["items"]))')"
if [ -n "$FLAGS" ]; then echo "$FLAGS" | sed 's/^/  delete /'; else echo "  none"; fi

if [ "$DO_IT" != "--yes" ]; then
  echo
  echo "Dry run. Re-run with --yes to apply."
  exit 0
fi

echo
echo "== Applying"
if [ -n "$OPEN_PRS" ]; then
  echo "$OPEN_PRS" | while read -r num _; do gh pr close "$num" --repo "$REPO" --comment "Demo reset." >/dev/null && echo "  closed #$num"; done
fi
if [ -n "$BRANCHES" ]; then
  echo "$BRANCHES" | while read -r b; do gh api -X DELETE "repos/$REPO/git/refs/heads/$b" >/dev/null && echo "  deleted branch $b"; done
fi
git push -q --force origin "$BASE_SHA:refs/heads/main" && echo "  main reset to $BASELINE_TAG"
if [ -n "$FLAGS" ]; then
  echo "$FLAGS" | while read -r key; do
    code="$(ld -o /dev/null -w '%{http_code}' -X DELETE "https://app.launchdarkly.com/api/v2/flags/$LD_PROJECT_KEY/$key")"
    echo "  deleted flag $key ($code)"
  done
fi

echo "== Local deck"
git checkout -q main
git reset -q --hard origin/main
git branch -D express-boarding gate-upgrade-offers >/dev/null 2>&1 || true
lsof -ti :7777 | xargs kill 2>/dev/null || true
sleep 1
nohup node server.mjs > /tmp/flight-deck.log 2>&1 &
sleep 4
curl -s localhost:7777/api/health; echo
echo "Done. Deck is on $(git rev-parse --short HEAD) at http://localhost:7777"
