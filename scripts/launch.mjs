#!/usr/bin/env node
/**
 * Container-side launch provisioning for Demo Depot.
 *
 *   node scripts/launch.mjs provision   create/reuse this launch's repo, metrics, policy, mapping;
 *                                       prints shell `export` lines for the entrypoint to eval
 *   node scripts/launch.mjs teardown    unmap and delete the repo (the depot deletes the project)
 *
 * Does nothing (exit 0, no output) when the launch inputs are missing, so a
 * verification run or a laptop start falls through to the ordinary path.
 */
import { launchConfig, provisionLaunch, teardownLaunch } from "../lib/launch.mjs";

const mode = process.argv[2];
const cfg = launchConfig();
const log = (m) => console.error(`[flight-deck] launch: ${m}`);

if (!["provision", "teardown"].includes(mode)) {
  console.error("usage: launch.mjs provision|teardown");
  process.exit(2);
}
if (!cfg.enabled) {
  log(`skipped (${cfg.missing.join(", ")} not set)`);
  process.exit(0);
}

try {
  if (mode === "provision") {
    const r = await provisionLaunch(cfg, log);
    console.log(`export GITHUB_REPO='${r.repo}'`);
    console.log("export FLIGHT_DECK_LAUNCH_TEARDOWN=1");
  } else {
    await teardownLaunch(cfg, log);
  }
} catch (err) {
  log(`${mode} failed: ${err.message}`);
  process.exit(1);
}
