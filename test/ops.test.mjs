import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

import { opsConfig, parsePrBody, pushDemoBranch, resolveBaseline, DEMO_PRS } from "../lib/ops.mjs";

const git = (args, cwd) => execFileSync("git", args, { cwd, stdio: ["ignore", "pipe", "pipe"] }).toString().trim();

test("ops are disabled until every token and key is present, and say which are missing", () => {
  const off = opsConfig({});
  assert.equal(off.enabled, false);
  assert.deepEqual(off.missing, ["GITHUB_TOKEN", "GITHUB_REPO", "LD_API_KEY", "LD_PROJECT_KEY"]);
  const on = opsConfig({ GITHUB_TOKEN: "t", GITHUB_REPO: "o/r", LD_API_KEY: "k", LD_PROJECT_KEY: "p" });
  assert.equal(on.enabled, true);
  assert.equal(on.envKey, "production");
});

test("the stored PR files parse into a title and a description", () => {
  for (const spec of Object.values(DEMO_PRS)) {
    const { title, description } = parsePrBody(fs.readFileSync(spec.body, "utf8"));
    assert.ok(title.length > 10, `${spec.body} title`);
    assert.ok(description.includes("`"), `${spec.body} description should mention files`);
    assert.ok(!description.startsWith("---"));
    assert.ok(fs.existsSync(spec.patch), `${spec.patch} exists`);
  }
});

test("each demo patch applies onto the baseline and lands on its own branch (local bare repo as the remote)", (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "flight-deck-ops-test-"));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const bare = path.join(tmp, "remote.git");
  git(["init", "--quiet", "--bare", bare]);
  // The baseline is this checkout's HEAD, pushed as main (no flags on main there).
  git(["push", "--quiet", bare, "HEAD:refs/heads/main"], process.cwd());
  const cfg = { ...opsConfig({ GITHUB_TOKEN: "t", GITHUB_REPO: "o/r", LD_API_KEY: "k", LD_PROJECT_KEY: "p" }), gitRemote: bare };

  const pr1 = pushDemoBranch(cfg, 1);
  assert.equal(pr1.branch, DEMO_PRS[1].branch);
  assert.equal(git(["rev-parse", `refs/heads/${pr1.branch}`], bare), pr1.head);
  assert.equal(git(["rev-parse", `${pr1.branch}~1`], bare), git(["rev-parse", "main"], bare), "one commit on top of main");
  // A second push of the same PR is a force-push, not an error.
  assert.equal(pushDemoBranch(cfg, 1).branch, pr1.branch);

  // PR 2 is written against main after PR 1 has merged: merge it, then apply.
  git(["update-ref", "refs/heads/main", pr1.head], bare);
  const pr2 = pushDemoBranch(cfg, 2);
  assert.equal(pr2.branch, DEMO_PRS[2].branch);
  assert.equal(git(["rev-parse", `${pr2.branch}~1`], bare), pr1.head, "one commit on top of the merged PR 1");

  // With no demo-baseline tag, the baseline is main's root commit; with a ref, that ref.
  const dir = fs.mkdtempSync(path.join(tmp, "clone-"));
  git(["clone", "--quiet", bare, dir]);
  assert.equal(resolveBaseline(cfg, dir), git(["rev-list", "--max-parents=0", "main"], bare).split("\n").pop());
  assert.equal(resolveBaseline({ ...cfg, baselineRef: "origin/main" }, dir), git(["rev-parse", "main"], bare));
});
