/**
 * The terminal simulation.
 *
 * Passengers spawn at the left, check in, clear security, walk to their gate
 * in concourse A or B, and board when the door is open. Flights hold gates,
 * open boarding, close the door, depart, and free the gate for the next one.
 * Some flights run late.
 *
 * Time: the simulation runs at SIM_SPEED simulated seconds per real second.
 * Dwell times and movement are in real seconds so the picture reads well;
 * flight schedules and the metric values are in simulated time.
 *
 * Feature decisions live in boarding.mjs and gates.mjs and may be async. The
 * world awaits them.
 */

import { boardingLane, gateToSeatMs } from "./boarding.mjs";
import { buildGates, onFlightDelayed } from "./gates.mjs";
import { createPassenger } from "./passenger.mjs";
import { Outcomes } from "./metrics.mjs";
import { onNewPath, onShownPath, track } from "../lib/flags.mjs";

export const SIM_SPEED = 20; // simulated seconds per real second

export const LAYOUT = Object.freeze({
  w: 960,
  h: 540,
  spawn: { x: -24, y: 270 },
  checkin: { x: 80, y: 270 },
  security: { x: 210, y: 270 },
  junction: { x: 300, y: 270 },
  concourseY: { A: 140, B: 400 },
  gateXs: [400, 540, 680, 820],
  desk: { x: 300, y: 520 }, // rebooking desk, where missed passengers go
});

export const TUNING = {
  passengersPerSecond: 8,
  walkSpeed: 90, // px per real second
  checkinDwell: [0.4, 1.6], // real seconds
  securityDwell: [0.8, 3.0],
  securitySlowOdds: 0.03, // share of passengers who hit a slow security lane
  securitySlowDwell: [7, 12],
  flightLead: 60, // sim seconds between a flight taking a gate and boarding opening
  boardingWindow: 900, // sim seconds the door stays open (45 real seconds)
  taxiOut: 60, // sim seconds from door close to departure
  turnaround: 180, // sim seconds the gate stays open after departure
  delayOdds: 0.25,
  delayBy: [120, 240], // sim seconds
  assignMargin: 60, // sim seconds of slack a passenger needs past the expected journey
  missedFlash: 1.5, // real seconds
  maxPassengers: 600,
};

const PASSENGER_STAGES = new Set([
  "toCheckin",
  "checkin",
  "toSecurity",
  "security",
  "clearing",
  "toGate",
  "atGate",
  "boarding",
  "missed",
  "toDesk",
  "gone",
]);

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const between = (rng, [lo, hi]) => lo + rng() * (hi - lo);
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

function pathLength(from, points) {
  let total = 0;
  let prev = from;
  for (const p of points) {
    total += dist(prev, p);
    prev = p;
  }
  return total;
}

export class World {
  /**
   * @param {{ seed?: number, log?: (entry: { kind: string, text: string }) => void }} opts
   */
  constructor({ seed = 7, log = () => {} } = {}) {
    this.rng = mulberry32(seed);
    this.log = (kind, text) => log({ kind, text });
    this.simClock = 0; // simulated seconds
    this.realClock = 0; // real seconds since start
    this.gates = buildGates(LAYOUT);
    this.passengers = [];
    this.nextPassengerId = 1;
    this.spawnDebt = 0;
    this.flightSeq = 100 + Math.floor(this.rng() * 400);
    this.outcomes = new Outcomes(60_000);
    this.counters = { spawned: 0, boarded: 0, missed: 0, departures: 0, delays: 0, gateChanges: 0 };
    // Stagger the first flights so the gates are not all in lockstep.
    for (const gate of this.gates) this.scheduleFlight(gate, between(this.rng, [0, TUNING.boardingWindow]));
  }

  // ---- flights --------------------------------------------------------------

  scheduleFlight(gate, stagger = 0) {
    const open = this.simClock + TUNING.flightLead + stagger;
    const flight = {
      code: `FD ${this.flightSeq}`,
      gate,
      status: "scheduled", // scheduled -> boarding -> closed -> departed
      boardingOpenAt: open,
      doorCloseAt: open + TUNING.boardingWindow,
      departAt: open + TUNING.boardingWindow + TUNING.taxiOut,
      delayed: false,
      delayBy: 0,
      movedFrom: null,
      willDelayAt: this.rng() < TUNING.delayOdds ? open + between(this.rng, [0.3, 0.7]) * TUNING.boardingWindow : null,
    };
    this.flightSeq += 1 + Math.floor(this.rng() * 7);
    gate.flight = flight;
    return flight;
  }

