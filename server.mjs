/**
 * Flight Deck server.
 *
 * Runs the terminal simulation, evaluates flags through lib/flags.mjs, and
 * serves the deck page plus /api/state. Node stdlib only; the LaunchDarkly
 * server SDK is the single dependency.
 *
 * Configuration comes from ./.env, then the process environment (which wins).
 * See .env.example.
 */

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { exec, execSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import * as flags from "./lib/flags.mjs";
import { Autopilot } from "./lib/autopilot.mjs";
import * as ops from "./lib/ops.mjs";
import { World, TUNING } from "./sim/world.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(HERE, "public");

let VERSION = "unknown";
try {
  VERSION = JSON.parse(fs.readFileSync(path.join(HERE, "package.json"), "utf8")).version || VERSION;
} catch {
  /* leave unknown */
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

function loadDotEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const raw of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

loadDotEnv(path.join(HERE, ".env"));

/**
 * The deployed commit, for SDK application metadata and /api/health.
 * FLIGHT_DECK_COMMIT wins (set it in a container build); otherwise ask git.
 */
function deployedCommit() {
  if (process.env.FLIGHT_DECK_COMMIT) return process.env.FLIGHT_DECK_COMMIT.trim();
  try {
    return execSync("git rev-parse HEAD", { cwd: HERE, stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return "unknown";
  }
}

const CONFIG = {
  port: Number(process.env.PORT || 7777),
  commit: deployedCommit(),
  sdkKey: (process.env.LD_SDK_KEY || "").trim(),
  projectKey: (process.env.LD_PROJECT_KEY || "").trim(),
  offline: process.env.FLIGHT_DECK_OFFLINE === "1" || !(process.env.LD_SDK_KEY || "").trim(),
  seed: Number(process.env.SIM_SEED || 7),
  rate: Number(process.env.SIM_RATE || TUNING.passengersPerSecond),
};

// Operate menu: GitHub and LaunchDarkly actions fired from the page. Enabled
// only when every token it needs is present (lib/ops.mjs lists them). When
// FLIGHT_DECK_OPS_TOKEN is set, requests must carry it in an X-Ops-Token header.
const OPS = ops.opsConfig();
const OPS_TOKEN = (process.env.FLIGHT_DECK_OPS_TOKEN || "").trim();
// Set by scripts/launch.mjs when a Demo Depot launch could not provision its repo or project.
const LAUNCH_ERROR = (process.env.FLIGHT_DECK_LAUNCH_ERROR || "").trim();

// ---------------------------------------------------------------------------
// Flight log, flags, world
// ---------------------------------------------------------------------------

const LOG_CAP = 80;
const flightLog = [];
function addLog(entry) {
  const item = { at: entry.at || Date.now(), kind: entry.kind, text: entry.text };
  flightLog.push(item);
  if (flightLog.length > LOG_CAP) flightLog.shift();
  console.log(`[flight-deck] ${item.kind}: ${item.text}`);
}

await flags.init({
  sdkKey: CONFIG.sdkKey,
  offline: CONFIG.offline,
  log: addLog,
  application: { id: "flight-deck", version: CONFIG.commit },
});

TUNING.passengersPerSecond = CONFIG.rate;
const world = new World({ seed: CONFIG.seed, log: addLog });
addLog({ kind: "deck", text: `simulation started, ${CONFIG.rate} passengers/s, seed ${CONFIG.seed}` });
if (LAUNCH_ERROR) addLog({ kind: "error", text: `launch provisioning failed: ${LAUNCH_ERROR}` });

const TICK_MS = 100;
let lastTick = Date.now();
setInterval(() => {
  const now = Date.now();
  const dt = Math.min(0.25, (now - lastTick) / 1000);
  lastTick = now;
  try {
    world.tick(dt);
  } catch (err) {
    addLog({ kind: "error", text: `tick failed: ${err && err.message ? err.message : err}` });
  }
}, TICK_MS).unref();

// ---------------------------------------------------------------------------
// Stale-code check and self-deploy. The deck only picks up merged code on a
// restart, and a deck running pre-merge code never evaluates the new flag,
// which stalls the whole demo silently. Every 30 seconds, compare the running
// commit with origin/main. When behind, and running from a clean `main`
// checkout, pull and restart (the "deploy" happens because the merge did).
// Otherwise keep the banner up and leave the operator to run scripts/deploy.sh.
// Set FLIGHT_DECK_AUTO_DEPLOY=0 to only warn.
// ---------------------------------------------------------------------------

const AUTO_DEPLOY = process.env.FLIGHT_DECK_AUTO_DEPLOY !== "0";
const DEPLOY_HINT = OPS.enabled ? "Use Operate > Redeploy" : "Run scripts/deploy.sh";
const code = { commit: CONFIG.commit, originMain: null, behind: null, checkedAt: null, autoDeploy: AUTO_DEPLOY, deploying: false };
let blockedReason = null;

function git(cmd) {
  return execSync(`git ${cmd}`, { cwd: HERE, stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
}

function checkCode() {
  // ls-remote reads the remote without updating any local ref, so this check
  // never races a git command the operator is running in the same checkout.
  // An unknown remote commit cannot be an ancestor of HEAD, so it reads as behind.
  const cmd = "sha=$(git ls-remote --quiet origin refs/heads/main | cut -f1) && echo \"$sha\" && (git merge-base --is-ancestor \"$sha\" HEAD 2>/dev/null && echo current || echo behind)";
  exec(cmd, { cwd: HERE, timeout: 20000 }, (err, stdout) => {
    code.checkedAt = Date.now();
    if (err) {
      code.behind = null; // could not tell (offline, no credentials); say nothing
      return;
    }
    const [originMain, verdict] = stdout.trim().split("\n");
    if (!originMain) {
      code.behind = null;
      return;
    }
    const wasBehind = code.behind;
    code.originMain = originMain;
    code.behind = verdict === "behind";
    if (!code.behind) {
      blockedReason = null;
      return;
    }
    if (AUTO_DEPLOY) autoDeploy(originMain);
    else if (wasBehind !== true) {
      addLog({ kind: "error", text: `deck is running ${code.commit.slice(0, 7)} but main is at ${originMain.slice(0, 7)}: ${DEPLOY_HINT}` });
    }
  });
}

/** Why this checkout cannot be moved to origin/main by the deck itself, or null. */
function deployBlocker() {
  try {
    const branch = git("branch --show-current");
    if (branch !== "main") return `checked out ${branch || "a detached commit"}, not main`;
    if (git("status --porcelain --untracked-files=no")) return "working tree has local changes";
  } catch (err) {
    return `git failed: ${err && err.message ? err.message : err}`;
  }
  return null;
}

function autoDeploy(target) {
  if (code.deploying) return;
  const reason = deployBlocker();
  if (reason) {
    if (reason !== blockedReason) {
      blockedReason = reason;
      addLog({ kind: "error", text: `main is at ${target.slice(0, 7)} but not deploying: ${reason}. ${DEPLOY_HINT}` });
    }
    return;
  }
  code.deploying = true;
  addLog({ kind: "deck", text: `main moved to ${target.slice(0, 7)}: deploying` });
  exec("git pull -q --ff-only origin main", { cwd: HERE, timeout: 60000 }, (err) => {
    if (err) {
      code.deploying = false;
      addLog({ kind: "error", text: `pull failed: ${err.message.split("\n")[0]}. ${DEPLOY_HINT}` });
      return;
    }
    restartSelf();
  });
}

/**
 * Hand the port to a fresh copy of this process on the new code, then exit.
 * Under a supervisor (docker-entrypoint.sh sets FLIGHT_DECK_SUPERVISED) exit
 * with 75 instead and let it start the next copy: a detached child would not
 * keep a container alive once PID 1 is gone.
 */
const RESTART_EXIT_CODE = 75;
function restartSelf() {
  addLog({ kind: "deck", text: "restarting on the new code" });
  const relaunch = () => {
    if (process.env.FLIGHT_DECK_SUPERVISED === "1") process.exit(RESTART_EXIT_CODE);
    const child = spawn(process.execPath, [fileURLToPath(import.meta.url)], { cwd: HERE, detached: true, stdio: "inherit", env: process.env });
    child.unref();
    process.exit(0);
  };
  try {
    server.closeAllConnections();
  } catch {
    /* older Node */
  }
  server.close(() => flags.close().finally(relaunch));
  setTimeout(relaunch, 3000).unref(); // do not hang on a stubborn connection
}

if (!process.env.FLIGHT_DECK_NO_CODE_CHECK) {
  setTimeout(checkCode, 5000).unref();
  setInterval(checkCode, 30_000).unref();
}

// ---------------------------------------------------------------------------
// Autopilot status, derived from measured flag shares. Updated on a timer so
// the flight log records steps and rollbacks even with no browser attached.
// ---------------------------------------------------------------------------

const autopilot = new Autopilot(addLog);
let autopilotState = autopilot.update([]);
setInterval(() => {
  try {
    autopilotState = autopilot.update(flags.snapshot().flags);
  } catch (err) {
    addLog({ kind: "error", text: `autopilot update failed: ${err && err.message ? err.message : err}` });
  }
}, 2000).unref();

function state() {
  const flagSnapshot = flags.snapshot();
  return {
    version: VERSION,
    now: Date.now(),
    mode: flagSnapshot.mode,
    sdkReady: flagSnapshot.ready,
    code,
    ops: { enabled: OPS.enabled, missing: OPS.missing, tokenRequired: Boolean(OPS_TOKEN), busy: opsBusy, deployHint: DEPLOY_HINT, launchError: LAUNCH_ERROR || null },
    projectKey: CONFIG.projectKey,
    world: world.snapshot(),
    flags: flagSnapshot.flags,
    autopilot: autopilotState,
    log: flightLog.slice(-40),
  };
}

// ---------------------------------------------------------------------------
// Operate menu actions. One at a time; every outcome goes to the flight log so
// the room sees "opened PR #22" next to the passengers it affects.
// ---------------------------------------------------------------------------

let opsBusy = null; // name of the action running, or null

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 65536) reject(new Error("body too large"));
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error("body is not JSON"));
      }
    });
    req.on("error", reject);
  });
}

