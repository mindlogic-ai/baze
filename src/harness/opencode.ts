import { byLane, chatModels, FALLBACK_ROWS, launchRows, pickFirst } from '../catalog.js';
import { ENV_KEY_NAME } from '../config.js';
import { gatewayBase } from '../hosts.js';
import type { Lane, LaunchPlan, ModelRow } from '../types.js';
import { CliError } from '../ui.js';
import type { HarnessOptions } from './claude.js';

/**
 * OpenCode is the only harness that takes several providers at once, which is
 * what lets it reach the whole catalog. Each lane gets the SDK provider that
 * speaks its protocol - routing Claude through the compat provider would lose
 * prompt caching and cost about 7x.
 */
export const OPENCODE_PROVIDERS: Record<Lane, { id: string; npm: string; name: string; path: string }> = {
  anthropic: { id: 'factchat-claude', npm: '@ai-sdk/anthropic', name: 'FactChat (Claude, native)', path: '/claude/v1' },
  responses: { id: 'factchat-openai', npm: '@ai-sdk/openai', name: 'FactChat (GPT, Responses)', path: '' },
  gemini: { id: 'factchat-gemini', npm: '@ai-sdk/google', name: 'FactChat (Gemini, native)', path: '/gemini/v1beta' },
  compat: { id: 'factchat', npm: '@ai-sdk/openai-compatible', name: 'FactChat (other models)', path: '' },
};

const LANES: Lane[] = ['anthropic', 'responses', 'gemini', 'compat'];

const DEFAULT_CONTEXT = 200000;
// Used only when the catalog has no output ceiling for a model. OpenCode sends
// min(limit.output, 32000) as the request cap and treats a missing value as
// 32000, so an unknown number must be stated, not left out. The native lanes'
// current models all allow 32k; the compat lane includes 8k models.
const UNKNOWN_OUTPUT: Record<Lane, number> = { anthropic: 32000, responses: 32000, gemini: 32000, compat: 8192 };

// Following GenCode: titles and summaries on a small model, and sub-agents on
// a flash-class model with a step cap rather than on the primary.
const SMALL_PREFERRED = ['claude-haiku-4-5-20251001', 'gemini-3.5-flash-lite', 'gpt-5.4-mini'];
const SUBAGENT_PREFERRED = ['gemini-3.6-flash', 'gemini-3.5-flash', 'claude-haiku-4-5-20251001'];
const SUBAGENT_STEPS = { explore: 100, general: 200 } as const;

function modelEntry(m: ModelRow): Record<string, unknown> {
  const context = m.contextLimit ?? DEFAULT_CONTEXT;
  const output = m.maxOutputTokens ?? UNKNOWN_OUTPUT[m.lane];
  const entry: Record<string, unknown> = {
    name: m.id,
    limit: { context, output: Math.min(output, context) },
  };
  // Stock OpenCode reads `cost` the way models.dev defines it: USD per 1M
  // tokens. So this is list price in dollars - never credits, which only a
  // forked OpenCode (GenCode) can display. The settled charge is in `baze usage`.
  if (m.pricing) {
    // Only rates the model really has. OpenCode expects numbers here, and a
    // null would render as "$0.00/1M" - a discount nobody offers.
    const cost: Record<string, number> = {};
    const rates: ReadonlyArray<readonly [string, number | null]> = [
      ['input', m.pricing.inputPer1mUsd],
      ['output', m.pricing.outputPer1mUsd],
      ['cache_read', m.pricing.cacheReadPer1mUsd],
      ['cache_write', m.pricing.cacheWritePer1mUsd],
    ];
    for (const [key, value] of rates) if (value !== null) cost[key] = value;
    if (Object.keys(cost).length > 0) entry.cost = cost;
  }
  return entry;
}

/**
 * Make sure the pinned model is something OpenCode will accept. A live catalog
 * is authoritative, so an unknown id is refused. Offline, launchRows adds it
 * in the lane its family implies - never a blanket compat, which for Claude
 * is the 7x lane.
 */
function rowsFor(o: HarnessOptions): ModelRow[] {
  const live = o.catalogLive !== false;
  if (live && o.model && !chatModels(o.rows).some((r) => r.id === o.model)) {
    throw new CliError(`${o.model} is not available to this key.`, {
      hint: 'Run `baze models` to see what it can call.',
    });
  }
  return launchRows(o.rows, o.model, live);
}

export function providerIdFor(model: string, rows: ModelRow[]): string {
  const row = chatModels(rows).find((r) => r.id === model);
  return OPENCODE_PROVIDERS[row?.lane ?? 'compat'].id;
}

export function opencodeConfig(o: HarnessOptions): unknown {
  const rows = rowsFor(o);
  const provider: Record<string, unknown> = {};
  const ref = (id: string): string => `${providerIdFor(id, rows)}/${id}`;

  for (const lane of LANES) {
    const models = byLane(rows, lane);
    if (models.length === 0) continue;
    const spec = OPENCODE_PROVIDERS[lane];
    provider[spec.id] = {
      npm: spec.npm,
      name: spec.name,
      options: { baseURL: `${gatewayBase(o.apiBase)}${spec.path}`, apiKey: `{env:${ENV_KEY_NAME}}` },
      models: Object.fromEntries(models.map((m) => [m.id, modelEntry(m)])),
    };
  }

  const config: Record<string, unknown> = { $schema: 'https://opencode.ai/config.json', provider };
  if (o.model) config.model = ref(o.model);

  const small = pickFirst(SMALL_PREFERRED, rows);
  if (small) config.small_model = ref(small);
  const sub = pickFirst(SUBAGENT_PREFERRED, rows);
  if (sub) {
    config.agent = {
      explore: { model: ref(sub), steps: SUBAGENT_STEPS.explore },
      general: { model: ref(sub), steps: SUBAGENT_STEPS.general },
    };
  }
  return config;
}

/**
 * OPENCODE_CONFIG_CONTENT merges on top of the user's global and project
 * config, so this adds our providers for one launch and writes nothing.
 */
export function buildOpencodePlan(o: HarnessOptions): LaunchPlan {
  const config = opencodeConfig(o) as { provider: Record<string, { models: Record<string, unknown> }> };
  const providers = Object.values(config.provider);
  const count = providers.reduce((n, p) => n + Object.keys(p.models).length, 0);
  const notes = [
    `OpenCode -> ${providers.length} FactChat providers, ${count} models${o.model ? ` · default ${o.model}` : ''}`,
    'Nothing was written to disk; your opencode.json is untouched.',
  ];
  if (o.catalogLive === false && o.model && !FALLBACK_ROWS.some((r) => r.id === o.model)) {
    notes.push(`${o.model} could not be checked against this key; it was routed by its model family.`);
  }
  return {
    bin: 'opencode',
    args: [...o.passthrough],
    env: {
      [ENV_KEY_NAME]: o.apiKey,
      OPENCODE_CONFIG_CONTENT: JSON.stringify(config),
    },
    notes,
  };
}
