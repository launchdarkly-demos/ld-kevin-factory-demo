## What this shows

Release AutoPilot end to end. An airport operations board shows 2,000 simulated passengers boarding. You open a pull request with a user-facing change; the LaunchDarkly GitHub App proposes a flag, wraps the change behind it when you approve, and once the flag is turned on after merge, autopilot rolls it out under the project's release policy and rolls it back if a guardrail metric regresses. The deck paints the rollout passenger by passenger.

## LaunchDarkly features

- Release AutoPilot: the GitHub App's auto-flagging on pull requests, Vega's wrapping commit
- Guarded releases with guardrail metrics and automatic rollback
- Release policies

## Your own copy, every launch

Every launch gets its own LaunchDarkly project (the depot creates it with your token) and its own GitHub repository: at start the instance copies the demo repo from the `launchdarkly-demos/ld-kevin-factory-demo` template as `ld-flight-deck-<instance id>`, adds the two guardrail metrics and the guarded release policy to the project, and maps the repo to the project in Release AutoPilot. Tearing the instance down deletes the repo and the mapping; the depot deletes the project. Nothing is shared, so any number of SEs can run it at once.

For that you type a **GitHub token** on the launch form (`repo` and `delete_repo` scope, SSO-authorised for `launchdarkly-demos`, from a GitHub user connected to LaunchDarkly, since the App only obeys commands from people it knows). Leave it blank and the deck still runs, but without the pull-request beats.

Everything you do during the demo is a button in the deck's **Operate** menu (top right): open PR 1 or 2, Approve, Refine, Merge, Turn on serving baseline, Redeploy, Reset. No terminal. If you set an **Operate PIN** on the launch form, the menu asks for it once per browser session; set one whenever you share the instance as a public link.

## The story (about 15 minutes)

1. **Open the deck.** Everyone is blue: no flags, baseline behaviour. Talk about the policy and the metrics it watches (Operate shows the repo and project this launch owns).
2. **Open PR 1** (Operate > PR 1 express lane). Within a minute the App reacts; about four minutes later it posts a plan: one boolean flag plus a release configuration quoting the project's policy.
3. **Approve** (Operate > Approve posts `@launchdarkly approve`). About two minutes later: "Plan applied", a commit from Vega wrapping the lane behind the flag, flag created off in LaunchDarkly.
4. **Merge and deploy.** Operate > Merge. The container runs a live clone of your repo's `main`, so within 30 seconds the flight log reads "main moved to …: deploying" and the deck restarts on the merged code. That is the deploy. Operate > Redeploy forces it.
5. **Turn the flag on serving the baseline** (Operate > Turn on, serve baseline; or by hand in Production with the default rule set to Control in the same save). Within a minute the Release tab shows phase 1 in progress and the deck's lamp reads CLIMB. Passengers turn gold as the rollout climbs.
6. **PR 2** (gate upgrade offers) regresses a guardrail. Watch autopilot roll it back.

## Created during the demo

Nothing is seeded. Flags are created live and must not be pre-created.

| Key or pattern | Created by | When |
| --- | --- | --- |
| whatever the GitHub App proposes on PR 1 (an express-boarding boolean) | LaunchDarkly GitHub App, on `@launchdarkly approve` | beat 3 |
| whatever the GitHub App proposes on PR 2 (an upgrade-offers boolean) | LaunchDarkly GitHub App | beat 6 |
| release configurations for both flags | Release AutoPilot, from the project's release policy | beats 3 and 6 |
| metrics `boarding-time-ms`, `missed-boarding`; policy `release-auto-pilot-demo` | the instance itself at start (`scripts/launch.mjs`), because the seed format has no metrics or policies | before beat 1 |
| repo `ld-flight-deck-<id>` and its Release AutoPilot mapping | the instance itself at start; removed at teardown | before beat 1 |

## Launch parameters

| Parameter | What it does |
| --- | --- |
| `GITHUB_TOKEN` (secret) | Creates and later deletes your repo copy, posts the `@launchdarkly` commands as you. Blank: no PR beats. |
| `FLIGHT_DECK_OPS_TOKEN` (secret, "Operate PIN") | Any passphrase you choose; the Operate menu asks for it once. Blank: menu open to anyone who can reach the deck. |
| `SIM_RATE` | Simulated passengers per real second. 8 gives a guarded release enough samples to decide within one-minute steps. |
| `SIM_SEED` | Random seed for the simulation. Same seed, same passengers. |

## Setup the SE does

- A GitHub token with `repo` and `delete_repo` scope, SSO-authorised for `launchdarkly-demos`, pasted on the launch form. Your GitHub account must be connected to LaunchDarkly (Settings > Release autopilot does that the first time you claim a plan).
- Optional: an Operate PIN of your choosing on the launch form, typed once when you first open the Operate menu.

## Setup the owner does (once)

- Demo secret at `/demos/flight-deck/manage`: `LD_API_KEY`, an account-level LaunchDarkly token. The depot's project-writer token is refused for metrics, release policies and the Release AutoPilot mapping, so the instance falls back to this key for those calls.
- Keep `ld-kevin-factory-demo` a template repo with `main` at the flag-free baseline.

## Known limitations

- Not pausable: a stop deletes this launch's repo, so the timers terminate instead of pausing.
- The GitHub App has not yet been observed planning a PR on a template copy; it should, because the copy is an ordinary repo in an org where the App is installed.
- Orphaned `ld-flight-deck-*` repos (an instance that never stopped cleanly) are harmless; delete them by hand or with `scripts/provision-launch.sh <id> --teardown`.
