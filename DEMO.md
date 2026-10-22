## What this shows

Release AutoPilot end to end. An airport operations board shows 2,000 simulated passengers boarding. You open a pull request with a user-facing change; the LaunchDarkly GitHub App proposes a flag, wraps the change behind it when you approve, and once the flag is turned on after merge, autopilot rolls it out under the project's release policy and rolls it back if a guardrail metric regresses. The deck paints the rollout passenger by passenger.

## LaunchDarkly features

- Release AutoPilot: the GitHub App's auto-flagging on pull requests, Vega's wrapping commit
- Guarded releases with guardrail metrics and automatic rollback
- Release policies

## One presenter at a time

This demo is bound to one LaunchDarkly project (`kevinc-release-autopilot-demo`), the one the GitHub App is connected to, and to one GitHub repository. Demo Depot checks it out to you when you launch and checks it back in when you tear down. If someone else has it, the demo page lets you ask them to hand it over; they get a Slack message with *Hand it over* / *Not yet*.

Everything you do during the demo is a button in the deck's **Operate** menu (top right): Reset, open PR 1 or 2, Approve, Refine, Merge, Turn on serving baseline, Redeploy. No terminal needed. The menu shows once the instance has `GITHUB_TOKEN`, `LD_API_KEY` and `FLIGHT_DECK_OPS_TOKEN` (the depot's secrets); it asks for the ops token once per browser session. Before a session, open the menu and press **Reset**: closes PRs, forces `main` back to the baseline, deletes the project's flags, restarts the deck.

## The story (about 15 minutes)

1. **Open the deck.** Everything is red: no flags, baseline behaviour. Talk about the policy and the metrics it watches.
2. **Open PR 1** (Operate > PR 1 express lane). Within a minute the App reacts; about four minutes later it posts a plan: one boolean flag plus a release configuration quoting the project's policy.
3. **Approve** (Operate > Approve posts `@launchdarkly approve`). About two minutes later: "Plan applied", a commit from Vega wrapping the lane behind the flag, flag created off in LaunchDarkly.
4. **Merge and deploy.** Operate > Merge. The container runs a live clone of `main`, so within 30 seconds the flight log reads "main moved to …: deploying" and the deck restarts on the merged code. That is the deploy. Operate > Redeploy forces it.
5. **Turn the flag on serving the baseline** (Operate > Turn on, serve baseline; or by hand in Production with the default rule set to Control in the same save). Within a minute the Release tab shows phase 1 in progress and the deck's lamp reads CLIMB. Squares turn green as the rollout climbs.
6. **PR 2** (gate upgrade offers) regresses a guardrail. Watch autopilot roll it back.

## Created during the demo

Nothing is seeded. Flags are created live and must not be pre-created.

| Key or pattern | Created by | When |
| --- | --- | --- |
| whatever the GitHub App proposes on PR 1 (an express-boarding boolean) | LaunchDarkly GitHub App, on `@launchdarkly approve` | beat 3 |
| whatever the GitHub App proposes on PR 2 (an upgrade-offers boolean) | LaunchDarkly GitHub App | beat 6 |
| release configurations for both flags | Release AutoPilot, from the project's release policy | beats 3 and 6 |

## Launch parameters

| Parameter | What it does |
| --- | --- |
| `SIM_RATE` | Simulated passengers per real second. 8 gives a guarded release enough samples to decide within one-minute steps. |
| `SIM_SEED` | Random seed for the simulation. Same seed, same passengers. |

## Setup the SE does

- Read access to project `kevinc-release-autopilot-demo` with the LaunchDarkly API token saved in the depot (the launch reads the Production SDK key with it).
- Write access to the GitHub repo for the pull-request beats, and `gh` authenticated for the reset and open-pr scripts.

## Known limitations

- The deck's self-deploy (pull `main`, restart) is off in the depot (`FLIGHT_DECK_AUTO_DEPLOY=0`); see beat 4.
- One instance at a time, because the GitHub repository and the LaunchDarkly project are shared.
- Pausing keeps the instance but the simulation restarts from the seed on resume.
