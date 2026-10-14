# Flight Deck

An airport operations board. A Node server simulates passengers moving through
a terminal and boarding flights, evaluates LaunchDarkly feature flags for each
passenger, and serves a live canvas view of the floor at `/`.

- `server.mjs` runs the simulation and serves `public/` plus `/api/state`.
- `sim/` is the simulation. Behaviour decisions live in small, named functions:
  `boardingLane()` in `sim/boarding.mjs` and `onFlightDelayed()` in `sim/gates.mjs`.
- `lib/flags.mjs` is the only module that talks to the LaunchDarkly SDK.
- `test/` uses `node:test`. `npm test` runs with no network.

## Feature flag conventions

Every feature flag in this repo follows these rules. They keep the floor honest
and the tests simple.

1. **Flag off is the baseline.** With a flag off, behaviour must be exactly what
   it was before the flag existed. The fallback passed to `isEnabled` is always
   the baseline value, `false`.
2. **One boolean flag per user-facing behaviour change.** Keys are
   `enable-<descriptive-name>`, for example `enable-express-boarding`.
3. **Evaluate through the helper, at the decision point, once per passenger.**

   ```js
   import { isEnabled } from "../lib/flags.mjs";

   export async function boardingLane(passenger) {
     if (await isEnabled("enable-express-boarding", passenger.context, false)) {
       // new behaviour
     }
     return "zone"; // baseline
   }
   ```

   `isEnabled` is async. The decision functions in `sim/` may be made async;
   the world already awaits them. Never cache a flag value across passengers,
   and never evaluate outside `lib/flags.mjs`.
4. **The context is `passenger.context`.** It is a LaunchDarkly `user` context
   with a unique key per passenger and the attributes `bags`, `tier`, `region`,
   and `loyaltyYears`.
5. **Metric events go through `track()`** from the same helper. The two metrics
   the release policy watches already exist: `boarding-time-ms` (numeric,
   emitted when a passenger boards) and `missed-boarding` (occurrence, emitted
   when a passenger arrives after the door closes). New features normally need
   no new events.
6. **Tests cover both flag states** using `withFlags` from `lib/flags.mjs`:

   ```js
   import { withFlags } from "../lib/flags.mjs";

   await withFlags({ "enable-express-boarding": true }, async () => {
     assert.equal(await boardingLane(carryOnOnly), "express");
   });
   await withFlags({}, async () => {
     assert.equal(await boardingLane(carryOnOnly), "zone");
   });
   ```

7. **Nothing in `public/` knows a flag key.** The renderer colours passengers
   by `path` (`baseline` or `treatment`), which the server derives from
   recorded evaluations. UI changes for a feature should key off data the
   server already sends (for example `lane`), not off a flag.

## Running

```bash
cp .env.example .env     # fill in LD_SDK_KEY, or leave it blank for offline mode
npm install
npm start                # http://localhost:7777
npm test
```
