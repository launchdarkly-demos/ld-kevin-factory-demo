/**
 * Per-launch provisioning for Demo Depot.
 *
 * The depot gives every instance its own LaunchDarkly project and the keys
 * for it, but Release AutoPilot also needs a GitHub repository mapped to that
 * project, and the project needs the guardrail metrics and the release
 * policy. There are no launch hooks, so the container does this itself at
 * start (provisionLaunch) and undoes the GitHub side on stop (teardownLaunch).
 * The depot deletes the project.
 *
 * Inputs (environment):
 *   DD_INSTANCE_ID              depot instance id; names the repo so a restart reuses it
 *   GITHUB_TOKEN                repo + delete_repo scope, SAML-authorised for the org
 *   LD_API_TOKEN                project-writer token the depot injects (apiToken: project-writer)
 *   LD_API_KEY                  account-level token; used only where LD_API_TOKEN is refused
 *                               (the repo mapping is an account setting and may need it)
 *   LD_PROJECT_KEY, LD_ENV_KEY  injected by the depot
 *   FLIGHT_DECK_TEMPLATE_REPO   owner/name of the template (default launchdarkly-demos/ld-kevin-factory-demo)
 *   FLIGHT_DECK_LAUNCH_ID       overrides DD_INSTANCE_ID (local testing)
 */

const LD = "https://app.launchdarkly.com";
const GH = "https://api.github.com";

export function launchConfig(env = process.env) {
  const template = (env.FLIGHT_DECK_TEMPLATE_REPO || "launchdarkly-demos/ld-kevin-factory-demo").trim();
  const id = launchId(env);
  const cfg = {
    id,
    template,
    org: template.split("/")[0],
    repo: id ? `${template.split("/")[0]}/${repoName(id)}` : null,
    githubToken: (env.GITHUB_TOKEN || "").trim(),
    ldProjectToken: (env.LD_API_TOKEN || "").trim(),
    ldAccountKey: (env.LD_API_KEY || "").trim(),
    projectKey: (env.LD_PROJECT_KEY || "").trim(),
    envKey: (env.LD_ENV_KEY || "production").trim(),
  };
  const missing = [];
  if (!cfg.id) missing.push("DD_INSTANCE_ID");
  if (!cfg.githubToken) missing.push("GITHUB_TOKEN");
  if (!cfg.ldProjectToken && !cfg.ldAccountKey) missing.push("LD_API_TOKEN or LD_API_KEY");
  if (!cfg.projectKey) missing.push("LD_PROJECT_KEY");
  // Project work uses the injected token when there is one; the account key is the fallback.
  return { ...cfg, ldApiKey: cfg.ldProjectToken || cfg.ldAccountKey, enabled: missing.length === 0, missing };
}

export function launchId(env = process.env) {
  return (env.FLIGHT_DECK_LAUNCH_ID || env.DD_INSTANCE_ID || "").trim().toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 40);
}

/** Repo name for a launch: ld-flight-deck-<id>. GitHub allows up to 100 characters. */
export function repoName(id) {
  return `ld-flight-deck-${id}`;
}

