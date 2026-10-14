import { test } from "node:test";
import assert from "node:assert/strict";

import { buildGates, onFlightDelayed } from "../sim/gates.mjs";
import { LAYOUT } from "../sim/world.mjs";

test("the terminal has four gates per concourse in order", () => {
  const gates = buildGates(LAYOUT);
  assert.deepEqual(
    gates.map((g) => g.id),
    ["A1", "A2", "A3", "A4", "B1", "B2", "B3", "B4"],
  );
  assert.ok(gates.every((g) => g.flight === null));
});

test("a delayed flight holds its gate even when other gates are open", async () => {
  const gates = buildGates(LAYOUT);
  const flight = { code: "FD 100", gate: gates[1], delayed: true };
  gates[1].flight = flight;
  const openGates = gates.filter((g) => g !== gates[1]);
  const target = await onFlightDelayed(flight, { openGates, gates });
  assert.equal(target, gates[1]);
});
