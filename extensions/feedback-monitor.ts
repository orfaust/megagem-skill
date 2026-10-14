import { randomUUID } from "node:crypto";
import { EVENT_NOTICE } from "./feedback-guard.ts";
/** Queue a model turn as a user-role message (measured far more reliable than a custom-role trigger). */
export function publishFeedbackToPi(pi: any, job: any) {
  const data = { feedbackId: job.id, state: job.state, task: job.taskLabel, project: job.project, pane: job.paneId,
    tab: job.tabId, workspace: job.workspaceId, session: job.sessionId };
  const content = `${EVENT_NOTICE}Megagem worker event: ${JSON.stringify(data)}. This is NOT proof the task succeeded. Required: check herdr agent get/read for that pane and verify actual files/tests, then ALWAYS give the user a visible reply in this main chat with the verified result or blocker (never an empty reply). For blocked/uncertain/interrupted/monitor_error, report the blocker; do not approve, repeat the prompt or run queued work automatically.`;
  pi.sendUserMessage(content, { deliverAs: "followUp" });
}

const SETTLED = new Set(["done", "idle"]);

function samePath(a, b) {
  const normalize = value => String(value ?? "").replace(/[\\/]+/g, "/").replace(/\/$/, "").toLowerCase();
  return normalize(a) === normalize(b);
}

function identity(agent, job) {
  return agent?.pane_id === job.paneId && agent?.tab_id === job.tabId &&
    agent?.workspace_id === job.workspaceId && agent?.agent_session?.value === job.sessionId &&
    samePath(agent?.cwd, job.project);
}

/** Monitor only prompts Megagem actually delivered; never infer success from a terminal title. */
export function createFeedbackMonitor({ run, publish, save, authorize = async () => { throw new Error("Dispatch policy unavailable; no prompt sent"); }, schedule = setTimeout, cancel = clearTimeout, now = Date.now, intervalMs = 2000 }) {
  const jobs = new Map();
  const timers = new Map();
  let generation = 0;

  const agentGet = async paneId => (await run(["agent", "get", paneId])).result?.agent;

  function arm(job, delay = intervalMs) {
    const token = generation;
    timers.set(job.id, schedule(() => {
      timers.delete(job.id);
      if (generation === token && jobs.get(job.id) === job) void check(job);
    }, delay));
  }

  function finish(job, state) {
    if (jobs.get(job.id) !== job) return;
    jobs.delete(job.id);
    const timer = timers.get(job.id);
    if (timer !== undefined) cancel(timer);
    timers.delete(job.id);
    // Persist before publishing so a reload cannot replay an already delivered event.
    save({ stage: "notified", id: job.id });
    publish({ ...job, state });
  }

  async function check(job) {
    try {
      const agent = await agentGet(job.paneId);
      if (jobs.get(job.id) !== job) return;
      if (!identity(agent, job)) return finish(job, "interrupted");
      const seq = agent.state_change_seq;
      const changed = typeof seq === "number" && seq > job.baselineSeq;
      if (agent.agent_status === "working") job.sawWork = true;
      if (agent.agent_status === "blocked") return finish(job, "blocked");
      if (SETTLED.has(agent.agent_status) && (changed || job.sawWork)) return finish(job, "settled");
      if (agent.agent_status === "unknown" && (changed || job.sawWork)) return finish(job, "uncertain");
      if (!job.sawWork && now() - job.createdAt > 30_000) return finish(job, "uncertain");
      if (now() - job.createdAt > 8 * 60 * 60_000) return finish(job, "uncertain");
      job.failures = 0;
    } catch {
      if (jobs.get(job.id) !== job) return;
      if (++job.failures >= 3) return finish(job, "monitor_error");
    }
    arm(job);
  }

  async function dispatch({ paneId, tabId, workspaceId, sessionId, project, taskLabel, prompt, consent, requestedAgent, requestedProvider }) {
    if (Array.from(jobs.values()).some(job => job.paneId === paneId)) throw new Error("A Megagem prompt is already being monitored in this pane");
    const requested = { paneId, tabId, workspaceId, sessionId, project, taskLabel, prompt };
    const before = await agentGet(paneId);
    if (!identity(before, requested) || !SETTLED.has(before.agent_status) || before.interactive_ready === false ||
      typeof before.state_change_seq !== "number") throw new Error("Worker identity or readiness could not be verified; prompt not sent");
    await authorize({ ...requested, consent, requestedAgent, requestedProvider }, before); // Last check before prompt; must re-read preferences on every invocation.
    const response = await run(["agent", "prompt", paneId, prompt]); // Never --wait.
    if (response.result?.type !== "agent_prompted" || !identity(response.result.agent, requested)) {
      throw new Error("Prompt submission is uncertain: inspect Herdr before retrying; never duplicate blindly");
    }
    const job = {
      id: randomUUID(), paneId, tabId, workspaceId, sessionId, project, taskLabel,
      baselineSeq: before.state_change_seq, createdAt: now(), sawWork: false, failures: 0,
    };
    save({ stage: "pending", job }); // Exclude the prompt and worker output from persisted state.
    jobs.set(job.id, job);
    arm(job, 0);
    return { id: job.id, paneId, tabId, workspaceId, state: "submitted" };
  }

  function restore(entries) {
    stop();
    const pending = new Map();
    for (const entry of entries) {
      if (entry?.stage === "pending" && entry.job?.id) pending.set(entry.job.id, entry.job);
      if (entry?.stage === "notified") pending.delete(entry.id);
    }
    for (const job of pending.values()) {
      if (!job.paneId || !job.sessionId) continue;
      job.failures = 0;
      jobs.set(job.id, job);
      arm(job, 0);
    }
  }

  function stop() {
    generation++;
    for (const timer of timers.values()) cancel(timer);
    timers.clear();
    jobs.clear();
  }

  return { dispatch, restore, stop };
}