  activeFlights() {
    return this.gates.map((g) => g.flight).filter((f) => f && (f.status === "scheduled" || f.status === "boarding"));
  }

  openGates() {
    return this.gates.filter((g) => !g.flight && this.simClock >= g.freeAt);
  }

  updateFlights() {
    const now = this.simClock;
    for (const gate of this.gates) {
      const f = gate.flight;
      if (!f) {
        if (now >= gate.freeAt) this.scheduleFlight(gate);
        continue;
      }
      if (f.status === "scheduled" && now >= f.boardingOpenAt) {
        f.status = "boarding";
      }
      if (f.willDelayAt !== null && !f.delayed && now >= f.willDelayAt) {
        f.willDelayAt = null;
        this.delayFlight(f);
      }
      if (f.status === "boarding" && now >= f.doorCloseAt) {
        f.status = "closed";
      }
      if (f.status === "closed" && now >= f.departAt) {
        f.status = "departed";
        gate.flight = null;
        gate.freeAt = now + TUNING.turnaround;
        this.counters.departures += 1;
      }
    }
  }

  delayFlight(flight) {
    const delayBy = Math.round(between(this.rng, TUNING.delayBy));
    flight.delayed = true;
    flight.delayBy = delayBy;
    flight.doorCloseAt += delayBy;
    flight.departAt += delayBy;
    this.counters.delays += 1;
    this.log("flight", `${flight.code} delayed ${Math.round(delayBy / 60)} min at ${flight.gate.id}`);

    const terminal = { openGates: this.openGates(), gates: this.gates };
    Promise.resolve()
      .then(() => onFlightDelayed(flight, terminal))
      .then((target) => {
        if (!target || target === flight.gate || flight.status === "departed") return;
        if (target.flight) {
          this.log("flight", `${flight.code} could not move to ${target.id}: gate occupied`);
          return;
        }
        this.moveFlight(flight, target);
      })
      .catch((err) => this.log("error", `gate reassignment failed for ${flight.code}: ${err && err.message ? err.message : err}`));
  }

  moveFlight(flight, target) {
    const from = flight.gate;
    from.flight = null;
    from.freeAt = this.simClock;
    flight.movedFrom = from.id;
    flight.gate = target;
    target.flight = flight;
    this.counters.gateChanges += 1;
    this.log("flight", `${flight.code} moved ${from.id} to ${target.id}`);
    for (const p of this.passengers) {
      if (p.flight !== flight) continue;
      if (p.stage === "toGate" || p.stage === "atGate") {
        p.waypoints = this.routeTo(p, target);
        p.stage = "toGate";
        p.rerouted = true;
      }
    }
  }

  // ---- passengers -----------------------------------------------------------

  spawn(dt) {
    this.spawnDebt += dt * TUNING.passengersPerSecond;
    while (this.spawnDebt >= 1) {
      this.spawnDebt -= 1;
      if (this.passengers.length >= TUNING.maxPassengers) continue;
      this.spawnPassenger();
    }
  }

  spawnPassenger() {
    const p = createPassenger(this.nextPassengerId++, this.rng);
    p.x = LAYOUT.spawn.x - this.rng() * 30;
    p.y = LAYOUT.spawn.y + (this.rng() - 0.5) * 24;
    p.depth = (this.rng() - 0.5) * 18; // vertical scatter inside a corridor
    p.stage = "toCheckin";
    p.waypoints = [LAYOUT.checkin];
    p.dwell = 0;
    p.checkinDwell = between(this.rng, TUNING.checkinDwell);
    p.securityDwell = this.rng() < TUNING.securitySlowOdds ? between(this.rng, TUNING.securitySlowDwell) : between(this.rng, TUNING.securityDwell);
    p.lane = null;
    p.boardingMs = null;
    p.missed = false;
    p.rerouted = false;
    p.flight = this.pickFlight(p); // may be null; check-in retries until a flight is reachable
    this.passengers.push(p);
    this.counters.spawned += 1;
    return p;
  }

