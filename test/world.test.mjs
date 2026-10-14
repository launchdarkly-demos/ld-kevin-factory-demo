import { test } from "node:test";
import assert from "node:assert/strict";

import { World, TUNING } from "../sim/world.mjs";
import { init, resetRegistry } from "../lib/flags.mjs";

/** Run the world for `seconds` of real time in 100 ms ticks, letting async decisions settle. */
async function run(world, seconds) {
  for (let i = 0; i < seconds * 10; i += 1) {
    world.tick(0.1);
    if (i % 5 === 0) await new Promise((r) => setImmediate(r));
  }
  await new Promise((r) => setImmediate(r));
}

test("passengers flow through the terminal and board", async () => {
  resetRegistry();
  await init({ offline: true });
  const logs = [];
  const world = new World({ seed: 11, log: (e) => logs.push(e) });
  await run(world, 120);

  const c = world.counters;
  assert.ok(c.spawned > 200, `spawned ${c.spawned}`);
  assert.ok(c.boarded > 50, `boarded ${c.boarded}`);
  assert.ok(c.departures > 0, `departures ${c.departures}`);

  const snap = world.snapshot();
  for (const p of snap.passengers) {
    assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y), `passenger ${p.id} has a bad position`);
    assert.equal(p.path, "baseline");
  }
  assert.equal(snap.gates.length, 8);
  assert.ok(logs.some((e) => e.kind === "flight"), "flights should write to the log");
});

test("the baseline miss rate is low", async () => {
  resetRegistry();
  await init({ offline: true });
  const world = new World({ seed: 23 });
  await run(world, 120);
  const { boarded, missed } = world.counters;
  const rate = missed / (boarded + missed);
  assert.ok(boarded + missed > 100, `too few outcomes: ${boarded + missed}`);
  assert.ok(rate < 0.08, `baseline miss rate ${(rate * 100).toFixed(1)}% is too high`);
});

test("delayed flights hold their gate in the baseline", async () => {
  resetRegistry();
  await init({ offline: true });
  const world = new World({ seed: 5 });
  await run(world, 120);
  assert.ok(world.counters.delays > 0, "expected at least one delay");
  assert.equal(world.counters.gateChanges, 0);
});

test("tuning can slow the spawn rate", async () => {
  const saved = TUNING.passengersPerSecond;
  TUNING.passengersPerSecond = 1;
  try {
    const world = new World({ seed: 1 });
    await run(world, 10);
    assert.ok(world.counters.spawned >= 9 && world.counters.spawned <= 11, `spawned ${world.counters.spawned}`);
  } finally {
    TUNING.passengersPerSecond = saved;
  }
});
