import { PRIORITIES, priorityOf, visiblePriorityRows } from "./provider-priority.ts";

export function createProviderTable({ tui, theme, done, providers, agents, initial, save, keys }) {
  const { Key, matchesKey, truncateToWidth } = keys;
  let rows = [];
  const sorted = config => visiblePriorityRows(providers, agents, config);
  let selected = 0;
  let scroll = 0;
  let config = initial;
  rows = sorted(config);
  let busy = false;
  let closed = false;
  let feedback = "";
  const paint = () => tui.requestRender();

  return {
    get selected() { return selected; },
    get feedback() { return feedback; },
    handleInput(data) {
      if (closed) return;
      if (matchesKey(data, Key.escape)) { closed = true; done(); return; }
      if (busy || !rows.length) return;
      if (matchesKey(data, Key.up)) { selected = Math.max(0, selected - 1); paint(); return; }
      if (matchesKey(data, Key.down)) { selected = Math.min(rows.length - 1, selected + 1); paint(); return; }
      if (!matchesKey(data, Key.left) && !matchesKey(data, Key.right)) return;
      const row = rows[selected];
      const direction = matchesKey(data, Key.right) ? 1 : -1;
      const index = PRIORITIES.indexOf(priorityOf(config, row.name, row.kind));
      const next = PRIORITIES[(index + direction + PRIORITIES.length) % PRIORITIES.length];
      busy = true;
      feedback = `Saving ${row.kind} ${row.name}: ${next}…`;
      paint();
      // Every keypress is persisted before accepting the next change. Escape may close while saving;
      // closing does not cancel an already requested write; no callbacks to the disposed screen.
      Promise.resolve().then(() => save(row, next)).then(updated => {
        config = updated;
        rows = sorted(config);
        selected = rows.findIndex(item => item.kind === row.kind && item.name === row.name);
        feedback = `Saved ${row.kind} ${row.name}: ${priorityOf(updated, row.name, row.kind)}`;
      }, error => {
        feedback = `Not saved ${row.kind} ${row.name}: ${error instanceof Error ? error.message : String(error)}`;
      }).finally(() => { busy = false; if (!closed) paint(); });
    },
    render(width) {
      const clip = text => truncateToWidth(text, Math.max(1, width), "…", true);
      const limit = Math.max(1, Math.min(rows.length, 12));
      if (selected < scroll) scroll = selected;
      if (selected >= scroll + limit) scroll = selected - limit + 1;
      const lines = [
        clip(theme.fg("accent", "Megagem priorities: set the routing priority for listed providers or installed agents.")),
        clip(theme.fg("dim", "Up/Down select · Right/Left cycle high → normal → low → deny · saved immediately · Esc closes")),
        clip(theme.fg("accent", "  level   agent     provider")),
      ];
      if (!rows.length) lines.push(clip("No providers or agents found"));
      for (let i = scroll; i < Math.min(rows.length, scroll + limit); i++) {
        const row = rows[i];
        const text = `${i === selected ? "▶" : " "} ${priorityOf(config, row.name, row.kind).padEnd(7)} ${(row.kind === "agent" ? row.name.toUpperCase() : "PI").padEnd(9)} ${row.kind === "provider" ? row.name : "—"}`;
        lines.push(clip(i === selected ? theme.fg("accent", text) : text));
      }
      if (feedback) lines.push(clip(theme.fg(feedback.startsWith("Not saved") ? "error" : "dim", feedback)));
      return lines;
    },
    invalidate() {},
    dispose() { closed = true; },
  };
}
