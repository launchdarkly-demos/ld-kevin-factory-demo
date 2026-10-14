Offer paid upgrades to Plus and Elite members at the gate
---
Plus and Elite members currently board with no upsell. This has the gate agent offer a paid upgrade to eligible passengers at the door, processes the reseating when they accept, and exposes offer and acceptance counts at a new `GET /api/upgrades` endpoint for the ops board.

- `sim/boarding.mjs`: `upgradeOffer(passenger)` makes the offer to `plus` and `elite` tiers; acceptance odds 25% and 40%. The conversation, payment, and reseating take 2.5 to 4 simulated minutes at the door.
- `sim/world.mjs`: the offer runs when a passenger reaches an open door, before they head to their seat; counts offers and accepted upgrades.
- `server.mjs`: new `/api/upgrades` returning `{ offers, accepted, acceptanceRate }`.
- `public/deck.js`: passengers mid-offer are drawn with a ring at the agent's podium; legend entry added.
- `test/boarding.test.mjs`: eligibility by tier, acceptance, and offer duration.

Customer-facing impact: eligible passengers (about 43% of traffic) spend a few extra minutes at the door, so average gate-to-seat time rises noticeably while the offer is in effect. We expect the upgrade revenue to justify it.
