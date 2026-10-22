/**
 * Operator actions for the deck's Operate menu.
 *
 * Everything an SE used to do from a terminal, callable from the browser:
 * open a demo pull request, talk to the GitHub App, merge, turn the flag on
 * serving the baseline, reset the environment. Each action talks to GitHub
 * and LaunchDarkly with tokens from the environment and returns a short
 * result for the flight log. Nothing here touches the running simulation.
 *
 * Environment:
 *   GITHUB_TOKEN             token with repo scope on GITHUB_REPO (opens PRs, comments, merges, force-pushes main)
 *   GITHUB_REPO              owner/name
 *   LD_API_KEY               LaunchDarkly API token (flag writes and deletes on LD_PROJECT_KEY)
 *   LD_PROJECT_KEY, LD_ENV_KEY (default production)
 *   FLIGHT_DECK_BASELINE_REF the commit main is reset to (default: tag demo-baseline, else main's root commit)
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

export function opsConfig(env = process.env) {
  const cfg = {
    githubToken: (env.GITHUB_TOKEN || "").trim(),
    repo: (env.GITHUB_REPO || "").trim(),
    // LD_API_TOKEN is what Demo Depot injects with `apiToken: project-writer`.
    ldApiKey: (env.LD_API_KEY || env.LD_API_TOKEN || "").trim(),
    projectKey: (env.LD_PROJECT_KEY || "").trim(),
    envKey: (env.LD_ENV_KEY || "production").trim(),
    baselineRef: (env.FLIGHT_DECK_BASELINE_REF || "").trim(),
    // The repo this one was copied from. A copy made from a template has no
    // history, so `git am -3` cannot find the blobs a patch was written
    // against; fetching the template's branches first gives it those blobs.
    templateRepo: (env.FLIGHT_DECK_TEMPLATE_REPO || "").trim(),
    gitRemote: (env.FLIGHT_DECK_GIT_REMOTE || "").trim(), // tests point this at a local bare repo
    gitTemplateRemote: (env.FLIGHT_DECK_GIT_TEMPLATE_REMOTE || "").trim(),
  };
  const missing = [];
  if (!cfg.githubToken) missing.push("GITHUB_TOKEN");
  if (!cfg.repo) missing.push("GITHUB_REPO");
  if (!cfg.ldApiKey) missing.push("LD_API_KEY (or LD_API_TOKEN)");
  if (!cfg.projectKey) missing.push("LD_PROJECT_KEY");
  return { ...cfg, enabled: missing.length === 0, missing };
}

// ---- HTTP helpers -----------------------------------------------------------

async function gh(cfg, method, route, body) {
  const res = await fetch(`https://api.github.com${route}`, {
    method,
    headers: {
      Authorization: `Bearer ${cfg.githubToken}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "flight-deck",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return null;
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(`GitHub ${res.status} ${method} ${route}: ${(data && data.message) || text.slice(0, 200)}`);
  return data;
}

async function ld(cfg, method, route, body, contentType = "application/json") {
  const res = await fetch(`https://app.launchdarkly.com${route}`, {
    method,
    headers: { Authorization: cfg.ldApiKey, "Content-Type": contentType, "User-Agent": "flight-deck" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return null;
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(`LaunchDarkly ${res.status} ${method} ${route}: ${(data && data.message) || text.slice(0, 200)}`);
  return data;
}

function git(args, cwd) {
  return execFileSync("git", args, { cwd, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } }).toString().trim();
}

function remoteUrl(cfg) {
  return cfg.gitRemote || `https://x-access-token:${cfg.githubToken}@github.com/${cfg.repo}.git`;
}

function templateRemoteUrl(cfg) {
  if (cfg.gitTemplateRemote) return cfg.gitTemplateRemote;
  if (cfg.templateRepo && cfg.templateRepo !== cfg.repo) return `https://x-access-token:${cfg.githubToken}@github.com/${cfg.templateRepo}.git`;
  return null;
}

/** Bring the template's history into a clone so 3-way patch application has its base blobs. */
function fetchTemplateHistory(cfg, dir) {
  const url = templateRemoteUrl(cfg);
  if (!url) return;
  try {
    git(["fetch", "--quiet", url, "+refs/heads/*:refs/remotes/template/*"], dir);
  } catch {
    /* best effort: the patch may still apply cleanly */
  }
}

/** Clone of the demo repo in a temp dir (full history: `git am -3` needs the base blobs). Caller removes it. */
function cloneRepo(cfg) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "flight-deck-ops-"));
  git(["clone", "--quiet", remoteUrl(cfg), dir]);
  git(["config", "user.name", "Flight Deck"], dir);
  git(["config", "user.email", "flight-deck@users.noreply.github.com"], dir);
  return dir;
}

// ---- The stored demo PRs ----------------------------------------------------

