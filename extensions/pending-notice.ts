// Deferred worker-completion notices.
//
// When a Megagem job settles in an interactive session, the coordinator turn must
// NOT start immediately (the user may not be looking). Instead a persistent banner
// is shown and the user decides:
//   - Enter  (tui.input.submit is bound to `enter`, see docs/keybindings.md) releases
//            every pending notice, oldest first, as the user-role event messages that
//            wake the coordinator.
//   - Ctrl+X dismisses every pending notice WITHOUT waking the coordinator, for when
//            the user prefers to read the worker tab directly.
//
// `onTerminalInput` runs before the normal key handling (TuiBase.handleTerminalInput,
// pi-tui). Returning { consume: true } swallows the key. We consume ONLY when a notice
// is pending, so normal input, submit and interrupt stay untouched otherwise.

export const PENDING_WIDGET_KEY = "megagem-pending";
export const PENDING_MESSAGE_TYPE = "megagem-feedback-pending";
export const DISMISSED_MESSAGE_TYPE = "megagem-feedback-dismissed";

/**
 * Enter as it arrives from the terminal. Legacy: CR or keypad Enter. Kitty protocol:
 * ESC[13u (and the explicit unmodified ESC[13;1u). Shift+Enter / Ctrl+Enter / newline
 * (ESC[13;2u, ESC[13;5u, "\n", ESC CR) are intentionally NOT matched, so multi-line
 * editing keeps working. Pi does not export `matchesKey` to extensions; this mirrors the
 * unmodified-enter branch of parseKey in @earendil-works/pi-tui.
 */
export function isEnterKey(data: string): boolean {
  return data === "\r" || data === "\x1bOM" || /^\x1b\[13(?:;1)?u$/i.test(data);
}

/** Ctrl+X: legacy C0 control or the Kitty protocol sequence for ctrl+x. Unbound in Pi by default. */
export function isDismissKey(data: string): boolean {
  return data === "\x18" || /^\x1b\[120;5u$/i.test(data);
}

type NoticeJob = { id: string; state?: string; [key: string]: unknown };

export type PendingNoticeDeps = {
  ui: {
    setWidget: (key: string, content: string[] | undefined, options?: { placement?: "aboveEditor" | "belowEditor" }) => void;
    getEditorText?: () => string;
  };
  /** Render the banner line and the dismiss hint for a job. */
  render: (job: NoticeJob, language: string) => { line: string; dismiss: string };
  /** Language code resolved at display time. */
  getLanguage: () => string;
  /** Deliver one event as the user-role message that starts the coordinator turn. */
  publish: (job: NoticeJob) => void;
  /** Append a durable, non-turn message to the transcript. */
  sendDurable: (message: { customType: string; content: string; display: boolean; details?: unknown }) => void;
  /** Called for every job removed by release or dismiss. */
  onRemove?: (job: NoticeJob) => void;
};

/**
 * Queue of deferred notices plus the input handler that releases or dismisses them.
 * Multiple pending notices are released/dismissed together, oldest first.
 */
export function createPendingNotices(deps: PendingNoticeDeps) {
  const queue: NoticeJob[] = [];

  function lines(): string[] {
    const language = deps.getLanguage();
    const out = queue.map(job => deps.render(job, language).line);
    if (queue.length > 0) out.push(deps.render(queue[0], language).dismiss);
    return out;
  }

  function refresh() {
    deps.ui.setWidget(PENDING_WIDGET_KEY, queue.length > 0 ? lines() : undefined, { placement: "aboveEditor" });
  }

  function deliver(job: NoticeJob) {
    queue.push(job);
    refresh();
    const rendered = deps.render(job, deps.getLanguage());
    deps.sendDurable({
      customType: PENDING_MESSAGE_TYPE,
      content: rendered.line,
      display: true,
      details: { feedbackId: job.id, state: job.state },
    });
  }

  function removeAll(): NoticeJob[] {
    const jobs = queue.splice(0, queue.length);
    refresh();
    for (const job of jobs) deps.onRemove?.(job);
    return jobs;
  }

  /** Release every pending notice as a coordinator turn. Oldest first. */
  function release(): NoticeJob[] {
    const jobs = removeAll();
    for (const job of jobs) deps.publish(job);
    return jobs;
  }

  /** Close every pending notice without starting a coordinator turn. */
  function dismiss(): NoticeJob[] {
    const jobs = removeAll();
    if (jobs.length > 0) {
      deps.sendDurable({
        customType: DISMISSED_MESSAGE_TYPE,
        content: `${jobs.length} Megagem worker notice(s) dismissed without a coordinator turn.`,
        display: true,
        details: { feedbackIds: jobs.map(job => job.id) },
      });
    }
    return jobs;
  }

  function handleInput(data: string): { consume?: boolean; data?: string } | undefined {
    if (queue.length === 0) return undefined;
    if (isEnterKey(data)) {
      // A non-empty editor means the user is submitting their own message: let it through.
      if ((deps.ui.getEditorText?.() ?? "").trim() !== "") return undefined;
      release();
      return { consume: true };
    }
    if (isDismissKey(data)) {
      dismiss();
      return { consume: true };
    }
    return undefined;
  }

  return {
    deliver,
    handleInput,
    release,
    dismiss,
    refresh,
    lines,
    get size() { return queue.length; },
    get jobs() { return queue.slice(); },
  };
}

export type DeferredDeliveryDeps = {
  notices: ReturnType<typeof createPendingNotices>;
  hasUI: () => boolean;
  /** Immediate path used when there is no UI (RPC / print / JSON): behaviour unchanged. */
  publishImmediate: (job: NoticeJob) => void;
  /** Called synchronously when an event is deferred, before the async enrichment. */
  markDeferred?: (job: NoticeJob) => void;
  /** Best-effort live enrichment (agent name, workspace/tab labels). */
  enrich?: (job: NoticeJob) => Promise<NoticeJob>;
};

/**
 * Decide per event: interactive sessions defer to the banner; every other mode keeps
 * the current immediate delivery. Enrichment is chained so notices stay in dispatch order.
 */
export function createDeferredDelivery(deps: DeferredDeliveryDeps) {
  let chain: Promise<unknown> = Promise.resolve();
  const enrich = deps.enrich ?? (async (job: NoticeJob) => job);

  function deliver(job: NoticeJob): Promise<unknown> {
    if (!deps.hasUI()) {
      deps.publishImmediate(job);
      return Promise.resolve("immediate");
    }
    deps.markDeferred?.(job);
    chain = chain.then(async () => {
      let enriched = job;
      try { enriched = await enrich(job); } catch { enriched = job; }
      deps.notices.deliver(enriched);
    }, () => {}).catch(() => {});
    return chain;
  }

  return { deliver };
}
