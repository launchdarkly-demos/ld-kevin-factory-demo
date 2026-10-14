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
import { fileURLToPath } from "node:url";

import * as flags from "./lib/flags.mjs";
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

const CONFIG = {
  port: Number(process.env.PORT || 7777),
  sdkKey: (process.env.LD_SDK_KEY || "").trim(),
  projectKey: (process.env.LD_PROJECT_KEY || "").trim(),
  offline: process.env.FLIGHT_DECK_OFFLINE === "1" || !(process.env.LD_SDK_KEY || "").trim(),
  seed: Number(process.env.SIM_SEED || 7),
  rate: Number(process.env.SIM_RATE || TUNING.passengersPerSecond),
};

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

await flags.init({ sdkKey: CONFIG.sdkKey, offline: CONFIG.offline, log: addLog });

TUNING.passengersPerSecond = CONFIG.rate;
const world = new World({ seed: CONFIG.seed, log: addLog });
addLog({ kind: "deck", text: `simulation started, ${CONFIG.rate} passengers/s, seed ${CONFIG.seed}` });

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
// Autopilot status, derived from measured flag shares
// ---------------------------------------------------------------------------

function autopilot(flagSnapshot) {
  const lead = flagSnapshot.flags[0];
  if (!lead) return { lamp: "TAXI", flagKey: null, share: 0, detail: "no flags evaluated yet" };
  const { key, share, peakShare } = lead;
  if (share >= 95) return { lamp: "CRUISE", flagKey: key, share, detail: `${key} at ${share}%` };
  if (share > 0) return { lamp: "CLIMB", flagKey: key, share, detail: `${key} at ${share}%` };
  if (peakShare > 0) return { lamp: "DISENGAGED", flagKey: key, share, detail: `${key} rolled back from ${peakShare}%` };
  return { lamp: "TAXI", flagKey: key, share, detail: `${key} off for everyone` };
}

function state() {
  const flagSnapshot = flags.snapshot();
  return {
    version: VERSION,
    now: Date.now(),
    mode: flagSnapshot.mode,
    sdkReady: flagSnapshot.ready,
    projectKey: CONFIG.projectKey,
    world: world.snapshot(),
    flags: flagSnapshot.flags,
    autopilot: autopilot(flagSnapshot),
    log: flightLog.slice(-40),
  };
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
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405);
    return res.end();
  }
  const pathname = new URL(req.url, "http://localhost").pathname;
  if (pathname === "/api/state") return sendJson(res, 200, state());
  if (pathname === "/api/health") {
    return sendJson(res, 200, { ok: true, version: VERSION, mode: CONFIG.offline ? "offline" : "live", sdkReady: flags.snapshot().ready, uptimeSec: Math.round(process.uptime()) });
  }
  return serveStatic(req, res);
});

server.listen(CONFIG.port, () => {
  console.log(`[flight-deck] v${VERSION} listening on :${CONFIG.port} (${CONFIG.offline ? "offline" : "live"})`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, async () => {
    await flags.close();
    server.close();
    process.exit(0);
  });
}
