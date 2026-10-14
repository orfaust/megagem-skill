import { readFile, mkdir, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

export const PRIORITIES = ["high", "normal", "low", "deny"];
export const DEFAULT_PRIORITY = "normal";
export const STORE_NAME = "megagem-providers.json";
const EMPTY = () => ({ version: 2, providers: {}, agents: {} });

export function providerStorePath(env = process.env) {
  const configured = env.PI_CODING_AGENT_DIR;
  return join(configured ? configured.replace(/^~(?=[\\/]|$)/, homedir()) : join(homedir(), ".pi", "agent"), STORE_NAME);
}

function plain(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
function validateMap(value) {
  if (!plain(value)) throw new Error("invalid priority map");
  for (const [name, priority] of Object.entries(value)) {
    if (!name || ["__proto__", "constructor", "prototype"].includes(name) || !PRIORITIES.includes(priority)) throw new Error("invalid priority entry");
  }
}
export function validateConfig(value) {
  if (!plain(value) || ![1, 2].includes(value.version) || !plain(value.providers) ||
      Object.keys(value).some(key => !["version", "providers", ...(value.version === 2 ? ["agents"] : [])].includes(key))) throw new Error("invalid preferences schema");
  validateMap(value.providers);
  if (value.version === 2) validateMap(value.agents);
  // In-memory upgrade only: reading/status never modifies the v1 file.
  return { version: 2, providers: { ...value.providers }, agents: value.version === 2 ? { ...value.agents } : {} };
}

export async function loadPreferences(path = providerStorePath()) {
  let text;
  try { text = await readFile(path, "utf8"); }
  catch (error) { if (error?.code === "ENOENT") return EMPTY(); throw error; }
  try { return validateConfig(JSON.parse(text)); }
  catch (error) { throw new Error(`Provider preferences invalid at ${path}: ${error.message}`); }
}

export async function savePreferences(config, path = providerStorePath()) {
  // Fail closed for invalid data; atomic rename preserves the old file on errors.
  const checked = validateConfig(config);
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  try {
    await writeFile(temp, `${JSON.stringify(checked, null, 2)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
    await rename(temp, path);
  } catch (error) {
    await unlink(temp).catch(() => {});
    throw error;
  }
}

export function listProviders(registry) {
  if (!registry || typeof registry.getAvailable !== "function" || typeof registry.getError !== "function") throw new Error("Pi model registry unavailable");
  if (registry.getError()) throw new Error("Pi model catalog unavailable; check Pi model configuration");
  const models = registry.getAvailable();
  if (!Array.isArray(models)) throw new Error("Pi available model list unavailable");
  return [...new Set(models.map(model => model.provider).filter(name => typeof name === "string" && name.length > 0))].sort();
}

export function parseProviderArgs(args) {
  const parts = String(args ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0 || (parts.length === 1 && parts[0] === "status")) return { action: "list" };
  if (parts.length === 3 && parts[0] === "set" && !["agent", "provider"].includes(parts[1]) && PRIORITIES.includes(parts[2])) return { action: "set", kind: "provider", name: parts[1], priority: parts[2] };
  if (parts.length === 2 && parts[0] === "reset" && !["agent", "provider"].includes(parts[1])) return { action: "reset", kind: "provider", name: parts[1] };
  if (parts.length === 4 && parts[0] === "set" && ["agent", "provider"].includes(parts[1]) && PRIORITIES.includes(parts[3])) return { action: "set", kind: parts[1], name: parts[2], priority: parts[3] };
  if (parts.length === 3 && parts[0] === "reset" && ["agent", "provider"].includes(parts[1])) return { action: "reset", kind: parts[1], name: parts[2] };
  return undefined;
}

export function priorityOf(config, name, kind = "provider") { return config[kind === "agent" ? "agents" : "providers"][name] ?? DEFAULT_PRIORITY; }
export function updatePriority(config, available, name, priority, kind = "provider") {
  if (!available.includes(name)) throw new Error(`${kind} not available: ${name}`);
  if (priority !== undefined && !PRIORITIES.includes(priority)) throw new Error("Invalid priority");
  const key = kind === "agent" ? "agents" : "providers";
  const updated = { ...config[key] };
  if (priority === undefined || priority === DEFAULT_PRIORITY) delete updated[name];
  else updated[name] = priority;
  return validateConfig({ ...config, version: 2, [key]: updated });
}

export function routingCandidates(available, config, kind = "provider") {
  return [...available].filter(name => priorityOf(config, name, kind) !== "deny")
    .sort((a, b) => PRIORITIES.indexOf(priorityOf(config, a, kind)) - PRIORITIES.indexOf(priorityOf(config, b, kind)) || a.localeCompare(b));
}

// Pair ranking is conservative: the weaker of the two preferences wins; no averaging past deny.
export function routingPairs(agents, providers, config) {
  const pairs = [];
  for (const agent of agents.filter(a => a.installed)) for (const provider of providers) {
    const ap = priorityOf(config, agent.name, "agent");
    const pp = priorityOf(config, provider);
    if (ap === "deny" || pp === "deny") continue;
    pairs.push({ agent: agent.name, provider, priority: PRIORITIES[Math.max(PRIORITIES.indexOf(ap), PRIORITIES.indexOf(pp))] });
  }
  return pairs.sort((a, b) => PRIORITIES.indexOf(a.priority) - PRIORITIES.indexOf(b.priority) || a.agent.localeCompare(b.agent) || a.provider.localeCompare(b.provider));
}

// Presentation only. Global priority first, then exact name and kind for deterministic ties.
// Sorting never mutates the inventories or persisted maps.
export function sortPriorityRows(rows, config) {
  return [...rows].sort((a, b) =>
    PRIORITIES.indexOf(priorityOf(config, a.name, a.kind)) - PRIORITIES.indexOf(priorityOf(config, b.name, b.kind)) ||
    (a.name < b.name ? -1 : a.name > b.name ? 1 : 0) ||
    (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0));
}

export function visiblePriorityRows(providers, agents, config) {
  return sortPriorityRows([
    ...providers.map(name => ({ kind: "provider", name })),
    ...agents.filter(agent => agent.name !== "pi" && agent.installed === true)
      .map(({ name }) => ({ kind: "agent", name })),
  ], config);
}

export function formatPriorityList(providers, agents, config) {
  const rows = visiblePriorityRows(providers, agents, config);
  return rows.length ? rows.map(row => `${row.kind} ${row.name}: ${priorityOf(config, row.name, row.kind)}${row.kind === "agent" ? " (installed)" : ""}`).join("\n")
    : "No authenticated chat providers or installed non-Pi coding agents found.";
}

export function formatProviderList(available, config) {
  return available.length ? sortPriorityRows(available.map(name => ({ kind: "provider", name })), config)
    .map(({ name }) => `${name}: ${priorityOf(config, name)}`).join("\n") : "No authenticated chat providers available in this Pi process.";
}
export function formatAgentList(agents, config) {
  const visible = sortPriorityRows(agents.filter(agent => agent.name !== "pi" && agent.installed === true)
    .map(agent => ({ ...agent, kind: "agent" })), config);
  return visible.length ? visible.map(({ name }) => `${name}: installed — ${priorityOf(config, name, "agent")}`).join("\n")
    : "No installed non-Pi coding agents found on this Pi process PATH.";
}
