/**
 * Autopilot status, derived from measured flag shares.
 *
 * Nothing here talks to LaunchDarkly. The deck only knows what share of
 * recent passengers evaluated each flag true, so the lamp and the flight-log
 * entries are inferred from how that share moves:
 *
 *   TAXI        no flag has ever been on for anyone
 *   CLIMB       a flag is on for some passengers but not all
 *   CRUISE      the lead flag is on for everyone
 *   DISENGAGED  the lead flag was on for some passengers and is now off for all
 *
 * The lead flag is the one whose share changed most recently.
 */

const STEPS = [10, 25, 50, 100];

export class Autopilot {
  /** @param {(entry: { kind: string, text: string }) => void} log */
  constructor(log = () => {}) {
    this.log = log;
    this.seen = new Map(); // flagKey -> { share, peak, step, lamp }
  }

  /**
   * @param {{ key: string, share: number, peakShare: number, total: number, lastChangeAt: number | null, firstSeenAt: number | null }[]} flags
   *   Per-flag shares from lib/flags.mjs snapshot(), most recently changed first.
   */
  update(flags) {
    for (const f of flags) this.track(f);
    const lead = flags[0];
    if (!lead) return { lamp: "TAXI", flagKey: null, share: 0, detail: "no flags evaluated yet" };
    const state = this.seen.get(lead.key);
    return { lamp: state.lamp, flagKey: lead.key, share: lead.share, detail: state.detail };
  }

  track(f) {
    const prev = this.seen.get(f.key) || { share: 0, peak: 0, step: 0, lamp: "TAXI", detail: `${f.key} off for everyone` };
    const next = { ...prev, share: f.share, peak: Math.max(prev.peak, f.share) };

    if (f.share >= 100) next.lamp = "CRUISE";
    else if (f.share > 0) next.lamp = "CLIMB";
    else if (next.peak > 0) next.lamp = "DISENGAGED";
    else next.lamp = "TAXI";

    next.detail =
      next.lamp === "CRUISE" ? `${f.key} on for everyone` :
      next.lamp === "CLIMB" ? `${f.key} at ${f.share}%` :
      next.lamp === "DISENGAGED" ? `${f.key} rolled back from ${next.peak}%` :
      `${f.key} off for everyone`;

    // Flight-log entries on transitions only.
    if (prev.lamp === "TAXI" && next.lamp === "CLIMB") {
      this.log({ kind: "autopilot", text: `autopilot engaged: ${f.key} release started` });
    }
    const step = STEPS.filter((s) => f.share >= s - 2).pop() || 0; // allow window noise just under a step
    if (step > prev.step && next.lamp !== "DISENGAGED") {
      next.step = step;
      this.log({ kind: "autopilot", text: step >= 100 ? `${f.key} at 100%: cruise` : `${f.key} climbing: ${step}% of passengers on the new path` });
    }
    if (prev.lamp !== "DISENGAGED" && next.lamp === "DISENGAGED") {
      this.log({ kind: "autopilot", text: `autopilot disengaged: ${f.key} rolled back from ${next.peak}%` });
    }
    if (prev.lamp === "DISENGAGED" && next.lamp === "CLIMB") {
      next.step = 0;
      next.peak = f.share;
      this.log({ kind: "autopilot", text: `autopilot re-engaged: ${f.key} rolling out again` });
    }
    this.seen.set(f.key, next);
  }
}