async function call(url, { method = "GET", headers = {}, body, ok = [200, 201, 204] } = {}) {
  const res = await fetch(url, { method, headers: { "User-Agent": "flight-deck", ...headers }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: res.status, ok: ok.includes(res.status), data };
}

function gh(cfg, method, route, body, ok) {
  return call(`${GH}${route}`, {
    method,
    body,
    ok,
    headers: {
      Authorization: `Bearer ${cfg.githubToken}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
  });
}

/**
 * LaunchDarkly call with the token the launch prefers (the depot's
 * project-writer token when present), falling back to the account key when
 * that token is refused. The depot's token cannot create metrics or release
 * policies (HTTP 403, seen on launch uy0n3t), and the repo mapping is account
 * scope, so the fallback covers every call. The result says which token
 * worked so the launch log tells the owner whether LD_API_KEY is still needed.
 */
async function ld(cfg, method, route, body, ok, log = () => {}) {
  const headers = (token) => ({ Authorization: token, "LD-API-Version": "beta", ...(body ? { "Content-Type": "application/json" } : {}) });
  let r = await call(`${LD}${route}`, { method, body, ok, headers: headers(cfg.ldApiKey) });
  if ((r.status === 401 || r.status === 403) && cfg.ldAccountKey && cfg.ldAccountKey !== cfg.ldApiKey) {
    log(`${method} ${route}: HTTP ${r.status} with the project token; retrying with LD_API_KEY`);
    r = await call(`${LD}${route}`, { method, body, ok, headers: headers(cfg.ldAccountKey) });
    r.usedAccountKey = true;
  }
  return r;
}


const fail = (what, r) => new Error(`${what}: HTTP ${r.status} ${typeof r.data === "string" ? r.data.slice(0, 200) : (r.data && r.data.message) || ""}`.trim());

/** The guardrail metrics and the release policy the demo's story depends on. */
export const METRICS = [
  {
    key: "boarding-time-ms",
    name: "Boarding time",
    kind: "custom",
    eventKey: "boarding-time-ms",
    isNumeric: true,
    unit: "ms",
    successCriteria: "LowerThanBaseline",
    randomizationUnits: ["user"],
    unitAggregationType: "average",
    analysisType: "mean",
    eventDefault: { disabled: true },
    description: "Gate-to-seat time per boarded passenger, in simulated milliseconds. Lower is better.",
  },
  {
    key: "missed-boarding",
    name: "Missed boarding",
    kind: "custom",
    eventKey: "missed-boarding",
    isNumeric: false,
    successCriteria: "LowerThanBaseline",
    randomizationUnits: ["user"],
    unitAggregationType: "average",
    analysisType: "mean",
    eventDefault: { disabled: false, value: 0 },
    description: "Passenger arrived at the gate after the door closed. Lower is better.",
  },
];

export function releasePolicy(envKey) {
  return {
    key: "release-auto-pilot-demo",
    name: "Release AutoPilot Demo",
    releaseMethod: "guarded-release",
    scope: { environmentKeys: [envKey] },
    guardedReleaseConfig: {
      metricKeys: METRICS.map((m) => m.key),
      rollbackOnRegression: true,
      rolloutContextKindKey: "user",
      stages: [
        { allocation: 10000, durationMillis: 60000 },
        { allocation: 25000, durationMillis: 60000 },
        { allocation: 50000, durationMillis: 120000 },
      ],
    },
  };
}

/**
 * Make sure this launch has its repo, metrics, policy and mapping. Idempotent:
 * a container restart finds the repo by name and the rest already present.
 * Returns { repo, repoId, created: [...] }.
 */
export async function provisionLaunch(cfg, log = () => {}) {
  if (!cfg.enabled) throw new Error(`launch provisioning needs ${cfg.missing.join(", ")}`);
  const created = [];
  const [owner, name] = cfg.repo.split("/");

  let repo = await gh(cfg, "GET", `/repos/${cfg.repo}`, undefined, [200, 404]);
  if (!repo.ok) throw fail(`looking up ${cfg.repo}`, repo);
  if (repo.status === 404) {
    log(`creating ${cfg.repo} from ${cfg.template}`);
    const tpl = await gh(cfg, "GET", `/repos/${cfg.template}`);
    if (!tpl.ok) throw fail(`reading template ${cfg.template}`, tpl);
    const gen = await gh(cfg, "POST", `/repos/${cfg.template}/generate`, {
      owner,
      name,
      description: `Flight Deck launch ${cfg.id} (disposable; created by the demo instance)`,
      private: tpl.data.visibility !== "public",
      include_all_branches: false,
    });
    if (!gen.ok) throw fail(`creating ${cfg.repo} from template`, gen);
    created.push("repo");
    // The copy's default branch appears a few seconds after the repo does.
    for (let i = 0; i < 20; i += 1) {
      const c = await gh(cfg, "GET", `/repos/${cfg.repo}/commits?per_page=1`, undefined, [200, 404, 409]);
      if (c.ok && c.status === 200) break;
      await new Promise((r) => setTimeout(r, 3000));
    }
    repo = await gh(cfg, "GET", `/repos/${cfg.repo}`);
    if (!repo.ok) throw fail(`reading ${cfg.repo}`, repo);
  }
  const repoId = repo.data.id;

  for (const m of METRICS) {
    const r = await ld(cfg, "POST", `/api/v2/metrics/${cfg.projectKey}`, m, [201, 409], log);
    if (!r.ok) throw fail(`creating metric ${m.key}`, r);
    if (r.status === 201) created.push(`metric ${m.key}`);
  }
  const p = await ld(cfg, "POST", `/api/v2/projects/${cfg.projectKey}/release-policies`, releasePolicy(cfg.envKey), [201, 409], log);
  if (!p.ok) throw fail("creating release policy", p);
  if (p.status === 201) created.push("release policy");

  const map = await ld(
    cfg,
    "PATCH",
    `/api/v2/account/factory-settings/repos/${repoId}`,
    { projectKey: cfg.projectKey, autoFlagging: { enabled: true }, autoReleasing: { enabled: true } },
    undefined,
    log,
  );
  if (!map.ok) throw fail(`mapping ${cfg.repo} to ${cfg.projectKey}`, map);
  if (map.data && map.data.version === 1) created.push(map.usedAccountKey ? "mapping (with LD_API_KEY)" : "mapping (with the project token)");

  log(`launch ${cfg.id}: ${cfg.repo} (id ${repoId}) mapped to ${cfg.projectKey}${created.length ? `; created ${created.join(", ")}` : "; everything already existed"}`);
  return { repo: cfg.repo, repoId, created };
}

/** Unmap and delete this launch's repo. The depot deletes the project itself. */
export async function teardownLaunch(cfg, log = () => {}) {
  if (!cfg.enabled) throw new Error(`launch teardown needs ${cfg.missing.join(", ")}`);
  const result = { unmapped: false, deletedRepo: false };
  const repo = await gh(cfg, "GET", `/repos/${cfg.repo}`, undefined, [200, 404]);
  if (repo.status === 404) {
    log(`${cfg.repo} is already gone`);
    return result;
  }
  if (!repo.ok) throw fail(`looking up ${cfg.repo}`, repo);
  const un = await ld(cfg, "DELETE", `/api/v2/account/factory-settings/repos/${repo.data.id}`, undefined, [200, 204, 404], log);
  result.unmapped = un.ok;
  if (!un.ok) log(`unmap failed: HTTP ${un.status}`);
  const del = await gh(cfg, "DELETE", `/repos/${cfg.repo}`, undefined, [204, 404]);
  result.deletedRepo = del.ok;
  if (!del.ok) log(`repo delete failed: HTTP ${del.status} (token needs the delete_repo scope)`);
  log(`launch ${cfg.id} torn down: unmapped=${result.unmapped} deletedRepo=${result.deletedRepo}`);
  return result;
}
