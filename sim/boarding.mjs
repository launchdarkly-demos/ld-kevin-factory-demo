import { isEnabled } from "../lib/flags.mjs";

/**
 * Boarding: which lane a passenger uses at the gate and how long it takes them
 * to get from the gate to their seat.
 *
 * Durations are in simulated milliseconds. The world converts to real time.
 */

export const LANES = Object.freeze({
  zone: {
    label: "Zone boarding",
    gateToSeatSimMs: [240_000, 420_000], // 4 to 7 simulated minutes
  },
  express: {
    label: "Express lane",
    gateToSeatSimMs: [120_000, 210_000], // 2 to 3.5 simulated minutes
  },
});

/**
 * Choose the boarding lane for a passenger who has reached the gate while
 * boarding is open.
 *
 * Passengers with no checked bags take the express lane at every gate: no bag
 * tags to scan at the door and nothing to stow in the hold, so they are seated
 * in roughly half the time and the zone queue shortens for everyone else.
 * Guarded by the enable-express-boarding flag; when it is off (or LaunchDarkly
 * is unreachable) everyone uses zone boarding, as before.
 *
 * @param {import("./passenger.mjs").Passenger} passenger
 * @returns {string | Promise<string>}  A key of LANES.
 */
export async function boardingLane(passenger) {
  if (passenger.bags === 0 && (await isEnabled("enable-express-boarding", passenger.context, false))) {
    return "express";
  }
  return "zone";
}

/**
 * Gate-to-seat time for a lane, in simulated milliseconds.
 *
 * @param {string} lane
 * @param {() => number} rng
 */
export function gateToSeatMs(lane, rng) {
  const [lo, hi] = (LANES[lane] || LANES.zone).gateToSeatSimMs;
  return Math.round(lo + rng() * (hi - lo));
}
