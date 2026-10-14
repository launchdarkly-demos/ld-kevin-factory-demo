# Flight Deck: design sketch

A demo of LaunchDarkly Release AutoPilot (the GitHub App's auto-flagging and
auto-releasing) built around an airport operations app whose live view *is* the
visualization. You open a pull request against this repo, the GitHub App wraps
the change in a flag, you merge, and the app's own screen shows autopilot
rolling the change out passenger by passenger, with the guardrail metrics on
instruments beside it. A second pull request degrades a metric and the same
screen shows autopilot rolling it back.

Status: sketch. Nothing here is built yet.

## Why the app is the visualization

- **The rollout data is real and free.** The app evaluates flags for every
  simulated passenger through the LaunchDarkly server SDK. When autopilot moves
  the rollout from 10% to 25%, the SDK receives the change by streaming within
  a second and the next passengers evaluate differently. No LaunchDarkly API
  polling, no API token, no guessing at a release endpoint.
- **The app is the traffic.** A guarded release needs evaluations and metric
  events to make decisions. The passenger stream supplies hundreds of unique
  contexts per minute and emits the two metrics the policy watches.
- **No fake progress.** The altitude tape shows the measured share of recent
  passengers on the new path. If autopilot has not moved, the tape has not
  moved. Same principle as the Factory Floor track.

## The scene

A terminal with two concourses (A and B), a handful of gates each, and a stream
of passengers walking check-in → security → gate → boarding → departed. Flights
occupy gates and depart on a schedule; a few run late.

- Passengers on the **baseline path** render in the standard palette.
- Passengers who evaluated a flag **on** render gold with a short contrail.
- Passengers who **miss boarding** flash red and exit through a side corridor.

Panels around the canvas:

| Panel | Shows | Source |
|---|---|---|
| **Altitude tape** | % of passengers in the last 60s on the new path, per flag | SDK evaluations |
| **Instruments** | Boarding time (avg, old vs new path) and missed-boarding rate (old vs new) | Sim outcomes, same numbers sent to LaunchDarkly |
| **Autopilot lamp** | `TAXI` (0%), `CLIMB` (0–100%), `CRUISE` (100%), `DISENGAGED` (share falling back to 0 after being above 0) | Derived from the tape |
| **Flight plan strip** | Newest PR: Filed → Cleared → Guard installed → Wheels up | GitHub API, optional |
| **Flight log** | Timestamped: SDK flag updates, stage changes, rollback detected | SDK `update` events + sim |

The UI is **flag-agnostic**. The GitHub App chooses flag keys, so nothing in the
renderer names a flag. The flag helper records every evaluation, and the UI
groups by whatever keys it sees.

## Architecture

Node 20+, plain `http`, no framework, no bundler. The only npm dependency is
`@launchdarkly/node-server-sdk`.

```
package.json            start: node server.mjs ; test: node --test
server.mjs              http, static files, /api/state, /api/health, sim loop
lib/flags.mjs           LD client wrapper: isEnabled(), track(), evaluation registry, test overrides
lib/github.mjs          flight plan strip poller (adapted from Factory Floor server.mjs)
sim/world.mjs           tick loop, spawns passengers, flights, gates, aggregates
sim/passenger.mjs       passenger factory and LaunchDarkly context builder
sim/boarding.mjs        boardingLane(passenger)            <- PR 1 touches this
sim/gates.mjs           assignGate(flight, passenger)       <- PR 2 touches this
sim/metrics.mjs         rolling windows for gauges; emits LD track events
public/index.html
public/deck.js          canvas render loop, 2s poll of /api/state
public/deck.css
test/*.test.mjs         node:test, no network; flag-on and flag-off cases
docs/flight-deck-spec.md  (this file)
docs/demo-runbook.md      (written after the first dry run)
CLAUDE.md               flag conventions the GitHub App should follow
.launchdarkly/coderefs.yaml and .github/workflows/find-code-refs.yml  (optional, mirrors the reference repo)
```

### Configuration

Read from `./.env`, then the process environment.

