#!/usr/bin/env bash
# Rebuild the template's demo/pr1 and demo/pr2 branches from the stored patches
# on top of the current baseline (tag demo-baseline), and push them.
#
# A launch copy opens its demo PRs by cherry-picking these commits (lib/ops.mjs
# pushDemoBranch): a cherry-pick has a merge base, so it survives the GitHub
# App's own commits on main, which a bare patch does not. Run this whenever the
# baseline or a patch changes, after moving the tag:
#
#   git tag -f demo-baseline && git push -f origin refs/tags/demo-baseline:refs/tags/demo-baseline
#   scripts/update-demo-branches.sh
set -euo pipefail
cd "$(dirname "$0")/.."
BASE="${1:-demo-baseline}"
START=$(git rev-parse --abbrev-ref HEAD)
tmp=$(mktemp -d)
trap 'git checkout -q "$START" 2>/dev/null || true; rm -rf "$tmp"' EXIT

git worktree add -q "$tmp" --detach "$BASE"
(
  cd "$tmp"
  git am -3 -q "$OLDPWD/demo/patches/pr1-express-boarding.patch"
  git branch -f demo/pr1 HEAD
  git am -3 -q "$OLDPWD/demo/patches/pr2-upgrade-offers.patch"
  git branch -f demo/pr2 HEAD
)
git worktree remove --force "$tmp"
echo "demo/pr1 $(git rev-parse --short demo/pr1) = $BASE + PR 1"
echo "demo/pr2 $(git rev-parse --short demo/pr2) = demo/pr1 + PR 2"
git push -q -f origin refs/heads/demo/pr1:refs/heads/demo/pr1 refs/heads/demo/pr2:refs/heads/demo/pr2
echo "pushed demo/pr1 and demo/pr2"
