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
  assert.deepEqual(off.missing, ["GITHUB_TOKEN", "GITHUB_REPO", "LD_API_KEY (or LD_API_TOKEN)", "LD_PROJECT_KEY"]);
  assert.equal(opsConfig({ GITHUB_TOKEN: "t", GITHUB_REPO: "o/r", LD_API_TOKEN: "depot", LD_PROJECT_KEY: "p" }).ldApiKey, "depot");
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

test("demo PRs open in a history-less copy by cherry-picking the template's demo branches, even after the App has committed to main", (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "flight-deck-ops-test-"));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

  // The template: this repo's history plus demo/pr1 and demo/pr2 built from the patches on HEAD,
  // exactly what scripts/update-demo-branches.sh pushes.
  const template = path.join(tmp, "template");
  git(["clone", "--quiet", process.cwd(), template]);
  git(["config", "user.name", "t"], template);
  git(["config", "user.email", "t@example.com"], template);
  git(["checkout", "--quiet", "--detach", "HEAD"], template);
  git(["am", "-3", "--quiet", path.join(process.cwd(), DEMO_PRS[1].patch)], template);
  git(["branch", "-f", "demo/pr1", "HEAD"], template);
  git(["am", "-3", "--quiet", path.join(process.cwd(), DEMO_PRS[2].patch)], template);
  git(["branch", "-f", "demo/pr2", "HEAD"], template);

  // The copy: one root commit holding HEAD's tree, no history.
  const bare = path.join(tmp, "copy.git");
  git(["init", "--quiet", "--bare", bare]);
  const squashed = git(["commit-tree", "HEAD^{tree}", "-m", "Initial commit"], process.cwd());
  git(["push", "--quiet", bare, `${squashed}:refs/heads/main`], process.cwd());
  const cfg = {
    ...opsConfig({ GITHUB_TOKEN: "t", GITHUB_REPO: "o/r", LD_API_KEY: "k", LD_PROJECT_KEY: "p" }),
    gitRemote: bare,
    gitTemplateRemote: template,
  };

  const pr1 = pushDemoBranch(cfg, 1);
  assert.equal(pr1.how, "cherry-pick of demo/pr1");
  assert.equal(git(["rev-parse", `${pr1.branch}~1`], bare), squashed, "one commit on top of the copy's root");

  // Merge PR 1, then let "the App" commit on main: a change to a file PR 2 also edits.
  const work = path.join(tmp, "work");
  git(["clone", "--quiet", bare, work]);
  git(["config", "user.name", "Vega"], work);
  git(["config", "user.email", "vega@example.com"], work);
  git(["merge", "--quiet", "--no-edit", `origin/${pr1.branch}`], work);
  fs.appendFileSync(path.join(work, "public/deck.js"), "\n// wrapped by the GitHub App\n");
  git(["commit", "--quiet", "-am", "Gate the express lane behind enable-express-boarding"], work);
  git(["push", "--quiet", "origin", "HEAD:main"], work);

  const pr2 = pushDemoBranch(cfg, 2);
  assert.equal(pr2.how, "cherry-pick of demo/pr2");
  assert.equal(git(["rev-parse", `${pr2.branch}~1`], bare), git(["rev-parse", "main"], bare), "one commit on top of the App's main");
  const tree = git(["ls-tree", "-r", "--name-only", pr2.branch], bare).split("\n");
  assert.ok(tree.includes("sim/boarding.mjs"));

  // Without the template, the patch path still works on a repo that has the history.
  const noTemplate = { ...cfg, gitTemplateRemote: "", gitRemote: template };
  git(["checkout", "--quiet", "-B", "main", git(["rev-parse", "HEAD"], process.cwd())], template);
  assert.equal(pushDemoBranch(noTemplate, 1).how, "patch");

  // With no demo-baseline tag, the baseline is main's root commit; with a ref, that ref.
  const dir = fs.mkdtempSync(path.join(tmp, "clone-"));
  git(["clone", "--quiet", bare, dir]);
  assert.equal(resolveBaseline(cfg, dir), squashed);
  assert.equal(resolveBaseline({ ...cfg, baselineRef: "origin/main" }, dir), git(["rev-parse", "main"], bare));
});
