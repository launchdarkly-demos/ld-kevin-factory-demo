/**
 * Rolling window of passenger outcomes, split by path, for the instruments.
 *
 * "baseline" is a passenger for whom no flag evaluated true. "treatment" is a
 * passenger on at least one flag's new path. The same outcomes are sent to
 * LaunchDarkly as metric events by the world, so the gauges and the guarded
 * release read the same numbers.
 */

export class Outcomes {
  /** @param {number} windowMs  Real milliseconds to keep. */
  constructor(windowMs = 60_000) {
    this.windowMs = windowMs;
    this.items = [];
  }

  /**
   * @param {{ at?: number, path: "baseline" | "treatment", missed: boolean, boardingMs?: number }} outcome
   */
  record(outcome) {
    const at = outcome.at ?? Date.now();
    this.items.push({ ...outcome, at });
    this.trim(at);
  }

  trim(now) {
    const cutoff = now - this.windowMs;
    let i = 0;
    while (i < this.items.length && this.items[i].at < cutoff) i += 1;
    if (i) this.items.splice(0, i);
  }

  /**
   * Per-path totals over the window.
   */
  summary(now = Date.now()) {
    this.trim(now);
    const make = () => ({ boarded: 0, missed: 0, boardingMsTotal: 0 });
    const acc = { baseline: make(), treatment: make() };
    for (const o of this.items) {
      const a = acc[o.path] || acc.baseline;
      if (o.missed) a.missed += 1;
      else {
        a.boarded += 1;
        a.boardingMsTotal += o.boardingMs || 0;
      }
    }
    const finish = (a) => {
      const total = a.boarded + a.missed;
      return {
        boarded: a.boarded,
        missed: a.missed,
        total,
        missRate: total ? a.missed / total : null,
        avgBoardingMs: a.boarded ? Math.round(a.boardingMsTotal / a.boarded) : null,
      };
    };
    return { windowMs: this.windowMs, baseline: finish(acc.baseline), treatment: finish(acc.treatment) };
  }
}
