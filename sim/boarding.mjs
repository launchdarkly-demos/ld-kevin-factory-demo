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
 * With enable-express-boarding on, passengers with no checked bags take the
 * express lane at every gate: no bag tags to scan at the door and nothing to
 * stow in the hold, so they are seated in roughly half the time and the zone
 * queue shortens for everyone else. With it off, everyone boards by zone.
 *
 * @param {import("./passenger.mjs").Passenger} passenger
 * @returns {Promise<string>}  A key of LANES.
 */
export async function boardingLane(passenger) {
  if (await isEnabled("enable-express-boarding", passenger.context, false)) {
    if (passenger.bags === 0) return "express";
  }
  return "zone"; // baseline
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

export const UPGRADE_OFFER = Object.freeze({
  eligibleTiers: ["plus", "elite"],
  acceptOdds: { plus: 0.25, elite: 0.4 },
  // The offer conversation, payment, and reseating at the door, in simulated
  // milliseconds. It happens before the passenger heads to their seat.
  durationSimMs: [150_000, 240_000],
});

/**
 * Decide whether the gate agent offers a paid upgrade to a passenger who has
 * reached the door.
 *
 * With enable-upgrade-offers on, Plus and Elite members get the offer;
 * everyone else boards straight away. With it off, nobody is offered.
 *
 * @param {import("./passenger.mjs").Passenger} passenger
 * @param {() => number} rng
 * @returns {Promise<{ tier: string, accepted: boolean, durationSimMs: number } | null>}
 */
export async function upgradeOffer(passenger, rng) {
  if (!UPGRADE_OFFER.eligibleTiers.includes(passenger.tier)) return null;
  if (!(await isEnabled("enable-upgrade-offers", passenger.context, false))) return null; // baseline
  const [lo, hi] = UPGRADE_OFFER.durationSimMs;
  return {
    tier: passenger.tier,
    accepted: rng() < UPGRADE_OFFER.acceptOdds[passenger.tier],
    durationSimMs: Math.round(lo + rng() * (hi - lo)),
  };
}