/** Move this checkout to origin/main (even when main went backwards) and restart. */
function redeploy({ hard = false } = {}) {
  const reason = deployBlocker();
  if (reason) throw new Error(`cannot redeploy from this checkout: ${reason}`);
  if (code.deploying) return { note: "already deploying" };
  code.deploying = true;
  const cmd = hard ? "git fetch -q origin main && git reset -q --hard FETCH_HEAD" : "git pull -q --ff-only origin main";
  exec(cmd, { cwd: HERE, timeout: 60000 }, (err) => {
    if (err) {
      code.deploying = false;
      addLog({ kind: "error", text: `redeploy failed: ${err.message.split("\n")[0]}` });
      return;
    }
    restartSelf();
  });
  return { restarting: true };
}

const OPS_ACTIONS = {
  "open-pr": async (body) => {
    const which = Number(body.which);
    const r = await ops.openPr(OPS, which);
    addLog({ kind: "ops", text: r.note ? `PR #${r.number} is already open` : `opened PR #${r.number}: ${r.url}` });
    return r;
  },
  comment: async (body) => {
    const number = Number(body.pr);
    const text = String(body.body || "").trim();
    if (!number || !text) throw new Error("comment needs pr and body");
    if (!/^@launchdarkly\s/.test(text)) throw new Error("only @launchdarkly commands can be posted from the deck");
    const r = await ops.comment(OPS, number, text);
    addLog({ kind: "ops", text: `commented "${text}" on PR #${number}` });
    return r;
  },
  merge: async (body) => {
    const number = Number(body.pr);
    if (!number) throw new Error("merge needs pr");
    const r = await ops.merge(OPS, number);
    addLog({ kind: "ops", text: `merged PR #${number} (${String(r.sha).slice(0, 7)}); the deck redeploys when it sees main move` });
    return r;
  },
  "flag-on": async (body) => {
    const key = String(body.key || "").trim();
    if (!key) throw new Error("flag-on needs key");
    const r = await ops.flagOn(OPS, key);
    addLog({ kind: "ops", text: `turned ${key} on, default rule serving ${r.serving}: the release engine can start` });
    return r;
  },
  reset: async () => {
    const r = await ops.reset(OPS);
    addLog({
      kind: "ops",
      text: `reset: closed ${r.closedPrs.length} PR(s), deleted ${r.deletedBranches.length} branch(es) and ${r.deletedFlags.length} flag(s), main at ${r.main}`,
    });
    flags.resetRegistry();
    try {
      Object.assign(r, redeploy({ hard: true }));
    } catch (err) {
      addLog({ kind: "error", text: `${err.message}. Restart the deck on the new main by hand` });
      r.restartNeeded = true;
    }
    return r;
  },
  redeploy: async () => {
    const r = redeploy({ hard: true });
    addLog({ kind: "ops", text: "redeploying from origin/main" });
    return r;
  },
};

