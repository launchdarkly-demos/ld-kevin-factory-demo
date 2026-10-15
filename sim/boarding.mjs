/**
 * Boarding: which lane a passenger uses at the gate and how long it takes them
 * to get from the gate to their seat.
 *
 * Durations are in simulated milliseconds. The world converts to real time.
 */

import { isEnabled } from "../lib/flags.mjs";

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
 *
 * @param {import("./passenger.mjs").Passenger} passenger
 * Guarded by the enable-express-boarding flag. With it off, every passenger
 * boards through zone boarding as before.
 *
 * @returns {Promise<string>}  A key of LANES.
 */
export async function boardingLane(passenger) {
  if (await isEnabled("enable-express-boarding", passenger.context, false)) {
    if (passenger.bags === 0) return "express";
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
