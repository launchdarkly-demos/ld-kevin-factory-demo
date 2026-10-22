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
   `LD_API_KEY` (owner demo secret, account level) are present, create
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
Release AutoPilot mapping lives in account factory settings, outside any
project, and the injected `LD_API_TOKEN` is a project writer. Flag writes
from the Operate menu fall back to `LD_API_TOKEN` when `LD_API_KEY` is
absent.

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

## Not yet verified

- The mapping DELETE (first `--teardown` run will show).
- That the App plans a PR on a template copy. Open PR 1 on the copy
  (`GITHUB_REPO=launchdarkly-demos/ld-flight-deck-launch-01` with the
  Operate menu or `scripts/open-pr.sh 1`) and wait for the plan comment.
- How Demo Depot injects secrets and whether it offers launch and teardown
  hooks to run the provisioning script. The `demo.yaml` schema is behind SSO.

## Cleanup of the test launches

```bash
scripts/provision-launch.sh launch-01 --teardown   # repo 1429205827, project flight-deck-launch-01
scripts/provision-launch.sh 02 --teardown          # repo 1429833722, project flight-deck-02
```