async function handleOps(req, res, pathname) {
  const action = pathname.slice("/api/ops/".length);
  if (!OPS.enabled) return sendJson(res, 503, { error: `Operate is off: set ${OPS.missing.join(", ")}` });
  if (OPS_TOKEN && req.headers["x-ops-token"] !== OPS_TOKEN) return sendJson(res, 401, { error: "wrong or missing X-Ops-Token" });
  if (action === "status") {
    if (req.method !== "GET") return sendJson(res, 405, { error: "GET only" });
    try {
      return sendJson(res, 200, { ...(await ops.status(OPS)), busy: opsBusy });
    } catch (err) {
      return sendJson(res, 502, { error: err.message });
    }
  }
  if (req.method !== "POST") return sendJson(res, 405, { error: "POST only" });
  const run = OPS_ACTIONS[action];
  if (!run) return sendJson(res, 404, { error: `unknown action ${action}` });
  if (opsBusy) return sendJson(res, 409, { error: `${opsBusy} is still running` });
  opsBusy = action;
  try {
    const body = await readJsonBody(req);
    const result = await run(body || {});
    return sendJson(res, 200, { ok: true, action, result });
  } catch (err) {
    const message = err && err.message ? err.message : String(err);
    addLog({ kind: "error", text: `${action} failed: ${message}` });
    return sendJson(res, 500, { error: message });
  } finally {
    opsBusy = null;
  }
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

function sendJson(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}

function serveStatic(req, res) {
  const url = new URL(req.url, "http://localhost");
  let rel = decodeURIComponent(url.pathname);
  if (rel === "/") rel = "/index.html";
  const abs = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!abs.startsWith(PUBLIC_DIR + path.sep)) {
    res.writeHead(403);
    return res.end();
  }
  fs.readFile(abs, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      return res.end("not found");
    }
    res.writeHead(200, { "Content-Type": MIME[path.extname(abs)] || "application/octet-stream", "Cache-Control": "no-cache" });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  const pathname = new URL(req.url, "http://localhost").pathname;
  if (pathname.startsWith("/api/ops/")) return handleOps(req, res, pathname);
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405);
    return res.end();
  }
  if (pathname === "/api/state") return sendJson(res, 200, state());
  if (pathname === "/api/health") {
    return sendJson(res, 200, {
      ok: true,
      version: VERSION,
      commit: CONFIG.commit,
      originMain: code.originMain,
      codeBehindMain: code.behind,
      mode: CONFIG.offline ? "offline" : "live",
      sdkReady: flags.snapshot().ready,
      uptimeSec: Math.round(process.uptime()),
    });
  }
  return serveStatic(req, res);
});

server.listen(CONFIG.port, () => {
  console.log(`[flight-deck] v${VERSION} listening on :${CONFIG.port} (${CONFIG.offline ? "offline" : "live"})`);
});

let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, async () => {
    if (stopping) return;
    stopping = true;
    try {
      server.closeAllConnections();
    } catch {
      /* older Node */
    }
    server.close();
    await flags.close();
    process.exit(0);
  });
}
