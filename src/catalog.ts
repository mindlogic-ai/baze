import type { Lane, ModelRow, ModelType } from './types.js';

export type Tool = 'claude' | 'codex' | 'opencode' | 'hermes';

const offline = (id: string, lane: Lane): ModelRow => ({ id, type: 'llm', lane, contextLimit: null, pricing: null });

/**
 * Stands in for the catalog only when it cannot be reached at all. These are
 * real rows with real lanes, so every plan builder works unchanged - a bare
 * model name would leave Claude Code refusing it and OpenCode with no provider.
 */
export const FALLBACK_ROWS: ModelRow[] = [
  offline('claude-sonnet-5', 'anthropic'),
  offline('claude-haiku-4-5-20251001', 'anthropic'),
  offline('gpt-5.6-terra', 'responses'),
  offline('gemini-3.1-pro-preview', 'gemini'),
];

/** Preference order per tool; the first one this key actually has wins. */
const PREFERRED: Record<Tool, string[]> = {
  claude: ['claude-sonnet-5', 'claude-opus-5', 'claude-sonnet-4-6'],
  codex: ['gpt-5.6-terra', 'gpt-5.5', 'gpt-5.4'],
  opencode: ['claude-sonnet-5', 'gpt-5.6-terra', 'gemini-3.1-pro-preview'],
  hermes: ['gpt-6.1-sol', 'claude-sonnet-5-5', 'gpt-6-luna'],
};

const LANE_FOR: Record<Tool, Lane[]> = {
  claude: ['anthropic'],
  codex: ['responses'],
  opencode: ['anthropic', 'responses', 'gemini', 'compat'],
  hermes: ['anthropic', 'responses', 'gemini', 'compat'],
};

/** One catalog category. `/models` sends seven; only `llm` is launchable. */
export const byType = (rows: ModelRow[], type: ModelType): ModelRow[] =>
  rows.filter((r) => r.type === type);

/**
 * What a coding agent can launch: text chat models. An audio-token model is
 * `llm` in the catalog, but it answers only with audio on one side and every
 * turn OpenCode sent it was a 400 (dev, 2026-09-24). `baze models` still lists it.
 */
export const chatModels = (rows: ModelRow[]): ModelRow[] => byType(rows, 'llm').filter((r) => !r.audioTokens);

export const byLane = (rows: ModelRow[], lane: Lane): ModelRow[] =>
  chatModels(rows).filter((r) => r.lane === lane);

// Offline only. The server decides lanes from `client_protocol`
// (the card's `endpoints`); without the catalog, the model id's family prefix is the
// best stand-in. These prefixes pick an HTTP path - they never interpret text.
// Keep in step with _RESPONSES_PREFIXES on the server.
const OFFLINE_LANE_PREFIXES: ReadonlyArray<readonly [string, Lane]> = [
  ['claude-', 'anthropic'],
  ['gemini-', 'gemini'],
  ['gpt-5', 'responses'],
  ['gpt-6', 'responses'],
];

export function offlineLane(id: string): Lane {
  return OFFLINE_LANE_PREFIXES.find(([prefix]) => id.startsWith(prefix))?.[1] ?? 'compat';
}

/**
 * The rows a launch plan is built from. A live catalog is authoritative and
 * returned as-is. Offline, the fallback list is used, plus the pinned model
 * if it is not on it - in the lane its family implies, so the plan builders
 * route and refuse it exactly as they would online.
 */
export function launchRows(rows: ModelRow[], model: string | undefined, live: boolean): ModelRow[] {
  if (live) return rows;
  const base = rows.length > 0 ? rows : FALLBACK_ROWS;
  if (!model || base.some((r) => r.id === model)) return base;
  return [...base, offline(model, offlineLane(model))];
}

/** The first preferred id this key actually has, or undefined. */
export function pickFirst(preferred: string[], rows: ModelRow[]): string | undefined {
  const ids = new Set(chatModels(rows).map((r) => r.id));
  return preferred.find((id) => ids.has(id));
}

export function pickDefault(tool: Tool, rows: ModelRow[]): string | undefined {
  const usable = chatModels(rows).filter((r) => LANE_FOR[tool].includes(r.lane));
  if (usable.length === 0) return undefined;
  return pickFirst(PREFERRED[tool], usable) ?? usable[0]!.id;
}