  /**
   * Choose a flight the passenger can plausibly make. The expectation uses a
   * typical security dwell, so a passenger who draws the slow lane can miss.
   */
  pickFlight(p) {
    const flights = this.activeFlights();
    const nominalSecurity = (TUNING.securityDwell[0] + TUNING.securityDwell[1]) / 2;
    const candidates = [];
    for (const f of flights) {
      const walk = (dist({ x: p.x, y: p.y }, LAYOUT.checkin) + dist(LAYOUT.checkin, LAYOUT.security) + pathLength(LAYOUT.security, this.routeFrom(LAYOUT.security, f.gate))) / TUNING.walkSpeed;
      const expectedReal = p.checkinDwell + nominalSecurity + walk;
      const slack = f.doorCloseAt - this.simClock - expectedReal * SIM_SPEED;
      if (slack >= TUNING.assignMargin) candidates.push(f);
    }
    if (candidates.length) return candidates[Math.floor(this.rng() * candidates.length)];
    // Nothing reachable right now. The passenger waits at check-in and tries again.
    return null;
  }

  routeFrom(from, gate) {
    const cy = gate.y;
    const points = [];
    if (Math.abs(from.y - cy) > 1) {
      if (Math.abs(from.x - LAYOUT.junction.x) > 1) points.push({ x: LAYOUT.junction.x, y: from.y });
      points.push({ x: LAYOUT.junction.x, y: cy });
    }
    points.push({ x: gate.x, y: cy });
    return points;
  }

  routeTo(p, gate) {
    return this.routeFrom({ x: p.x, y: p.y }, gate);
  }

  routeToDesk(p) {
    const points = [];
    if (Math.abs(p.x - LAYOUT.junction.x) > 1) points.push({ x: LAYOUT.junction.x, y: p.y });
    points.push({ x: LAYOUT.junction.x, y: LAYOUT.desk.y });
    points.push(LAYOUT.desk);
    return points;
  }

  /** Move toward the next waypoint. Returns true when the route is finished. */
  advance(p, dt) {
    let budget = TUNING.walkSpeed * dt;
    while (budget > 0 && p.waypoints.length) {
      const target = p.waypoints[0];
      const d = dist(p, target);
      if (d <= budget) {
        p.x = target.x;
        p.y = target.y;
        p.waypoints.shift();
        budget -= d;
      } else {
        p.x += ((target.x - p.x) / d) * budget;
        p.y += ((target.y - p.y) / d) * budget;
        budget = 0;
      }
    }
    return p.waypoints.length === 0;
  }

  updatePassenger(p, dt) {
    switch (p.stage) {
      case "toCheckin":
        if (this.advance(p, dt)) {
          p.stage = "checkin";
          p.dwell = p.checkinDwell;
        }
        break;
      case "checkin":
        p.dwell -= dt;
        if (p.dwell <= 0) {
          if (!p.flight) p.flight = this.pickFlight(p);
          if (!p.flight) {
            p.dwell = 0.5; // no reachable flight yet; keep waiting at the desk
            break;
          }
          p.stage = "toSecurity";
          p.waypoints = [LAYOUT.security];
        }
        break;
      case "toSecurity":
        if (this.advance(p, dt)) {
          p.stage = "security";
          p.dwell = p.securityDwell;
        }
        break;
      case "security":
        p.dwell -= dt;
        if (p.dwell <= 0) this.clearSecurity(p);
        break;
      case "clearing":
        break;
      case "toGate":
        if (this.advance(p, dt)) this.arriveAtGate(p);
        break;
      case "atGate":
        this.arriveAtGate(p);
        break;
      case "boarding":
        p.dwell -= dt;
        // Drift to the gate door while boarding, then hold there.
        p.depth = Math.max(-44, Math.min(44, p.depth + (p.flight.gate.concourse === "A" ? -1 : 1) * 14 * dt));
        if (p.dwell <= 0) this.boarded(p);
        break;
      case "missed":
        p.dwell -= dt;
        if (p.dwell <= 0) {
          p.stage = "toDesk";
          p.waypoints = this.routeToDesk(p);
        }
        break;
      case "toDesk":
        if (this.advance(p, dt)) p.stage = "gone";
        break;
      default:
        break;
    }
  }

  arriveAtGate(p) {
    const f = p.flight;
    if (f.status === "boarding") this.startBoarding(p);
    else if (f.status === "scheduled") p.stage = "atGate";
    else this.miss(p);
  }

