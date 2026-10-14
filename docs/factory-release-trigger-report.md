# Release AutoPilot: what starts the release after merge

Notes from the Flight Deck demo build, 2026-10-14. Two dry runs through the
GitHub App, one stall, one answer.

## Finding

After `@launchdarkly approve` and merge, the flag's Release tab sits at
**Production: Not ready, "Waiting on flag evaluations to start release"**
until the flag is **turned on** in that environment. The GitHub App creates
the flag off, and evaluations of an off flag do not count. Flipping the flag
on with the default rule left at Control (the baseline) is the deploy signal:
within a minute the release engine added the policy's guarded release rule on
its own and started rolling out.

Things that were present but did **not** start the release:

- thousands of evaluations of the off flag in Production
- SDK application metadata reporting the merge commit as the running version
  (registered under Settings > Applications)
- code references on the default branch

## Suggested wording for the demo

"The pull request merges with the flag off. When the deploy is live, the
engineer turns the flag on, still serving the baseline. That is the handoff:
autopilot sees the flag evaluating and starts the release the policy
prescribes."

## Timeline, PR #2 (`enable-upgrade-offers`)

| Time (UTC) | Event |
|---|---|
| 14:10 | PR opened. Classifier proposed the flag unaided, with release configuration `6acf8e7f62929b071ec12bbe` mirroring the policy. |
| 14:14 | `@launchdarkly approve`. 14:16 "Plan applied", flag created off. |
| 14:19:47 | PR merged. Deck restarted on merge commit with SDK application version set. Flag evaluated ~100/min (eligible passengers). |
| 14:59 | Code references synced to `main`. Release tab still "Not ready". |
| ~15:54 | Flag turned on by hand, default rule Control, no release rule. |
| ~15:54–15:55 | Engine added "Release phase 1 of 1": 10% / 25% / 50% / 100% by user, both metrics, auto-rollback. Deck share 4% → 10%. |
| 15:56:16 | Advanced to 25%. Deck new-path boarding time 7.3 min vs 4.4 baseline. |
| 15:56:56 | Guard detected the boarding-time regression and rolled back. Release rule removed; rule serves Control. |
| 15:57:56 | Deck share 0%, lamp DISENGAGED, new path 8.0 min vs 4.3 at the end. |

About 3 minutes from flag-on to automatic rollback, with roughly 25 treated
passengers.

## Timeline, PR #1 (`enable-express-boarding`)

Same stall for 38 minutes with the flag off. Release started by hand from the
flag's Release button (which also turns the flag on); ran 10 → 25 → 50 → 100%
in 8.5 minutes, no regression, Production "Completed".

## Rehearsal, PR #3 (`enable-express-boarding` again, after a full reset)

Same PR content as #1, replayed after `scripts/reset-demo.sh` deleted the
flags and reset `main`. Four new observations:

1. **Policy lookup failed.** The refine reply said "No LaunchDarkly release
   policy matches staging or production" and the final plan carried a
   heads-up that "the policy lookup does not currently resolve that policy
   for production". The policy was unchanged since PR #2 resolved it, and it
   was visible in the UI, scoped to Production, throughout. The project has no
   staging environment.
2. **Duplicate flag in another project.** "Plan applied" reported: "A
   duplicate enable-express-boarding was created in the default project by
   mistake and should be archived."
3. **Flag defaults to Treatment when turned on.** The created flag's
   on-variation default is Treatment, so turning it on without editing the
   default rule released the feature to 100% immediately, with no guarded
   release. The default rule had to be set to Control by hand.
4. **No start after the fix.** With the flag on and serving Control (and
   again after an off/on cycle), the Release tab stayed at "Not ready: Waiting
   on flag evaluations to start release" for 20+ minutes. The release was
   started by hand from the Release button. PR #2's identical configuration
   had started within a minute of flag-on.

## Questions for the Factory team

1. Is "flag turned on in the environment" the intended deploy signal? If so,
   the plan comment ("start a release once this PR is deployed") and the
   Release tab message would be clearer if they said so.
2. Would the app consider turning the flag on itself once the merge commit is
   observed evaluating (via application version or code references), since
   both signals were available here?

## Environment

| Item | Value |
|---|---|
| Project | `kevinc-release-autopilot-demo`, environment `production` |
| Repo | `launchdarkly-demos/ld-kevin-factory-demo` |
| Policy | `release-auto-pilot-demo`: guarded, by user, 10% / 2m, 25% / 2m, 50% / 3m, metrics `boarding-time-ms` and `missed-boarding`, auto-rollback |
| SDK | `@launchdarkly/node-server-sdk` 9.14.4, `application: { id: "flight-deck", version: <git commit> }` |
