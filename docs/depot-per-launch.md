# Demo Depot: one repo and one project per launch

The checkout model in `demo.yaml` binds Flight Deck to the single repository
the LaunchDarkly GitHub App is mapped to, so only one presenter can run it at
a time. This note records what it takes to give every launch its own
disposable repo and project instead, and what has been verified so far.

## The model

At launch:

1. Create a repo from the template `launchdarkly-demos/ld-kevin-factory-demo`
   (template flag set 2026-10-21). The copy has one root commit holding the
   baseline tree: no `develop`, no `demo-baseline` tag, no history. The App is
   installed org-wide, so the copy is covered the moment it exists.
2. Create a LaunchDarkly project, the two guardrail metrics and the guarded
   release policy.
3. Map the repo to the project in Release AutoPilot settings.
4. Start the container with that repo, project and the project's production
   SDK key. The entrypoint clones `main` and runs it; the Operate menu drives
   the demo; reset returns `main` to the root commit (see `resolveBaseline`
   in `lib/ops.mjs`).

At teardown: unmap, delete the repo, delete the project. Nothing is shared.

`scripts/provision-launch.sh <id>` does steps 1 to 3 and prints the container
environment; `--teardown` undoes them.

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
