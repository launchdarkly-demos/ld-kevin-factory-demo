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
});

/**
 * Choose the boarding lane for a passenger who has reached the gate while
 * boarding is open.
 *
 * @param {import("./passenger.mjs").Passenger} passenger
 * @returns {string | Promise<string>}  A key of LANES.
 */
export function boardingLane(passenger) {
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
