// Localized text for the deferred worker-completion banner.
//
// Everything language-specific lives HERE, never in the coordination logic.
// Adding a language = add one entry to TEMPLATES and one entry to STATE_WORDS.
// Any unknown/missing language degrades to the neutral English text, never to a
// broken or invented string. Machine tokens (the raw Herdr state, the key names
// `Enter` / `Ctrl+X`, agent names, workspace and tab labels) are never translated.

export const NEUTRAL_LANGUAGE = "en";

type Vars = {
  agent: string;
  workspace: string;
  tab: string;
  state: string;
};

type Template = {
  prefix: (vars: Vars) => string;
  pressEnter: string;
  dismiss: string;
};

// Human wording for the Herdr lifecycle state. The raw token is always kept in
// parentheses next to it, so the untranslated state identifier stays visible.
const STATE_WORDS: Record<string, Record<string, string>> = {
  en: { settled: "finished", blocked: "blocked", uncertain: "uncertain", interrupted: "interrupted", monitor_error: "monitor error" },
  it: { settled: "terminato", blocked: "bloccato", uncertain: "incerto", interrupted: "interrotto", monitor_error: "errore di monitoraggio" },
  es: { settled: "terminado", blocked: "bloqueado", uncertain: "incierto", interrupted: "interrumpido", monitor_error: "error de monitorización" },
  fr: { settled: "terminé", blocked: "bloqué", uncertain: "incertain", interrupted: "interrompu", monitor_error: "erreur de surveillance" },
  de: { settled: "beendet", blocked: "blockiert", uncertain: "unsicher", interrupted: "unterbrochen", monitor_error: "Überwachungsfehler" },
};

const TEMPLATES: Record<string, Template> = {
  en: {
    prefix: v => `Worker agent ${v.agent} (${v.workspace} / ${v.tab})`,
    pressEnter: "Press Enter to see the result.",
    dismiss: "Press Ctrl+X to close without waking the coordinator.",
  },
  it: {
    prefix: v => `Task dell'agente ${v.agent} (${v.workspace} / ${v.tab})`,
    pressEnter: "Premi Invio per vedere il risultato.",
    dismiss: "Premi Ctrl+X per chiudere senza avviare la verifica.",
  },
  es: {
    prefix: v => `Tarea del agente ${v.agent} (${v.workspace} / ${v.tab})`,
    pressEnter: "Pulsa Intro para ver el resultado.",
    dismiss: "Pulsa Ctrl+X para cerrar sin despertar al coordinador.",
  },
  fr: {
    prefix: v => `Tâche de l'agent ${v.agent} (${v.workspace} / ${v.tab})`,
    pressEnter: "Appuie sur Entrée pour voir le résultat.",
    dismiss: "Appuie sur Ctrl+X pour fermer sans réveiller le coordinateur.",
  },
  de: {
    prefix: v => `Aufgabe des Agenten ${v.agent} (${v.workspace} / ${v.tab})`,
    pressEnter: "Drücke Eingabe, um das Ergebnis zu sehen.",
    dismiss: "Drücke Ctrl+X, um ohne Wecken des Koordinators zu schließen.",
  },
};

// Compact stop-word markers used only to guess the language of the last user
// message. Deliberately small: a wrong guess only changes the banner wording,
// and an undecidable message falls back to the neutral text.
const MARKERS: Record<string, string[]> = {
  en: ["the", "this", "that", "and", "with", "not", "you", "please", "thanks", "hello", "when", "also", "still", "already", "more", "for", "but", "can", "should"],
  it: ["perché", "questo", "questa", "sono", "posso", "devo", "puoi", "grazie", "ciao", "quando", "anche", "ancora", "già", "così", "più", "nella", "degli", "delle", "fatto", "fare"],
  es: ["porque", "esto", "esta", "puedo", "debo", "puedes", "gracias", "hola", "cuando", "también", "todavía", "más", "para", "pero"],
  fr: ["parce", "ceci", "cette", "peux", "dois", "merci", "bonjour", "quand", "aussi", "encore", "déjà", "ainsi", "plus", "pour", "mais"],
  de: ["weil", "dies", "diese", "kann", "muss", "danke", "hallo", "wenn", "auch", "noch", "schon", "mehr", "für", "aber", "nicht", "und"],
};

const tokens = (text: string): string[] =>
  String(text ?? "").toLowerCase().split(/[^\p{L}]+/u).filter(token => token.length >= 3);

/** Guess a supported language from free text. Returns undefined when undecidable. */
export function detectLanguage(text: string): string | undefined {
  const words = new Set(tokens(text));
  if (words.size === 0) return undefined;
  let best: string | undefined;
  let bestScore = 0;
  for (const [code, markers] of Object.entries(MARKERS)) {
    let score = 0;
    for (const marker of markers) if (words.has(marker)) score++;
    if (score > bestScore) { best = code; bestScore = score; }
  }
  return bestScore >= 2 ? best : undefined;
}

/** Explicit setting wins; otherwise detection; otherwise neutral English. */
export function resolveLanguage({ explicit, lastUserText }: { explicit?: string; lastUserText?: string } = {}): string {
  const normalized = String(explicit ?? "").trim().toLowerCase().split(/[-_]/)[0];
  if (normalized && TEMPLATES[normalized]) return normalized;
  return detectLanguage(lastUserText ?? "") ?? NEUTRAL_LANGUAGE;
}

/** True when the code is one this module can render. */
export function hasLanguage(code: string): boolean {
  return Object.prototype.hasOwnProperty.call(TEMPLATES, code);
}

export function noticeText(job: {
  state?: string;
  agentName?: string;
  workspaceLabel?: string;
  workspaceId?: string;
  tabLabel?: string;
  tabId?: string;
}, language: string = NEUTRAL_LANGUAGE): { line: string; dismiss: string } {
  const lang = hasLanguage(language) ? language : NEUTRAL_LANGUAGE;
  const template = TEMPLATES[lang];
  const state = String(job.state ?? "unknown");
  const stateWord = (STATE_WORDS[lang] ?? STATE_WORDS[NEUTRAL_LANGUAGE])[state] ?? state;
  const agent = String(job.agentName || "agent unverified");
  const workspace = String(job.workspaceLabel || job.workspaceId || "?");
  const tab = String(job.tabLabel || job.tabId || "?");
  return {
    line: `${template.prefix({ agent, workspace, tab })} ${stateWord} (${state}). ${template.pressEnter}`,
    dismiss: template.dismiss,
  };
}
