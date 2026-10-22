import { test } from "node:test";
import assert from "node:assert/strict";

import { launchConfig, launchId, repoName, releasePolicy, METRICS } from "../lib/launch.mjs";

test("a launch is provisioned only when the depot id, both tokens and the project are present", () => {
  const off = launchConfig({});
  assert.equal(off.enabled, false);
  assert.deepEqual(off.missing, ["DD_INSTANCE_ID", "GITHUB_TOKEN", "LD_API_TOKEN or LD_API_KEY", "LD_PROJECT_KEY"]);
  const on = launchConfig({ DD_INSTANCE_ID: "01JD3K7X", GITHUB_TOKEN: "t", LD_API_KEY: "k", LD_PROJECT_KEY: "dd-abc" });
  assert.equal(on.enabled, true);
  assert.equal(on.ldApiKey, "k");
  // The depot's project-writer token is preferred; the account key stays as the fallback.
  const both = launchConfig({ DD_INSTANCE_ID: "x", GITHUB_TOKEN: "t", LD_API_TOKEN: "proj", LD_API_KEY: "acct", LD_PROJECT_KEY: "p" });
  assert.equal(both.ldApiKey, "proj");
  assert.equal(both.ldAccountKey, "acct");
  assert.equal(launchConfig({ DD_INSTANCE_ID: "x", GITHUB_TOKEN: "t", LD_API_TOKEN: "proj", LD_PROJECT_KEY: "p" }).enabled, true);
  assert.equal(on.repo, "launchdarkly-demos/ld-flight-deck-01jd3k7x");
  assert.equal(on.envKey, "production");
});

test("the launch id becomes a safe repo name, and FLIGHT_DECK_LAUNCH_ID overrides the depot id", () => {
  assert.equal(launchId({ DD_INSTANCE_ID: "Inst_42/x" }), "inst-42-x");
  assert.equal(launchId({ DD_INSTANCE_ID: "a", FLIGHT_DECK_LAUNCH_ID: "local-test" }), "local-test");
  assert.equal(repoName("02"), "ld-flight-deck-02");
  const tmpl = launchConfig({ FLIGHT_DECK_TEMPLATE_REPO: "acme/deck-template", DD_INSTANCE_ID: "x" });
  assert.equal(tmpl.repo, "acme/ld-flight-deck-x");
});

test("the release policy mirrors the demo runbook: guarded, 10%/1m, 25%/1m, 50%/2m, auto-rollback on both metrics", () => {
  const p = releasePolicy("production");
  assert.equal(p.releaseMethod, "guarded-release");
  assert.deepEqual(p.scope.environmentKeys, ["production"]);
  assert.deepEqual(p.guardedReleaseConfig.metricKeys, METRICS.map((m) => m.key));
  assert.equal(p.guardedReleaseConfig.rollbackOnRegression, true);
  assert.deepEqual(
    p.guardedReleaseConfig.stages.map((s) => [s.allocation, s.durationMillis]),
    [[10000, 60000], [25000, 60000], [50000, 120000]],
  );
  assert.ok(p.guardedReleaseConfig.stages.every((s) => s.allocation <= 50000), "a step cannot exceed 50% when metrics are attached");
});
