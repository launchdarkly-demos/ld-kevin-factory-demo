# Demo Depot: one repo and one project per launch

The checkout model in `demo.yaml` binds Flight Deck to the single repository
the LaunchDarkly GitHub App is mapped to, so only one presenter can run it at
a time. This note records what it takes to give every launch its own
disposable repo and project instead, and what has been verified so far.

## The model (implemented 2026-10-22)

The depot has no launch or teardown hooks, but in `launchdarkly.mode: seed`
it already creates a LaunchDarkly project per instance with the SE's token,
injects `LD_SDK_KEY`, `LD_PROJECT_KEY`, `LD_ENV_KEY` and (with
`apiToken: project-writer`) `LD_API_TOKEN`, and deletes the project at
teardown. Every container also gets `DD_INSTANCE_ID`. So the container does
the GitHub side itself:

1. **Start** (`docker-entrypoint.sh` → `scripts/launch.mjs provision`): when
   `DD_INSTANCE_ID`, `GITHUB_TOKEN` (launch parameter, `secret: true`) and
   `LD_API_KEY` (owner demo secret, account level; the depot's project-writer token gets HTTP 403 on metrics and policies) are present, create
   `ld-flight-deck-<instance id>` from the template in the same org (or find
   it after a restart), add the two metrics and the release policy to the
   injected project (409 = already there), and PATCH the mapping. It prints
   `GITHUB_REPO` and `FLIGHT_DECK_LAUNCH_TEARDOWN=1` for the entrypoint,
   which then clones `main` and runs it with self-deploy on. If any input is
   missing (a verification run, a laptop) the step is skipped and the baked
   copy runs, so health checks still pass.
2. **Demo**: the Operate menu drives it. Reset returns `main` to the copy's
   root commit (`resolveBaseline` in `lib/ops.mjs`).
3. **Stop**: the entrypoint stays PID 1 and supervises the server. On
   SIGTERM it stops the server and runs `scripts/launch.mjs teardown` from
   the image (unmap, delete the repo) within the 30 seconds ECS allows,
   whatever version of the code the clone was running. The depot deletes the
   project. `lifecycle.pausable` is `false` because a pause is a stop.
4. **Self-deploy in a container**: the server cannot re-exec itself detached
   (PID 1 leaving ends the task), so under the supervisor it exits with code
   75 after pulling and the entrypoint starts it again. Copies made before
   this code reached the template's `main` fall back to the old behaviour,
   which ends the task and lets ECS restart it: slower, still correct.

`scripts/provision-launch.sh <id> [--teardown]` remains for laptops and for
cleaning up a launch whose container never stopped cleanly.

Why `LD_API_KEY` is a demo secret rather than the injected token: the
injected `LD_API_TOKEN` is a project writer and is refused (HTTP 403) when
creating metrics and release policies, and the Release AutoPilot mapping
lives in account factory settings outside any project. Every call tries the
injected token first and falls back to the account key; the launch log says
which one worked. The Operate PIN (`FLIGHT_DECK_OPS_TOKEN`) is a launch
parameter the SE chooses, not an owner secret, because the SE has to know it.

## The mapping API

Not in the public API reference. Captured from Settings > Release autopilot
on 2026-10-21. Every call needs the header `LD-API-Version: beta`.

| Call | Body | Notes |
|---|---|---|
| `GET /api/v2/account/factory-settings` | | Account-wide switches: `autoFlagging.enabled`, `autoReleasing.enabled`, `autoCleanup`, `version`. |
| `GET /api/v2/account/factory-settings/repos` | | Array of mappings: `githubRepoId` (numeric GitHub id), `projectId`, `projectKey`, per-repo `autoFlagging`/`autoReleasing` with `enabledOverride`, `version`. |
| `PATCH /api/v2/account/factory-settings/repos/{githubRepoId}` | `{"projectKey":"…","autoFlagging":{"enabled":true},"autoReleasing":{"enabled":true}}` | Creates or updates the mapping. Returns the mapping. The UI sends exactly this on Save. |
| `DELETE /api/v2/account/factory-settings/repos/{githubRepoId}` | | Removes the mapping (inferred from the resource shape; not yet exercised). |

The GitHub repo id comes from `gh api repos/<owner>/<name> --jq .id`. The UI's
repo picker lists every repo the App installation can see; it did not issue a
visible request for that list, so the picker source is unknown and not
needed.

Release policies use `POST /api/v2/projects/{key}/release-policies` (beta)
with the shape in `scripts/provision-launch.sh`; metrics use the public
`POST /api/v2/metrics/{key}`.

## Verified on 2026-10-21

- `gh repo create --template` produced `launchdarkly-demos/ld-flight-deck-launch-01`
  with a single "Initial commit" (id 1429205827).
- `POST /api/v2/projects` created `flight-deck-launch-01` with `test` and
  `production`.
- Both metrics and the policy were created in it by API (HTTP 201 each).
- The mapping was added through the settings UI; the request it sent is the
  PATCH above, and the page then showed the project row with "Manage
  auto-release settings" instead of "Policy needed".
- Both demo patches apply onto a history-less copy (the ops test uses a bare
  repo with the same shape).

- 2026-10-22: `scripts/provision-launch.sh 02` ran end to end with the
  account API token: repo `ld-flight-deck-02` (id 1429833722), project
  `flight-deck-02`, metrics, policy, and the mapping PATCH all succeeded.
  The mapping record shows no `updatedByMemberId`, so a token write is a
  supported path. The DELETE is still untested until the first teardown.

## The App and new mappings (2026-10-22)

**Resolved in practice.** On the first real Depot launch of v0.2.2 the App
planned PR 1, the plan was approved, Vega committed, the PR merged, and the
release ran: the App resolves a project the depot created minutes earlier.

The earlier scare: during testing, every PR on a repo mapped to a project
*I* had created through the API (`flight-deck-test03`, with metrics and
policy) got "I couldn't resolve your LaunchDarkly project", regardless of
how the mapping was made, whether the repo was a template copy, code
references, reopening the PR, or waiting 50 minutes. The difference to the
depot's projects is not understood; it may be how those test projects were
created or something about them the App checks. It did not affect real
launches, so it is left as a note for the Factory team rather than a blocker.

## PR 2 in a copy: cherry-pick, not patch (2026-10-22)

The first launch stalled at PR 2 with "sha1 information is lacking or
useless (public/deck.js)". The stored patch's 3-way merge needs the blob it
was written against, which lives only in the original repo's history: main
after PR 1 *and the App's own commit*, which differs per run. A template copy
never has it.

Fix: the template keeps branches `demo/pr1` (baseline + PR 1) and `demo/pr2`
(`demo/pr1` + PR 2), rebuilt from the patches by
`scripts/update-demo-branches.sh`. A copy fetches the template's branches and
**cherry-picks** the commit, which has a real merge base (its parent), so it
survives whatever the App committed to main in between. The patch path stays
as the fallback where no template is configured. `test/ops.test.mjs` models
the exact failure: a history-less copy, PR 1 merged, an App-style commit on
`main` touching a file PR 2 edits, then PR 2.

Keep in sync: after moving `demo-baseline`, run `scripts/update-demo-branches.sh`.

## Cleanup of the test launches

```bash
scripts/provision-launch.sh launch-01 --teardown   # repo 1429205827, project flight-deck-launch-01
scripts/provision-launch.sh 02 --teardown          # repo 1429833722, project flight-deck-02
```
