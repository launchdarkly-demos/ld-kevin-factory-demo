/**
 * Flight Deck flag helper.
 *
 * Every feature decision in sim/ goes through isEnabled(), and every outcome a
 * guarded release should judge goes through track(). This is the only module
 * that talks to the LaunchDarkly SDK. It also records every evaluation, so the
 * deck can colour passengers and fill the altitude tape without knowing any
 * flag key in advance.
 *
 * Modes:
 *   live     LD_SDK_KEY is set and FLIGHT_DECK_OFFLINE is not. Streams from LaunchDarkly.
 *   offline  No key, or FLIGHT_DECK_OFFLINE=1. Every flag returns its fallback.
 *   test     Inside withFlags(). Evaluations come from the override map.
 */

import { AsyncLocalStorage } from "node:async_hooks";

const overrides = new AsyncLocalStorage();

const EVAL_WINDOW_MS = 30_000;
const CONTEXT_CAP = 5000;
const LOG_CAP = 100;

let client = null;
let mode = "offline";
let ready = false;
let onLog = () => {};

const byContext = new Map(); // contextKey -> { [flagKey]: boolean }
const byFlag = new Map(); // flagKey -> [{ at, contextKey, value }]
const flagMeta = new Map(); // flagKey -> { firstSeenAt, lastChangeAt, peakShare }
const recentLog = [];

function pushLog(kind, text) {
  const entry = { at: Date.now(), kind, text };
  recentLog.push(entry);
  if (recentLog.length > LOG_CAP) recentLog.shift();
  onLog(entry);
}

/**
 * Connect to LaunchDarkly, or settle into offline mode. Resolves once the SDK
 * has its first payload or has given up; the deck keeps running either way.
 */
export async function init({ sdkKey = "", offline = false, log, application } = {}) {
  if (typeof log === "function") onLog = log;
  if (offline || !sdkKey) {
    mode = "offline";
    ready = true;
    pushLog("sdk", "offline mode: every flag returns its fallback");
    return { mode, ready };
  }

  const LaunchDarkly = await import("@launchdarkly/node-server-sdk");
  // Application metadata tells LaunchDarkly which build is evaluating flags.
  // The version is the deployed commit, so a release can tell when the code
  // that carries a flag is actually running.
  const options = application ? { application } : {};
  client = LaunchDarkly.init(sdkKey, options);
  mode = "live";
  if (application) pushLog("sdk", `reporting as ${application.id} version ${application.version}`);

  client.on("update", ({ key }) => {
    const meta = flagMeta.get(key) || { firstSeenAt: Date.now(), lastChangeAt: null, peakShare: 0 };
    meta.lastChangeAt = Date.now();
    flagMeta.set(key, meta);
    pushLog("flag", `LaunchDarkly updated ${key}`);
  });
  client.on("error", (err) => pushLog("error", `SDK error: ${err && err.message ? err.message : err}`));

  try {
    await client.waitForInitialization({ timeout: 10 });
    ready = true;
    pushLog("sdk", "connected to LaunchDarkly, streaming flag changes");
  } catch (err) {
    ready = false;
    pushLog("error", `SDK did not initialise: ${err && err.message ? err.message : err}. Flags return fallbacks until it does.`);
  }
  return { mode, ready };
}

/** Flush analytics and disconnect. Safe to call in any mode. */
export async function close() {
  if (client) {
    await client.flush().catch(() => {});
    client.close();
    client = null;
  }
}

function record(flagKey, contextKey, value) {
  const at = Date.now();

  let ctx = byContext.get(contextKey);
  if (!ctx) {
    ctx = {};
    byContext.set(contextKey, ctx);
    if (byContext.size > CONTEXT_CAP) byContext.delete(byContext.keys().next().value);
  }
  ctx[flagKey] = value;

  let list = byFlag.get(flagKey);
  if (!list) {
    list = [];
    byFlag.set(flagKey, list);
    flagMeta.set(flagKey, { firstSeenAt: at, lastChangeAt: null, peakShare: 0 });
    pushLog("flag", `first evaluation of ${flagKey}`);
  }
  list.push({ at, contextKey, value });
  const cutoff = at - EVAL_WINDOW_MS * 2;
  while (list.length && list[0].at < cutoff) list.shift();
}

/**
 * Evaluate a boolean flag for one context. The fallback is the baseline
 * behaviour and is returned in offline mode, when the SDK is not ready, or when
 * the evaluation fails.
 *
 * @param {string} flagKey
 * @param {{ kind: string, key: string }} context  A LaunchDarkly context (passenger.context in sim/).
 * @param {boolean} [fallback=false]
 * @returns {Promise<boolean>}
 */
