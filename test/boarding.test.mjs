import { test } from "node:test";
import assert from "node:assert/strict";

import { boardingLane, gateToSeatMs, LANES } from "../sim/boarding.mjs";
import { createPassenger } from "../sim/passenger.mjs";
import { mulberry32 } from "../sim/world.mjs";

test("every passenger boards through the zone lane", async () => {
  const rng = mulberry32(1);
  for (let i = 1; i <= 50; i += 1) {
    const p = createPassenger(i, rng);
    assert.equal(await boardingLane(p), "zone");
  }
});

test("gate-to-seat time stays inside the lane's range", () => {
  const rng = mulberry32(2);
  const [lo, hi] = LANES.zone.gateToSeatSimMs;
  for (let i = 0; i < 200; i += 1) {
    const ms = gateToSeatMs("zone", rng);
    assert.ok(ms >= lo && ms <= hi, `${ms} outside ${lo}..${hi}`);
  }
});

test("an unknown lane falls back to zone timing", () => {
  const rng = mulberry32(3);
  const [lo, hi] = LANES.zone.gateToSeatSimMs;
  const ms = gateToSeatMs("not-a-lane", rng);
  assert.ok(ms >= lo && ms <= hi);
});
