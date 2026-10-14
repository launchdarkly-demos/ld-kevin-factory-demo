Add an express boarding lane and a lanes endpoint for gate operations
---
Carry-on-only passengers currently queue in the zone lane with everyone else. This adds an express lane at every gate for passengers with no checked bags, and exposes per-lane boarding counts and average gate-to-seat time at a new `GET /api/lanes` endpoint so gate operations can see how each lane is performing.

- `sim/boarding.mjs`: passengers with `bags === 0` board through the new `express` lane (2 to 3.5 simulated minutes gate to seat, versus 4 to 7 for zone boarding).
- `sim/world.mjs`: tracks boardings and gate-to-seat time per lane.
- `server.mjs`: new `GET /api/lanes` returning `{ lanes: { zone: { boarded, avgBoardingMs }, express: { ... } } }`.
- `public/index.html`, `public/deck.js`: a "Boarding lanes" readout on the instruments panel, and express boarders drawn in a second lane beside the gate door.
- `test/boarding.test.mjs`, `test/world.test.mjs`: lane selection, express timing range, lane stats in the state snapshot.

Customer-facing impact: about 45% of passengers switch to a new lane with a different boarding procedure and timing from the moment this is live, at every gate at once. The lanes endpoint is a new contract for the ops tooling.
