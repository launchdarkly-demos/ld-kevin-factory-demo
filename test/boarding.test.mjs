import { test } from "node:test";
import assert from "node:assert/strict";

import { boardingLane, gateToSeatMs, upgradeOffer, LANES, UPGRADE_OFFER } from "../sim/boarding.mjs";
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

test("with enable-express-boarding off, every passenger boards by zone", async () => {
  await withFlags({}, async () => {
    const rng = mulberry32(1);
    for (let i = 1; i <= 200; i += 1) {
      const p = createPassenger(i, rng);
      assert.equal(await boardingLane(p), "zone");
    }
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

test("with enable-gate-upgrade-offers on, Plus and Elite passengers get an upgrade offer at the door; Basic passengers do not", async () => {
  await withFlags({ "enable-gate-upgrade-offers": true }, async () => {
    const rng = mulberry32(4);
    let offered = 0;
    let accepted = 0;
    for (let i = 1; i <= 300; i += 1) {
      const p = createPassenger(i, rng);
      const offer = await upgradeOffer(p, rng);
      if (p.tier === "basic") {
        assert.equal(offer, null);
        continue;
      }
      assert.ok(offer, `${p.tier} passenger should be offered an upgrade`);
      assert.equal(offer.tier, p.tier);
      offered += 1;
      if (offer.accepted) accepted += 1;
    }
    assert.ok(offered > 50, `offered ${offered}`);
    assert.ok(accepted > 0 && accepted < offered, `accepted ${accepted} of ${offered}`);
  });
});

test("with enable-gate-upgrade-offers off, no passenger gets an upgrade offer", async () => {
  await withFlags({}, async () => {
    const rng = mulberry32(4);
    for (let i = 1; i <= 300; i += 1) {
      const p = createPassenger(i, rng);
      assert.equal(await upgradeOffer(p, rng), null);
    }
  });
});

test("an upgrade offer takes between 2.5 and 4 simulated minutes", async () => {
  await withFlags({ "enable-gate-upgrade-offers": true }, async () => {
    const rng = mulberry32(5);
    const [lo, hi] = UPGRADE_OFFER.durationSimMs;
    for (let i = 1; i <= 200; i += 1) {
      const p = createPassenger(i, rng);
      const offer = await upgradeOffer(p, rng);
      if (!offer) continue;
      assert.ok(offer.durationSimMs >= lo && offer.durationSimMs <= hi, `${offer.durationSimMs} outside ${lo}..${hi}`);
    }
  });
});

test("an unknown lane falls back to zone timing", () => {
  const rng = mulberry32(3);
  const [lo, hi] = LANES.zone.gateToSeatSimMs;
  const ms = gateToSeatMs("not-a-lane", rng);
  assert.ok(ms >= lo && ms <= hi);
});
