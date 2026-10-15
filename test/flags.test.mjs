import { test } from "node:test";
import assert from "node:assert/strict";

import { init, isEnabled, withFlags, flagsFor, onNewPath, onShownPath, snapshot, resetRegistry } from "../lib/flags.mjs";

const ctx = (key) => ({ kind: "user", key });

test("offline mode returns the fallback and records the evaluation", async () => {
  resetRegistry();
  await init({ offline: true });
  assert.equal(await isEnabled("enable-anything", ctx("pax-1"), false), false);
  assert.equal(await isEnabled("enable-anything", ctx("pax-2"), true), true);
  assert.deepEqual(flagsFor("pax-1"), { "enable-anything": false });
  assert.equal(onNewPath("pax-1"), false);
  assert.equal(onNewPath("pax-2"), true);
  const snap = snapshot();
  assert.equal(snap.mode, "offline");
  assert.equal(snap.flags.length, 1);
  assert.equal(snap.flags[0].total, 2);
  assert.equal(snap.flags[0].trueCount, 1);
});

test("withFlags answers from the override map, including async callers", async () => {
  resetRegistry();
  await withFlags({ "enable-express-boarding": true }, async () => {
    assert.equal(await isEnabled("enable-express-boarding", ctx("pax-3"), false), true);
    assert.equal(await isEnabled("enable-other", ctx("pax-3"), false), false);
  });
  await withFlags({}, async () => {
    assert.equal(await isEnabled("enable-express-boarding", ctx("pax-4"), false), false);
  });
  assert.equal(onNewPath("pax-3"), true);
  assert.equal(onNewPath("pax-4"), false);
});

test("a landed flag keeps its passengers on the shown path until another flag rolls", async () => {
  resetRegistry();
  await init({ offline: true });
  // enable-a is on for everyone: landed. Instruments ignore it; the floor keeps it gold.
  for (let i = 0; i < 20; i += 1) await isEnabled("enable-a", ctx(`pax-${i}`), true);
  assert.equal(onNewPath("pax-1"), false);
  assert.equal(onShownPath("pax-1"), true);
  // enable-b starts rolling at 50%: it decides the colour now.
  resetRegistry();
  for (let i = 0; i < 20; i += 1) await isEnabled("enable-a", ctx(`pax-${i}`), true);
  for (let i = 0; i < 20; i += 1) await isEnabled("enable-b", ctx(`pax-${i}`), i % 2 === 0);
  assert.equal(onShownPath("pax-0"), true);
  assert.equal(onShownPath("pax-1"), false);
  assert.equal(onNewPath("pax-0"), true);
  assert.equal(onNewPath("pax-1"), false);
});