| Var | Purpose |
|---|---|
| `LD_SDK_KEY` | Server-side SDK key for the **Production** environment of `kevinc-release-autopilot-demo` |
| `LD_PROJECT_KEY` | `kevinc-release-autopilot-demo`, for deep links in the log |
| `GITHUB_REPO` | `launchdarkly-demos/ld-kevin-factory-demo`, for the flight plan strip |
| `GITHUB_TOKEN` | Optional. Without it the strip is hidden. `gh auth token` works locally |
| `PORT` | 7777 |
| `SIM_RATE` | Passengers per second, default 4 |
| `FLIGHT_DECK_OFFLINE` | `1` runs with no LaunchDarkly connection; every flag returns its fallback. For building the renderer |

### The flag helper contract

Everything the GitHub App needs to wire a flag correctly lives in one module,
and `CLAUDE.md` points at it. The reference repo's PRs show the app reading
repo conventions (it cited "the repo's documented flag-off-is-baseline
convention"), so the conventions are written down.

```js
import { isEnabled, track } from "../lib/flags.mjs";

// Boolean flags only. Fallback is always the baseline behaviour.
if (isEnabled("enable-express-boarding", passenger.context, false)) {
  // new path
}

// Metric events. Numeric metrics pass a value; occurrence metrics pass none.
track("boarding-time-ms", passenger.context, boardingMs);
track("missed-boarding", passenger.context);
```

`isEnabled` records `{ flagKey, contextKey, value }` into a registry the sim
reads to colour passengers and fill the altitude tape. In tests,
`withFlags({ "enable-express-boarding": true }, fn)` overrides evaluations with
no network, so the app can write flag-on and flag-off tests the way it did in
the reference repo.

Conventions for `CLAUDE.md`:

- Flag off must preserve today's behaviour exactly. The flag-off path is the
  baseline.
- One boolean flag per user-facing behaviour change. Key pattern
  `enable-<descriptive-name>`.
- Evaluate once per passenger at the decision point, through `isEnabled`.
  Never cache a flag value across passengers.
- Tests live in `test/`, use `node:test`, and cover both flag states with
  `withFlags`.

### Passenger contexts

Each passenger is a unique `user` context (`pax-000123`) with attributes the
sim uses and a policy could target: `tier` (basic, plus, elite), `bags` (0–2),
`concourse` (A, B), `region`. Unique keys matter: guarded releases analyse per
context, so a fixed fleet of 60 would starve the sample size. The stream makes
roughly 240 new contexts a minute at the default rate.

### Metrics

Created by hand in the project before the demo and attached to the release
policy. Both are "lower is better".

| Key | Kind | Sent when |
|---|---|---|
| `boarding-time-ms` | Numeric, average | A passenger boards. Value is gate-to-seat milliseconds |
| `missed-boarding` | Occurrence | A passenger reaches the gate after the door closes |

The gauges on screen are computed from the same outcomes the events carry, so
what the audience sees and what autopilot decides on are the same numbers.

### Release policy

Project `kevinc-release-autopilot-demo` already has the policy **Release
AutoPilot Demo** (`release-auto-pilot-demo`): Production, guarded release,
target by user, auto-rollback on. Two things still to set on it once the
metrics exist:

| Setting | Today | Proposed for the demo |
|---|---|---|
| Steps | 25% for 6 h, 50% for 6 h, then 100% (12 h total) | 10% for 2 min, 25% for 2 min, 50% for 3 min, then 100% (~7 min) |
| Metrics | none | `boarding-time-ms`, `missed-boarding` |

Minimum sample size is set by LaunchDarkly and not editable; the first dry run
confirms the passenger rate clears it within a two-minute stage.

The app only connects to Production. Test gets no policy for now.

## The two pull requests

Both PRs are sincere product changes with a visible effect on the floor. The
first improves a metric and rides autopilot to cruise. The second degrades a
metric as a realistic side effect and gets rolled back. Neither PR mentions
flags, LaunchDarkly, or rollouts; that is the GitHub App's job.

### PR 1: Express boarding lane for carry-on-only passengers

Branch `express-boarding`. Files: `sim/boarding.mjs`, `public/deck.js` (draws
the second lane), `test/boarding.test.mjs`.

Change: `boardingLane(passenger)` returns `"express"` for passengers with no
checked bags; the express lane's gate-to-seat time is about half the zone
lane's. Carry-on-only passengers walk a separate lane on the canvas.

PR body:

> Carry-on-only passengers currently queue in the zone lane with everyone else.
> This adds an express lane at every gate for passengers with no checked bags,
> which roughly halves their gate-to-seat time and shortens the zone queue for
> everyone else.

Expected sequence:

1. App comments "LaunchDarkly suggests some changes" proposing one boolean flag
   (likely `enable-express-boarding`), off everywhere.
2. Reply `@launchdarkly approve`. App pushes a commit wrapping the lane
   decision in `isEnabled(...)` with fallback `false`, plus flag-on and
   flag-off tests. Comments "Plan applied".
3. Merge. Autopilot resolves the Production policy and starts the guarded
   release. On screen: altitude 0 → 10 → 25 → 50 → 100 over about seven
   minutes; gold passengers appear and take the express lane; the boarding
   time gauge shows the new path well under the old; lamp reads `CRUISE`.

### PR 2: Gate upgrade offers for Plus and Elite members

Branch `gate-upgrade-offers`. Files: `sim/boarding.mjs`, `sim/world.mjs`,
`server.mjs` (new `/api/upgrades` endpoint), `public/deck.js`,
`test/boarding.test.mjs`.

Why not the gate-reassignment idea from the first draft: a delayed flight is a
per-flight decision, so the flag would be evaluated without a passenger
context and the guarded release could not attribute outcomes to the treatment
arm. Every flag decision has to be per passenger.

Change: when a Plus or Elite passenger reaches the door, the agent offers a
paid upgrade. The conversation and reseating take 2.5 to 4 simulated minutes
before the passenger heads to their seat. Eligible passengers are about 43%
of traffic, so new-path boarding time rises from about 4.2 to about 5.7
simulated minutes. The ops board gains `/api/upgrades` with offer and
acceptance counts.

PR body:

> Plus and Elite members currently board with no upsell. This has the gate
> agent offer a paid upgrade to eligible passengers at the door, processes
> the reseating on acceptance, and exposes offer and acceptance counts at
> `/api/upgrades` for the ops board. The offer takes a few minutes per
> passenger at the door, so boarding time for eligible passengers goes up;
> we expect the revenue to justify it.

Expected sequence:

1. Proposal, approve, guard pushed, merge, same as PR 1.
2. Autopilot starts at 10%. Within the first stage the new-path boarding time
   gauge climbs above baseline and turns red; passengers with a ring pause at
   the door.
3. Guarded release detects the regression and rolls back. The SDK streams the
   change, the altitude tape falls to 0, the lamp reads `DISENGAGED`, and the
   log shows the rollback timestamp.

### Optional act between them: retool

Before PR 2, edit the release policy (shorter steps, or progressive instead of
guarded) and point out that the next release will behave differently with no
code change. Same beat as challenge 05 of the Factory Floor track, aimed at
policy rather than agent instructions.

## Demo timing

| Beat | Minutes |
|---|---|
| PR 1 open → proposal → approve → guard pushed | 3–5 |
| Merge → cruise | ~7 |
| PR 2 open → merged | 3–5 |
| Rollout → regression → rollback | 3–5 |

About 20–25 minutes live. PR 1 can be merged before the audience arrives and
shown already at cruise, which cuts it to about 12.

## Build order

1. Scaffold the app and sim; run with `FLIGHT_DECK_OFFLINE=1`; get the terminal,
   passengers, and instruments rendering with no LaunchDarkly at all.
2. Wire the SDK with the Production key. Create the two metrics. Confirm events
   arrive in LaunchDarkly.
3. Attach the metrics to the existing release policy and shorten its steps.
4. Commit the baseline to `main` with **no flags in the code**. The PRs must
   branch from a flag-free baseline or the app will say "already flagged".
5. Dry run PR 1 on a throwaway branch. Record what the app proposed, how it
   wired the helper, and whether the release started on merge. Adjust
   `CLAUDE.md` conventions from what it did.
6. Add the GitHub flight plan strip.
7. Dry run PR 2. Write `docs/demo-runbook.md` from the two runs.

## Dry run 1 findings (2026-10-13, PR #1)

- **Classification bar.** The app declined to flag the express lane on its own:
  "a self-contained routing change with no new surface, contract change, or
  risky call." Pure behaviour tweaks inside the sim do not clear the bar.
  `@launchdarkly refine <ask>` produced a plan within a minute.
- **The plan includes the release.** The refined plan carried a "Proposed
  Release Configuration" copied from the project's policy (10% / 2m, 25% / 2m,
  50% / 3m, both metrics, auto-rollback). `@launchdarkly approve` created the
  flag (off), pushed a commit that followed `CLAUDE.md` exactly (async
  `boardingLane`, `isEnabled` with fallback false, `withFlags` tests for both
  states), and created the release configuration.
