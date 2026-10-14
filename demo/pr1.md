Add an express boarding lane for carry-on-only passengers
---
Carry-on-only passengers currently queue in the zone lane with everyone else. This adds an express lane at every gate for passengers with no checked bags, which roughly halves their gate-to-seat time and shortens the zone queue for everyone else.

- `sim/boarding.mjs`: passengers with `bags === 0` board through the new `express` lane (2 to 3.5 simulated minutes gate to seat, versus 4 to 7 for zone boarding).
- `public/deck.js`: express boarders are drawn in a second lane beside the gate door, with a legend entry.
- `test/boarding.test.mjs`: covers lane selection and the express lane's timing range.

Customer-facing impact: about 45% of passengers board through a new lane with different timing, so gate-to-seat time changes for them from the moment this is live.