export async function isEnabled(flagKey, context, fallback = false) {
  const testMap = overrides.getStore();
  let value;
  if (testMap) {
    value = flagKey in testMap ? Boolean(testMap[flagKey]) : fallback;
  } else if (mode === "live" && client) {
    try {
      value = (await client.variation(flagKey, context, fallback)) === true;
    } catch (err) {
      pushLog("error", `evaluation of ${flagKey} failed: ${err && err.message ? err.message : err}`);
      value = fallback;
    }
  } else {
    value = fallback;
  }
  record(flagKey, context.key, value);
  return value;
}

/**
 * Send a metric event. Numeric metrics pass a value; occurrence metrics pass
 * none. No-op in offline and test modes.
 *
 * @param {string} eventKey
 * @param {{ kind: string, key: string }} context
 * @param {number} [metricValue]
 */
export function track(eventKey, context, metricValue) {
  if (mode !== "live" || !client || overrides.getStore()) return;
  if (metricValue === undefined) client.track(eventKey, context);
  else client.track(eventKey, context, undefined, metricValue);
}

/**
 * Run fn with flag evaluations answered from `map` instead of LaunchDarkly.
 * For tests. Works with async fn.
 *
 * @template T
 * @param {Record<string, boolean>} map
 * @param {() => T} fn
 * @returns {T}
 */
export function withFlags(map, fn) {
  return overrides.run({ ...map }, fn);
}

/** Flags evaluated for a context so far, as { [flagKey]: boolean }. */
export function flagsFor(contextKey) {
  return byContext.get(contextKey) || {};
}

// Flags still rolling out: share of true evaluations in the window is strictly
// between 0 and 100. A flag that has landed at 100% (or sits at 0%) no longer
// splits passengers into two paths, so the instruments ignore it.
let activeFlags = new Set();
let landedFlags = new Set(); // on for everyone in the window
let activeComputedAt = 0;

function refreshActive(now = Date.now()) {
  if (now - activeComputedAt < 2000) return;
  activeComputedAt = now;
  const cutoff = now - EVAL_WINDOW_MS;
  const next = new Set();
  const landed = new Set();
  for (const [key, list] of byFlag) {
    let total = 0;
    let trueCount = 0;
    for (let i = list.length - 1; i >= 0 && list[i].at >= cutoff; i -= 1) {
      total += 1;
      if (list[i].value) trueCount += 1;
    }
    if (total && trueCount > 0 && trueCount < total) next.add(key);
    if (total && trueCount === total) landed.add(key);
  }
  activeFlags = next;
  landedFlags = landed;
}

/** True when a flag that is still rolling out evaluated true for this context. */
export function onNewPath(contextKey) {
  const flags = byContext.get(contextKey);
  if (!flags) return false;
  refreshActive();
  for (const key in flags) if (flags[key] && activeFlags.has(key)) return true;
  return false;
}

/**
 * What the floor should show for this context: while a flag is rolling out,
 * the rolling flag decides; once everything has landed, passengers on a landed
 * flag stay on the new path (gold) until the next flag starts rolling.
 */
export function onShownPath(contextKey) {
  const flags = byContext.get(contextKey);
  if (!flags) return false;
  refreshActive();
  if (activeFlags.size) {
    for (const key in flags) if (flags[key] && activeFlags.has(key)) return true;
    return false;
  }
  for (const key in flags) if (flags[key] && landedFlags.has(key)) return true;
  return false;
}

/**
 * Per-flag share of recent evaluations that returned true, plus SDK status
 * and the recent log. Shares are measured over the last minute.
 */
export function snapshot(now = Date.now()) {
  const cutoff = now - EVAL_WINDOW_MS;
  const flags = [];
  for (const [key, list] of byFlag) {
    let total = 0;
    let trueCount = 0;
    for (let i = list.length - 1; i >= 0 && list[i].at >= cutoff; i -= 1) {
      total += 1;
      if (list[i].value) trueCount += 1;
    }
    const share = total ? Math.round((100 * trueCount) / total) : 0;
    const meta = flagMeta.get(key);
    if (meta && share > meta.peakShare) meta.peakShare = share;
    flags.push({
      key,
      total,
      trueCount,
      share,
      landed: total > 0 && trueCount === total,
      peakShare: meta ? meta.peakShare : share,
      lastChangeAt: meta ? meta.lastChangeAt : null,
      firstSeenAt: meta ? meta.firstSeenAt : null,
    });
  }
  flags.sort((a, b) => (b.lastChangeAt || b.firstSeenAt || 0) - (a.lastChangeAt || a.firstSeenAt || 0));
  return { mode, ready, flags, log: recentLog.slice(-40) };
}

/** Test hook: forget every recorded evaluation. */
export function resetRegistry() {
  byContext.clear();
  byFlag.clear();
  flagMeta.clear();
  recentLog.length = 0;
  activeFlags = new Set();
  landedFlags = new Set();
  activeComputedAt = 0;
}
