import { constants } from "node:fs";
import { appendFile, lstat, open, readFile, realpath } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export const BEGIN_MARKER = "<!-- MEGAGEM ACTIVATION BEGIN -->";
export const END_MARKER = "<!-- MEGAGEM ACTIVATION END -->";

// Pi's dynamic-resources example uses the same module URL to locate bundled resources.
// getAgentDir() would locate the user's settings, NOT a git/npm-installed package.
export const bundledSkillPath = join(dirname(dirname(fileURLToPath(import.meta.url))), "skills", "megagem", "SKILL.md");

export function activationBlock(skillPath: string): string {
  return `${BEGIN_MARKER}\n## Megagem for this project\nOn a request that names this project or uses an explicit \`megagem:\` or \`taskman:\` prefix, read the full Megagem rules at ${JSON.stringify(skillPath)} and coordinate the task in this Pi chat. Answer informational questions directly without dispatching workers. Do not dispatch merely because these instructions are present.\n${END_MARKER}\n`;
}

type CommandAPI = Pick<ExtensionAPI, "registerCommand" | "getCommands">;

// Serialize this command's concurrent calls in one Pi process without changing the user's tabs.
// Node's exclusive-create and the re-read below still fail closed on unexpected outside edits.
const initQueues = new Map<string, Promise<void>>();
async function withInitFileQueue(path: string, action: () => Promise<void>) {
  const previous = initQueues.get(path) ?? Promise.resolve();
  const current = previous.catch(() => {}).then(action);
  initQueues.set(path, current);
  try { await current; } finally { if (initQueues.get(path) === current) initQueues.delete(path); }
}

/** Only /megagem-init is registered; /skill:megagem is Pi's native command. */
export function registerMegagemCommand(pi: CommandAPI, skillPath: string = bundledSkillPath) {
  pi.registerCommand("megagem-init", {
    description: "Confirm and add Megagem activation instructions to this project's AGENTS.md (next session)",
    handler: async (_args, ctx) => {
      const skillCommand = pi.getCommands().find(command => command.name === "skill:megagem" && command.source === "skill");
      if (!skillCommand) {
        ctx.ui.notify("Megagem skill unavailable: reload or install the package; AGENTS.md unchanged.", "error");
        return;
      }
      if (!ctx.hasUI || (ctx.mode !== "tui" && ctx.mode !== "rpc") || typeof ctx.ui.confirm !== "function") {
        ctx.ui.notify("Megagem init requires a confirmation-capable UI; AGENTS.md unchanged.", "error");
        return;
      }
      try {
        if (!isAbsolute(skillPath)) throw new Error("installed skill file missing");
        let skillStat;
        try { skillStat = await lstat(skillPath); }
        catch (error: any) { if (error?.code === "ENOENT") throw new Error("installed skill file missing"); throw error; }
        if (!skillStat.isFile()) throw new Error("installed skill file missing");
        const installedSkill = await realpath(skillPath);
        // A same-named skill from a different package must never be used as proof of THIS installation.
        // Pi's public SlashCommandInfo carries sourceInfo.path for the skill it actually loaded.
        const loadedPath = skillCommand.sourceInfo?.path;
        if (typeof loadedPath === "string" && isAbsolute(loadedPath)) {
          let actualLoadedPath;
          try { actualLoadedPath = await realpath(loadedPath); }
          catch { throw new Error("loaded megagem skill path could not be verified"); }
          if (actualLoadedPath !== installedSkill) throw new Error("loaded megagem skill belongs to a different installation");
        }
        const project = await realpath(ctx.cwd);
        const path = join(project, "AGENTS.md");
        // Validate before and again after the dialog. Never follow a symlink to another file.
        const inspect = async () => {
          let stat;
          try { stat = await lstat(path); }
          catch (error: any) { if (error?.code === "ENOENT") return { exists: false as const, content: "" }; throw error; }
          if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("AGENTS.md is not a regular file; no change made");
          const content = await readFile(path, "utf8");
          const beginCount = content.split(BEGIN_MARKER).length - 1;
          const endCount = content.split(END_MARKER).length - 1;
          if (beginCount || endCount) {
            if (beginCount === 1 && endCount === 1 && content.indexOf(BEGIN_MARKER) < content.indexOf(END_MARKER))
              return { exists: true as const, content, active: true };
            throw new Error("AGENTS.md has incomplete or duplicate Megagem markers; no change made");
          }
          return { exists: true as const, content, active: false };
        };
        const before = await inspect();
        if (before.exists && before.active) {
          ctx.ui.notify(`Megagem already initialized in ${path}; AGENTS.md unchanged.`, "info");
          return;
        }
        const action = before.exists ? "append to" : "create";
        const confirmed = await ctx.ui.confirm("Activate Megagem for this project?", `${action} ${path} with a Megagem activation block referencing ${installedSkill}? This changes project instructions from the NEXT session.`);
        if (!confirmed) {
          ctx.ui.notify("Megagem init cancelled; AGENTS.md unchanged.", "info");
          return;
        }
        let outcome = "";
        await withInitFileQueue(path, async () => {
          const current = await inspect();
          if (current.exists && current.active) { outcome = "already"; return; }
          if (current.exists !== before.exists || current.content !== before.content)
            throw new Error("AGENTS.md changed during confirmation; no change made. Review and retry.");
          const block = activationBlock(installedSkill);
          if (!current.exists) {
            const file = await open(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
            try { await file.writeFile(block, "utf8"); } finally { await file.close(); }
            outcome = "created";
          } else {
            const separator = current.content === "" ? "" : current.content.endsWith("\n") ? "\n" : "\n\n";
            await appendFile(path, separator + block, { encoding: "utf8", flag: "a" });
            outcome = "appended";
          }
        });
        ctx.ui.notify(outcome === "already"
          ? `Megagem already initialized in ${path}; AGENTS.md unchanged.`
          : `Megagem activation ${outcome} in ${path}. It takes effect from the NEXT session (AGENTS.md is loaded at startup).`, "info");
      } catch (error) {
        ctx.ui.notify(`Megagem init blocked: ${error instanceof Error ? error.message : String(error)}. AGENTS.md was not intentionally modified.`, "error");
      }
    },
  });
}

export default function (pi: ExtensionAPI) { registerMegagemCommand(pi); }