- **Release trigger.** After merge the flag's Release tab showed Production
  "Not ready: Waiting on flag evaluations to start release" even with ~240
  evaluations a minute arriving. The reference app reports its commit SHA to
  LaunchDarkly (observability plugin `serviceVersion`); the deck now sets SDK
  application metadata `{ id: "flight-deck", version: <git commit> }`.
- **Timing.** PR open to first bot comment: ~4 min. Refine to plan: ~1.5 min.
  Approve to "Plan applied" with commit: ~1.5 min.
- **Auto-release did not fire.** 38 minutes after merge the Release tab still
  read "Waiting on flag evaluations to start release", with ~240 evaluations a
  minute and SDK application metadata reporting the merge commit. Open
  question for the Factory team: what counts as "deployed".
- **Manual start works and follows the policy.** The flag's Release button
  pre-filled the policy's guarded release (user, both metrics, auto-rollback,
  10% / 2m, 25% / 2m, 50% / 3m, release to everyone). Saving it ran the whole
  rollout: 10% at +1 min, 25% at +3.5, 50% at +5.5, 100% and CRUISE at +8.5.
  The SDK streamed each step within a second; the deck's tape followed with
  the 60-second window lag. New-path boarding time held around 4.2 simulated
  minutes against 5.5 baseline; no misses on the new path.
