/**
 * Gates and gate assignment.
 *
 * The terminal has two concourses, A and B, with four gates each. A flight
 * holds its gate from the moment it is scheduled until it departs.
 */

export const CONCOURSES = ["A", "B"];

/**
 * Build the gate list from the layout. Gates are ordered A1..A4, B1..B4.
 *
 * @param {{ concourseY: Record<string, number>, gateXs: number[] }} layout
 */
export function buildGates(layout) {
  const gates = [];
  for (const concourse of CONCOURSES) {
    layout.gateXs.forEach((x, i) => {
      gates.push({
        id: `${concourse}${i + 1}`,
        concourse,
        x,
        y: layout.concourseY[concourse],
        flight: null,
        freeAt: 0, // simulated seconds; the gate can take a new flight after this
      });
    });
  }
  return gates;
}

/**
 * Decide where a flight boards after it has been delayed.
 *
 * Today a delayed flight holds its gate: the door simply closes later and the
 * next departure from that gate waits. Return a different gate to move the
 * flight; the world reroutes its passengers.
 *
 * @param {object} flight  The delayed flight. flight.gate is its current gate.
 * @param {{ openGates: object[], gates: object[] }} terminal
 *   openGates are gates with no flight, in terminal order (A1..A4, B1..B4).
 * @returns {object | Promise<object>}  The gate the flight should use.
 */
export function onFlightDelayed(flight, terminal) {
  return flight.gate;
}
