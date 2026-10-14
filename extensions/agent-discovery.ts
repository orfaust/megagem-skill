import { access, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { join } from "node:path";

// Documented canonical Herdr CLI kinds; pi is still discovered for routing, but hidden in the UI.
// Fixed catalogue, not a statistical popularity ranking. Aider is informational (not Herdr-startable).
export const CODING_AGENTS = ["pi", "claude", "codex", "gemini", "opencode", "cursor", "copilot", "cline", "amp", "kiro", "qwen", "kilo", "aider"];
export const DISPLAY_AGENTS = CODING_AGENTS.filter(name => name !== "pi");
const WINDOWS_EXTENSIONS = [".COM", ".EXE", ".BAT", ".CMD"];

/** Lookup only: never execute CLI code, login commands, scripts or --version. */
export async function discoverAgents({ env = process.env, platform = process.platform, inspect = inspectFile } = {}) {
  const pathValue = env.PATH ?? env.Path ?? env.path;
  if (typeof pathValue !== "string" || !pathValue.trim()) throw new Error("PATH unavailable; CLI inventory cannot be trusted");
  const paths = pathValue.split(platform === "win32" ? ";" : ":").filter(Boolean);
  const suffixes = platform === "win32"
    ? (env.PATHEXT ?? WINDOWS_EXTENSIONS.join(";")).split(";").map(x => x.toUpperCase()).filter(x => WINDOWS_EXTENSIONS.includes(x))
    : [""];
  if (platform === "win32" && suffixes.length === 0) throw new Error("No executable PATHEXT entries");
  const result = [];
  for (const name of CODING_AGENTS) {
    let installed = false;
    for (const dir of paths) {
      // A name is fixed by the catalogue; never interpolate arbitrary user input into a shell.
      const variants = platform === "win32" ? suffixes.map(ext => join(dir, name + ext.toLowerCase())) : [join(dir, name)];
      // On case-sensitive test filesystems/windows-mounted drives, try actual PATHEXT spelling too.
      if (platform === "win32") variants.push(...suffixes.map(ext => join(dir, name + ext)));
      for (const candidate of variants) {
        if (await inspect(candidate, platform)) { installed = true; break; }
      }
      if (installed) break;
    }
    result.push({ name, installed });
  }
  return result;
}

async function inspectFile(file, platform) {
  try {
    const entry = await stat(file);
    if (!entry.isFile()) return false;
    await access(file, platform === "win32" ? constants.F_OK : constants.X_OK);
    return true;
  } catch (error) {
    if (["ENOENT", "ENOTDIR", "EACCES", "EPERM"].includes(error?.code)) return false;
    throw new Error(`Cannot inspect CLI inventory: ${error?.code ?? "unknown error"}`);
  }
}
