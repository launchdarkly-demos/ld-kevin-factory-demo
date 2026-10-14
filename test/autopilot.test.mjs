import { test } from "node:test";
import assert from "node:assert/strict";

import { Autopilot } from "../lib/autopilot.mjs";

const flag = (key, share, peakShare = share) => ({ key, share, peakShare, total: 100, lastChangeAt: Date.now(), firstSeenAt: Date.now() });

test("a rollout climbs to cruise and logs each step once", () => {
  const log = [];
  const ap = new Autopilot((e) => log.push(e.text));
  assert.equal(ap.update([]).lamp, "TAXI");
  assert.equal(ap.update([flag("enable-x", 0)]).lamp, "TAXI");
  assert.equal(ap.update([flag("enable-x", 6)]).lamp, "CLIMB");
  assert.equal(ap.update([flag("enable-x", 9)]).lamp, "CLIMB"); // window noise just under 10%
  ap.update([flag("enable-x", 12)]);
  ap.update([flag("enable-x", 26)]);
  ap.update([flag("enable-x", 51)]);
  assert.equal(ap.update([flag("enable-x", 100)]).lamp, "CRUISE");
  ap.update([flag("enable-x", 100)]);
  assert.deepEqual(log, [
    "autopilot engaged: enable-x release started",
    "enable-x climbing: 10% of passengers on the new path",
    "enable-x climbing: 25% of passengers on the new path",
    "enable-x climbing: 50% of passengers on the new path",
    "enable-x at 100%: cruise",
  ]);
});

test("a rollback reads as disengaged and is logged once", () => {
  const log = [];
  const ap = new Autopilot((e) => log.push(e.text));
  ap.update([flag("enable-y", 10)]);
  ap.update([flag("enable-y", 24)]);
  const r = ap.update([flag("enable-y", 0, 24)]);
  assert.equal(r.lamp, "DISENGAGED");
  assert.match(r.detail, /rolled back from 24%/);
  ap.update([flag("enable-y", 0, 24)]);
  assert.equal(log.filter((t) => t.startsWith("autopilot disengaged")).length, 1);
});

test("the lead flag is the first in the list", () => {
  const ap = new Autopilot();
  const r = ap.update([flag("enable-new", 10), flag("enable-old", 100)]);
  assert.equal(r.flagKey, "enable-new");
  assert.equal(r.lamp, "CLIMB");
});
