# Flight Deck demo runbook

Two pull requests, one guarded release that lands, one that rolls back.
About 15 minutes live if PR 1 is merged before the audience arrives.

## Branches

`main` is disposable: `scripts/reset-demo.sh` rewrites it to the
`demo-baseline` tag before every run. Make your own changes on `develop`, then
move the tag so the next reset carries them:

```bash
git checkout develop && git pull
# ...commit...
git push origin develop
git tag -f demo-baseline && git push -f origin refs/tags/demo-baseline:refs/tags/demo-baseline
scripts/update-demo-branches.sh   # rebuild demo/pr1 and demo/pr2, which launch copies cherry-pick
```

The reset refuses to run if `main` holds commits it does not recognise.

## Driving it from the page

Every step below that names a script or a LaunchDarkly click has a button in
the deck's **Operate** menu (top right): open PR 1 or 2, Approve, Refine,
Merge, Turn on serving baseline, Redeploy, Reset. The menu shows when the
deck has `GITHUB_TOKEN`, `GITHUB_REPO`, `LD_API_KEY` and `LD_PROJECT_KEY`,
which the Demo Depot container does; on a laptop add them to `.env`. The
GitHub token's owner must be a GitHub user connected to LaunchDarkly, because
the App only obeys commands from people it knows. Outcomes land in the flight
log, so the room sees "opened PR #22" next to the passengers.

## Before the session

1. Reset everything: Operate > **Reset**, or `scripts/reset-demo.sh --yes`. Closes open PRs, deletes
   feature branches, forces `main` back to the `demo-baseline` tag, deletes
   the project's flags, restarts the deck. Dry run without `--yes`.
2. Open http://localhost:7777 on the big screen. It should read **TAXI** with
   an empty altitude tape.
3. Optional head start: run act 1 through the merge now, so the audience sees
   it already at CRUISE and act 2 gets the live time.
4. To record the run for the README animation, start
   `scripts/capture.sh 10` in a second terminal before act 1 and stop it with
   Ctrl-C after the rollback. Then `node scripts/make-gif.mjs` writes
   `docs/media/flight-deck.png` (use `--every=2` or `--delay=300` to tune
   length and pace). Frames are git-ignored; commit the animation.

## Act 1: express boarding lane (lands)

1. Operate > **PR 1 express lane** (or `scripts/open-pr.sh 1`). Opens the PR from the stored patch.
2. Within a minute the GitHub App reacts with eyes. About four minutes later it
   posts a plan: one boolean flag, plus a release configuration quoting the
   project's policy. Talking points while waiting: the deck, the policy, the
   metrics the policy watches.
3. Operate > **Approve** on the PR row (posts `@launchdarkly approve`). About two minutes later: "Plan
   applied", a commit from Vega wrapping the lane behind the flag, flag created
   off in LaunchDarkly.
4. Operate > **Merge**. Within about 30 seconds the deck notices `main` moved, pulls,
   and restarts itself; the flight log shows "main moved to …: deploying" and
   then "restarting on the new code". That is the deploy. If you do not want
   to wait, Operate > **Redeploy** (or `scripts/deploy.sh`) does the same thing now. The deck only
   self-deploys from a clean `main` checkout; otherwise it shows the orange
   banner and leaves it to you.
5. **Turn the flag on serving the baseline.** Operate > **Turn on, serve
   baseline** on the flag row does both in one semantic patch. By hand in
   LaunchDarkly, Production: turn it on **and set the default rule to serve
   the baseline variation in the same save** (the app has named it `Control`
   on some runs and `Off` on others). The app creates the flag
   with the new-behaviour variation as the on-default, so flipping the switch
   alone ships the feature to everyone and the engine has nothing to release. Done right, the
   Release tab shows "Release phase 1 of 1, In progress" within a minute and
   the deck's lamp reads **CLIMB**.
   If it still reads "Not ready: waiting on flag evaluations" after a minute,
   click **Release** on the targeting page: it pre-fills the policy's guarded
   release, and one Save starts it.
6. Watch: 10% at once, 25% at +1 min, 50% at +2, 100% and **CRUISE** at
   about +4. New-path boarding time about 4 simulated minutes against 5.5.
   Passengers turn gold as they clear security, so the new path is visible for
   the whole walk to the gate.

## Act 2: gate upgrade offers (rolls back)

1. Operate > **PR 2 upgrade offers** (or `scripts/open-pr.sh 2`). The classifier flags this one unaided and warns
   that the boarding-time guard may roll it back.
2. Approve, wait for "Plan applied", Merge, wait for the self-deploy (or
   Redeploy).
3. Turn on, serve baseline.
4. Watch: release starts within a minute, 10% then 25%. Plus and Elite
   passengers pause at the door with a purple ring; the new-path boarding time
   gauge climbs past baseline and turns red. At roughly +3 minutes the guard
   rolls back: the tape falls to 0% and the lamp reads **DISENGAGED**. The
   flight log records each step and the rollback.

## If something stalls

- No eyes reaction within two minutes: check the repo is still mapped at
  Settings > Release autopilot.
- Classifier says "no flag needed": Operate > **Refine** (posts
  `@launchdarkly refine`), or reply by hand with `@launchdarkly refine gate
  this behind a boolean flag per CLAUDE.md`.
- Release tab stuck at "Not ready": the flag is still off. Turn it on.
- Deck shows "offline": `LD_SDK_KEY` missing from `.env`.
- Altitude tape stays empty after merge: wait 30 seconds for the self-deploy,
  or Operate > Redeploy (`scripts/deploy.sh`). An orange banner that stays up means the deck
  cannot self-deploy (not on `main`, or local changes); the banner says which.
- Deck unresponsive or port in use: `scripts/deploy.sh --no-pull` kills and
  restarts it. In Demo Depot, restart the instance.
- Operate menu missing from the header: one of `GITHUB_TOKEN`, `GITHUB_REPO`,
  `LD_API_KEY`, `LD_PROJECT_KEY` is unset; `/api/state` lists which under
  `ops.missing`.
- Approve posted but the App ignores it: the GitHub token's owner is not a
  LaunchDarkly-connected GitHub user. Comment from your own account instead.

## Pace

The release policy runs 10% / 1 min, 25% / 1 min, 50% / 2 min. The guard has
rolled back about 40 seconds into the 25% stage in every run so far, so the
two-minute last step keeps a safety margin before the change lands at 100%,
after which monitoring stops. The deck runs 8 passengers a second
(`SIM_RATE`) so each stage has enough samples.

## Timing summary

| Beat | Minutes |
|---|---|
| PR open to plan | ~4 |
| Approve to "Plan applied" | ~2 |
| Flag on to release start | <1 |
| Act 1 rollout to cruise | ~4 |
| Act 2 rollout to rollback | ~2 |
