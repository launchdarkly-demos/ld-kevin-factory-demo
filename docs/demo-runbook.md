# Flight Deck demo runbook

Two pull requests, one guarded release that lands, one that rolls back.
About 15 minutes live if PR 1 is merged before the audience arrives.

## Before the session

1. Reset everything: `scripts/reset-demo.sh --yes`. Closes open PRs, deletes
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

1. `scripts/open-pr.sh 1`. Opens the PR from the stored patch.
2. Within a minute the GitHub App reacts with eyes. About four minutes later it
   posts a plan: one boolean flag, plus a release configuration quoting the
   project's policy. Talking points while waiting: the deck, the policy, the
   metrics the policy watches.
3. Reply `@launchdarkly approve` on the PR. About two minutes later: "Plan
   applied", a commit from Vega wrapping the lane behind the flag, flag created
   off in LaunchDarkly.
4. Merge the PR. Pull `main` and restart the deck (the "deploy").
5. **Turn the flag on** in LaunchDarkly, Production, **and set the default
   rule to serve Control in the same save**. The app creates the flag with
   Treatment as the on-variation, so flipping the switch alone ships the
   feature to everyone and the engine has nothing to release. Done right, the
   Release tab shows "Release phase 1 of 1, In progress" within a minute and
   the deck's lamp reads **CLIMB**.
   If it still reads "Not ready: waiting on flag evaluations" after a minute,
   click **Release** on the targeting page: it pre-fills the policy's guarded
   release, and one Save starts it.
6. Watch: 10% at +1 min, 25% at +3, 50% at +5, 100% and **CRUISE** at about
   +8. New-path boarding time about 4 simulated minutes against 5.5.

## Act 2: gate upgrade offers (rolls back)

1. `scripts/open-pr.sh 2`. The classifier flags this one unaided and warns
   that the boarding-time guard may roll it back.
2. `@launchdarkly approve`, wait for "Plan applied", merge, pull, restart.
3. Turn the flag on, default rule Control.
4. Watch: release starts within a minute, 10% then 25%. Plus and Elite
   passengers pause at the door with a purple ring; the new-path boarding time
   gauge climbs past baseline and turns red. At roughly +3 minutes the guard
   rolls back: the tape falls to 0% and the lamp reads **DISENGAGED**. The
   flight log records each step and the rollback.

## If something stalls

- No eyes reaction within two minutes: check the repo is still mapped at
  Settings > Release autopilot.
- Classifier says "no flag needed": reply `@launchdarkly refine gate this
  behind a boolean flag per CLAUDE.md`.
- Release tab stuck at "Not ready": the flag is still off. Turn it on.
- Deck shows "offline": `LD_SDK_KEY` missing from `.env`.

## Timing summary

| Beat | Minutes |
|---|---|
| PR open to plan | ~4 |
| Approve to "Plan applied" | ~2 |
| Flag on to release start | <1 |
| Act 1 rollout to cruise | ~8 |
| Act 2 rollout to rollback | ~3 |