export const DEMO_PRS = {
  1: { patch: "demo/patches/pr1-express-boarding.patch", body: "demo/pr1.md", branch: "express-boarding", templateBranch: "demo/pr1" },
  2: { patch: "demo/patches/pr2-upgrade-offers.patch", body: "demo/pr2.md", branch: "gate-upgrade-offers", templateBranch: "demo/pr2" },
};

/** Split a demo/prN.md file into { title, description }. The first line is the title; a `---` line separates. */
export function parsePrBody(text) {
  const lines = text.split(/\r?\n/);
  const title = lines[0].trim();
  const sep = lines.indexOf("---");
  const description = lines.slice(sep >= 0 ? sep + 1 : 1).join("\n").trim();
  return { title, description };
}

// ---- Actions ----------------------------------------------------------------

/** What the Operate menu needs to know: open PRs with the app's latest word, flags in the project. */
export async function status(cfg) {
  const [pulls, flags] = await Promise.all([
    gh(cfg, "GET", `/repos/${cfg.repo}/pulls?state=open&per_page=10`),
    ld(cfg, "GET", `/api/v2/flags/${cfg.projectKey}?env=${cfg.envKey}&summary=true`).catch((err) => ({ items: [], error: err.message })),
  ]);
  const prs = [];
  for (const p of pulls) {
    const comments = await gh(cfg, "GET", `/repos/${cfg.repo}/issues/${p.number}/comments?per_page=50`);
    const fromApp = comments.filter((c) => /launchdarkly/i.test(c.user.login) && c.user.type === "Bot");
    const last = fromApp[fromApp.length - 1];
    let stage = "waiting for the app";
    if (last) {
      const head = last.body.split("\n")[0];
      if (/Plan applied/i.test(head)) stage = "plan applied: ready to merge";
      else if (/suggests no changes/i.test(head)) stage = "app declined: refine";
      else if (/couldn't resolve your LaunchDarkly project/i.test(head)) stage = "app could not resolve the project: retry plan";
      else if (/question/i.test(head)) stage = "app asked a question";
      else if (/suggests some changes|Feature flag recommended/i.test(head)) stage = "plan proposed: approve";
      else stage = head.replace(/\*/g, "").slice(0, 60);
    }
    prs.push({ number: p.number, title: p.title, url: p.html_url, branch: p.head.ref, stage, mergeable: p.mergeable });
  }
  const flagList = (flags.items || []).map((f) => {
    const env = (f.environments || {})[cfg.envKey] || {};
    return { key: f.key, on: env.on === true };
  });
  return { repo: cfg.repo, project: cfg.projectKey, environment: cfg.envKey, prs, flags: flagList, flagsError: flags.error || null };
}

/**
 * Put demo PR 1 or 2 onto a branch from origin/main and force-push it.
 *
 * Preferred: cherry-pick the commit from the template's `demo/prN` branch
 * (scripts/update-demo-branches.sh keeps those built from the patches on the
 * baseline). A cherry-pick has a real merge base, the commit's parent, so it
 * copes with whatever the GitHub App committed to main in the meantime; a
 * patch only carries blob ids that a history-less copy never had. Fallback:
 * `git am -3` of the stored patch, which is enough on the original repo.
 */
export function pushDemoBranch(cfg, which) {
  const spec = DEMO_PRS[which];
  if (!spec) throw new Error(`unknown demo PR ${which}`);
  const dir = cloneRepo(cfg);
  try {
    fetchTemplateHistory(cfg, dir);
    git(["checkout", "--quiet", "-B", spec.branch, "origin/main"], dir);
    const templateRef = `refs/remotes/template/${spec.templateBranch}`;
    let how;
    if (refExists(dir, templateRef)) {
      how = `cherry-pick of ${spec.templateBranch}`;
      try {
        git(["cherry-pick", "--allow-empty", templateRef], dir);
      } catch (err) {
        git(["cherry-pick", "--abort"], dir);
        throw new Error(`PR ${which} conflicts with what is on main (${firstLine(err)}). Main still carries an earlier run's code: reset the demo first`);
      }
    } else {
      how = "patch";
      const patchFile = path.join(dir, ".flight-deck.patch");
      fs.writeFileSync(patchFile, fs.readFileSync(path.join(HERE, spec.patch), "utf8"));
      try {
        git(["am", "-3", patchFile], dir);
      } catch (err) {
        throw new Error(`patch for PR ${which} does not apply onto main (${firstLine(err)}). Main still carries an earlier run's code: reset the demo first`);
      }
      fs.unlinkSync(patchFile);
    }
    git(["push", "--quiet", "--force", "-u", "origin", spec.branch], dir);
    return { branch: spec.branch, head: git(["rev-parse", "HEAD"], dir), how };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function refExists(dir, ref) {
  try {
    git(["rev-parse", "--verify", "--quiet", ref], dir);
    return true;
  } catch {
    return false;
  }
}

function firstLine(err) {
  return err.stderr ? err.stderr.toString().trim().split("\n")[0] : err.message;
}

/** Open demo PR 1 or 2 from the stored patch, on a fresh branch from origin/main. */
export async function openPr(cfg, which) {
  const spec = DEMO_PRS[which];
  if (!spec) throw new Error(`unknown demo PR ${which}`);
  const { title, description } = parsePrBody(fs.readFileSync(path.join(HERE, spec.body), "utf8"));
  const existing = await gh(cfg, "GET", `/repos/${cfg.repo}/pulls?state=open&head=${cfg.repo.split("/")[0]}:${spec.branch}`);
  if (existing.length) return { number: existing[0].number, url: existing[0].html_url, note: "already open" };
  pushDemoBranch(cfg, which);
  const pr = await gh(cfg, "POST", `/repos/${cfg.repo}/pulls`, { title, body: description, head: spec.branch, base: "main" });
  return { number: pr.number, url: pr.html_url };
}

/** Post a comment on a PR, for example `@launchdarkly approve`. */
export async function comment(cfg, number, body) {
  const c = await gh(cfg, "POST", `/repos/${cfg.repo}/issues/${number}/comments`, { body });
  return { url: c.html_url };
}

export async function merge(cfg, number) {
  const r = await gh(cfg, "PUT", `/repos/${cfg.repo}/pulls/${number}/merge`, { merge_method: "merge" });
  return { sha: r.sha, merged: r.merged };
}

/**
 * Turn a flag on in the environment with the default rule serving the
 * baseline (the flag's off variation), which is the handoff that lets the
 * release engine start. A semantic patch, so nothing else on the flag moves.
 */
export async function flagOn(cfg, key) {
  const flag = await ld(cfg, "GET", `/api/v2/flags/${cfg.projectKey}/${key}?env=${cfg.envKey}`);
  const env = flag.environments[cfg.envKey];
  const baseline = flag.variations[env.offVariation];
  if (!baseline) throw new Error(`flag ${key} has no off variation to use as the baseline`);
  await ld(
    cfg,
    "PATCH",
    `/api/v2/flags/${cfg.projectKey}/${key}`,
    {
      environmentKey: cfg.envKey,
      instructions: [{ kind: "turnFlagOn" }, { kind: "updateFallthroughVariationOrRollout", variationId: baseline._id }],
    },
    "application/json; domain-model=launchdarkly.semanticpatch",
  );
  return { key, on: true, serving: baseline.name || String(baseline.value) };
}

/** The commit main returns to on reset. */
export function resolveBaseline(cfg, dir) {
  if (cfg.baselineRef) return git(["rev-parse", `${cfg.baselineRef}^{commit}`], dir);
  try {
    return git(["rev-parse", "demo-baseline^{commit}"], dir);
  } catch {
    // Repos created from a template have one root commit: the baseline.
    return git(["rev-list", "--max-parents=0", "origin/main"], dir).split("\n").pop();
  }
}

/**
 * Reset the environment: close open demo PRs, delete their branches, force
 * main back to the baseline, delete every flag in the project. Returns what
 * it did. The caller restarts the deck on the new main.
 */
export async function reset(cfg) {
  const done = { closedPrs: [], deletedBranches: [], main: null, deletedFlags: [] };
  const pulls = await gh(cfg, "GET", `/repos/${cfg.repo}/pulls?state=open&per_page=50`);
  for (const p of pulls) {
    await gh(cfg, "POST", `/repos/${cfg.repo}/issues/${p.number}/comments`, { body: "Demo reset." });
    await gh(cfg, "PATCH", `/repos/${cfg.repo}/pulls/${p.number}`, { state: "closed" });
    done.closedPrs.push(p.number);
  }
  const branches = await gh(cfg, "GET", `/repos/${cfg.repo}/branches?per_page=100`);
  for (const b of branches) {
    if (["main", "develop"].includes(b.name)) continue;
    if (!Object.values(DEMO_PRS).some((s) => s.branch === b.name)) continue;
    await gh(cfg, "DELETE", `/repos/${cfg.repo}/git/refs/heads/${b.name}`);
    done.deletedBranches.push(b.name);
  }
  const dir = cloneRepo(cfg);
  try {
    git(["fetch", "--quiet", "--tags", "origin"], dir);
    const base = resolveBaseline(cfg, dir);
    git(["push", "--quiet", "--force", "origin", `${base}:refs/heads/main`], dir);
    done.main = base.slice(0, 7);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  const flags = await ld(cfg, "GET", `/api/v2/flags/${cfg.projectKey}?summary=true`);
  for (const f of flags.items || []) {
    await ld(cfg, "DELETE", `/api/v2/flags/${cfg.projectKey}/${f.key}`);
    done.deletedFlags.push(f.key);
  }
  return done;
}
