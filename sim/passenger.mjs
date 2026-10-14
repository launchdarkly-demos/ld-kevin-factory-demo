/**
 * Passenger factory. Each passenger is a unique LaunchDarkly user context with
 * a few attributes a release policy or targeting rule could use.
 */

const TIERS = ["basic", "basic", "basic", "basic", "plus", "plus", "elite"];
const REGIONS = ["us-east", "us-west", "emea", "apac", "latam"];

/**
 * @param {number} id  Monotonic passenger number.
 * @param {() => number} rng  Returns a float in [0, 1).
 */
export function createPassenger(id, rng) {
  const key = `pax-${String(id).padStart(6, "0")}`;
  const roll = rng();
  const bags = roll < 0.45 ? 0 : roll < 0.8 ? 1 : 2;
  const tier = TIERS[Math.floor(rng() * TIERS.length)];
  const region = REGIONS[Math.floor(rng() * REGIONS.length)];
  const loyaltyYears = tier === "elite" ? 4 + Math.floor(rng() * 10) : Math.floor(rng() * 5);

  return {
    id,
    key,
    bags,
    tier,
    region,
    context: {
      kind: "user",
      key,
      name: `Passenger ${id}`,
      bags,
      tier,
      region,
      loyaltyYears,
    },
  };
}