  /**
   * Decisions made as a passenger clears security. Feature flags are evaluated
   * here, once per passenger, so the deck can show which path they are on for
   * the whole walk to the gate. The results are applied at the door.
   */
  async decideAtSecurity(p) {
    p.lane = (await boardingLane(p)) || "zone";
  }

  clearSecurity(p) {
    p.stage = "clearing";
    this.decideAtSecurity(p)
      .catch((err) => {
        this.log("error", `security-point decision failed for ${p.key}: ${err && err.message ? err.message : err}`);
        p.lane = p.lane || "zone";
      })
      .then(() => {
        if (p.stage !== "clearing") return;
        p.stage = "toGate";
        p.waypoints = this.routeTo(p, p.flight.gate);
      });
  }

  startBoarding(p) {
    p.lane = p.lane || "zone";
    p.boardingMs = gateToSeatMs(p.lane, this.rng);
    p.dwell = p.boardingMs / SIM_SPEED / 1000;
    p.stage = "boarding";
  }

  /** Path for the instruments: only flags still rolling out count. */
  pathOf(p) {
    return onNewPath(p.key) ? "treatment" : "baseline";
  }

  /** Path for the floor: landed flags keep their passengers gold until the next rollout. */
  shownPathOf(p) {
    return onShownPath(p.key) ? "treatment" : "baseline";
  }

  boarded(p) {
    this.outcomes.record({ path: this.pathOf(p), missed: false, boardingMs: p.boardingMs });
    track("boarding-time-ms", p.context, p.boardingMs);
    this.counters.boarded += 1;
    p.stage = "gone";
  }

  miss(p) {
    if (process.env.FLIGHT_DECK_DEBUG) {
      const f = p.flight;
      console.error(
        `[flight-deck] miss ${p.key} ${f.code}@${f.gate.id} status=${f.status} doorCloseIn=${Math.round(f.doorCloseAt - this.simClock)}s ` +
          `delayed=${f.delayed} rerouted=${p.rerouted} securityDwell=${p.securityDwell.toFixed(1)}s`,
      );
    }
    this.outcomes.record({ path: this.pathOf(p), missed: true });
    track("missed-boarding", p.context);
    this.counters.missed += 1;
    p.missed = true;
    p.stage = "missed";
    p.dwell = TUNING.missedFlash;
    p.waypoints = [];
  }

  // ---- tick -----------------------------------------------------------------

  /** @param {number} dt  Real seconds since the last tick. */
  tick(dt) {
    this.realClock += dt;
    this.simClock += dt * SIM_SPEED;
    this.updateFlights();
    this.spawn(dt);
    for (const p of this.passengers) this.updatePassenger(p, dt);
    if (this.passengers.some((p) => p.stage === "gone")) {
      this.passengers = this.passengers.filter((p) => p.stage !== "gone");
    }
  }

  // ---- serialisation --------------------------------------------------------

  snapshot() {
    const now = this.simClock;
    return {
      simClock: Math.round(now),
      realClock: Math.round(this.realClock * 10) / 10,
      simSpeed: SIM_SPEED,
      layout: LAYOUT,
      counters: { ...this.counters },
      gates: this.gates.map((g) => ({
        id: g.id,
        concourse: g.concourse,
        x: g.x,
        y: g.y,
        flight: g.flight
          ? {
              code: g.flight.code,
              status: g.flight.status,
              boardingOpenIn: Math.max(0, Math.round(g.flight.boardingOpenAt - now)),
              doorCloseIn: Math.max(0, Math.round(g.flight.doorCloseAt - now)),
              window: TUNING.boardingWindow + g.flight.delayBy,
              delayed: g.flight.delayed,
              delayBy: g.flight.delayBy,
              movedFrom: g.flight.movedFrom,
            }
          : null,
      })),
      passengers: this.passengers.map((p) => ({
        id: p.id,
        x: Math.round(p.x),
        y: Math.round(p.y + p.depth),
        stage: p.stage,
        lane: p.lane,
        path: this.shownPathOf(p),
        bags: p.bags,
        tier: p.tier,
        missed: p.missed,
        rerouted: p.rerouted,
        gate: p.flight ? p.flight.gate.id : null,
      })),
      outcomes: this.outcomes.summary(),
    };
  }
}

export { PASSENGER_STAGES };