- **Instrument polish needed.** Once the baseline shrinks to a handful of
  passengers its miss rate swings wildly (3 of 30 read as 10%). Show sample
  counts or blank a gauge below ~20 passengers. (Done in `71ee058`.)

## Dry run 2 findings (2026-10-14, PR #2)

- **Classifier flagged it unaided.** A per-passenger change with a new API
  surface and a stated customer-facing cost got a plan in ~4 minutes, including
  the warning that the boarding-time guard might roll it back.
- **The deploy signal is turning the flag on.** With the flag off, nothing
  started the release: not evaluations, not SDK application version, not code
  references. Flipping the flag on (default rule Control, no release rule)
  made the engine add the policy's guarded release within a minute. Full
  write-up: [factory-release-trigger-report.md](factory-release-trigger-report.md).
- **Auto-rollback works and is fast.** 10% at +1 min, 25% at +2 min, rollback
  at about +3 min with ~25 treated passengers. Deck showed new path 7 to 8
  simulated minutes against 4.3 baseline, then share 0% and DISENGAGED.
- **Demo script.** Merge with the flag off; when the deploy is live, turn the
  flag on serving Control; autopilot does the rest. Two honest steps, no
  manual release.
- **Code references workflow added** (`.github/workflows/find-code-refs.yml`,
  secret `LD_API_KEY`). Keep it regardless; the flag pages now link to code.

## Open questions, in the order they can bite

1. **Does merging actually start the release?** The reference project's merged
   PR said "No release was configured", but that project had no policy at the
   time. If the app does not configure the release on merge once a policy
   exists, fallback is the `flag-release` skill through the hosted LaunchDarkly
   MCP, or starting the policy's recommended release by hand from the flag
   page. Either still shows the policy doing the work.
2. **Sample size and detection latency.** Whether four passengers a second
   clears the guarded release's minimum sample within a two-minute stage, and
   how long regression detection takes on PR 2.
3. **Approval required.** Both reference PRs needed `@launchdarkly approve`.
   The account setting could not be read from the UI. Assume yes until the dry
   run says otherwise.
4. **Flag key choice.** Unpredictable, which is why the UI never names a flag.
5. **Event delivery.** Numeric `track` values and flush timing need checking
   against the metric's event count in LaunchDarkly during step 2.
