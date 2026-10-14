import { test } from "node:test";
import assert from "node:assert/strict";

import { boardingLane, gateToSeatMs, LANES } from "../sim/boarding.mjs";
import { createPassenger } from "../sim/passenger.mjs";
import { mulberry32 } from "../sim/world.mjs";
import { withFlags } from "../lib/flags.mjs";

test("with enable-express-boarding on, carry-on-only passengers take the express lane", async () => {
  await withFlags({ "enable-express-boarding": true }, async () => {
    const rng = mulberry32(1);
    let express = 0;
    let zone = 0;
    for (let i = 1; i <= 200; i += 1) {
      const p = createPassenger(i, rng);
      const lane = await boardingLane(p);
      if (p.bags === 0) {
        assert.equal(lane, "express");
        express += 1;
      } else {
        assert.equal(lane, "zone");
        zone += 1;
      }
    }
    assert.ok(express > 0 && zone > 0, "the sample should include both kinds of passenger");
  });
});

test("with enable-express-boarding off, every passenger boards through the zone lane", async () => {
  await withFlags({}, async () => {
    const rng = mulberry32(1);
    let carryOnOnly = 0;
    for (let i = 1; i <= 200; i += 1) {
      const p = createPassenger(i, rng);
      if (p.bags === 0) carryOnOnly += 1;
      assert.equal(await boardingLane(p), "zone");
    }
    assert.ok(carryOnOnly > 0, "the sample should include carry-on-only passengers");
  });
});

test("the express lane is faster than zone boarding", () => {
  const [expressLo, expressHi] = LANES.express.gateToSeatSimMs;
  const [zoneLo, zoneHi] = LANES.zone.gateToSeatSimMs;
  assert.ok(expressHi < zoneLo, "every express boarding should beat the fastest zone boarding");
  const rng = mulberry32(2);
  for (let i = 0; i < 200; i += 1) {
    const ms = gateToSeatMs("express", rng);
    assert.ok(ms >= expressLo && ms <= expressHi, `${ms} outside ${expressLo}..${expressHi}`);
  }
  assert.ok(zoneHi > zoneLo);
});

test("gate-to-seat time stays inside the zone lane's range", () => {
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
