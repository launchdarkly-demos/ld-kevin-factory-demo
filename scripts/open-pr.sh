#!/usr/bin/env bash
# Open demo pull request 1 or 2 against main.
#
# Applies the stored patch for that PR onto the current origin/main in a fresh
# branch, pushes it, and opens the PR with the stored title and body. The
# GitHub App does the rest.
#
#   scripts/open-pr.sh 1     # express boarding lane
#   scripts/open-pr.sh 2     # gate upgrade offers (open after PR 1 has merged)
set -euo pipefail

cd "$(dirname "$0")/.."
REPO="launchdarkly-demos/ld-kevin-factory-demo"

case "${1:-}" in
  1) PATCH=demo/patches/pr1-express-boarding.patch; BODY=demo/pr1.md; BRANCH=express-boarding ;;
  2) PATCH=demo/patches/pr2-upgrade-offers.patch;  BODY=demo/pr2.md; BRANCH=gate-upgrade-offers ;;
  *) echo "usage: $0 <1|2>" >&2; exit 2 ;;
esac

if [ -n "$(git status --porcelain)" ]; then
  echo "working tree is not clean; commit or stash first" >&2
  exit 1
fi

TITLE="$(sed -n '1p' "$BODY")"
DESCRIPTION="$(sed '1,2d' "$BODY")"

git fetch -q origin main
git checkout -q -B "$BRANCH" origin/main
# -3 lets git fall back to a three-way merge when the GitHub App's gating
# commit from an earlier PR has shifted nearby lines.
if ! git am -3 "$PATCH"; then
  echo "patch did not apply cleanly; resolve, then: git am --continue && git push -u origin $BRANCH" >&2
  exit 1
fi
npm test >/dev/null
git push -q -u origin "$BRANCH"
gh pr create --repo "$REPO" --base main --head "$BRANCH" --title "$TITLE" --body "$DESCRIPTION"
git checkout -q main
