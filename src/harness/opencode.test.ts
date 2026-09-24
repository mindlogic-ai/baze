import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildOpencodePlan, opencodeConfig } from './opencode.js';
import type { ModelRow } from '../types.js';

const ROWS: ModelRow[] = [
  { id: 'claude-sonnet-5', type: 'llm', lane: 'anthropic', contextLimit: 200000,
    pricing: { inputPer1mUsd: 3, outputPer1mUsd: 15, cacheReadPer1mUsd: 0.3, cacheWritePer1mUsd: 3.75, cacheWrite1hPer1mUsd: 6 } },
  { id: 'claude-haiku-4-5-20251001', type: 'llm', lane: 'anthropic', contextLimit: 200000, pricing: null },
  { id: 'gpt-5.6-terra', type: 'llm', lane: 'responses', contextLimit: 1050000, pricing: null },
  { id: 'gemini-3.6-flash', type: 'llm', lane: 'gemini', contextLimit: 1000000, maxOutputTokens: 65536, pricing: null },
  { id: 'gemini-3.1-pro-preview', type: 'llm', lane: 'gemini', contextLimit: 1000000, pricing: null },
  { id: 'deepseek-chat', type: 'llm', lane: 'compat', contextLimit: 64000, maxOutputTokens: 8192, pricing: null },
  { id: 'grok-4.7', type: 'llm', lane: 'compat', contextLimit: 500000, pricing: null },
  { id: 'dall-e', type: 'image', lane: 'compat', contextLimit: null, pricing: null },
];
const OPTS = { apiKey: 'k', apiBase: 'https://a.test', model: 'claude-sonnet-5', rows: ROWS, passthrough: [] };

test('emits one provider per lane that has models', () => {
  const cfg = opencodeConfig(OPTS) as { provider: Record<string, unknown> };
  assert.deepEqual(Object.keys(cfg.provider).sort(), ['baze', 'baze-claude', 'baze-gemini', 'baze-openai']);
});

test('Claude sits on the native Anthropic provider, never the compat one', () => {
  const cfg = opencodeConfig(OPTS) as { provider: Record<string, { npm: string; models: Record<string, unknown> }> };
  assert.equal(cfg.provider['baze-claude']!.npm, '@ai-sdk/anthropic');
  assert.ok('claude-sonnet-5' in cfg.provider['baze-claude']!.models);
  assert.equal('claude-sonnet-5' in cfg.provider.baze!.models, false);
});

test('media models are not offered as chat models', () => {
  const cfg = opencodeConfig(OPTS) as { provider: Record<string, { models: Record<string, unknown> }> };
  const all = Object.values(cfg.provider).flatMap((p) => Object.keys(p.models));
  assert.equal(all.includes('dall-e'), false);
});

test('a priced model carries its list price in USD per 1M, which is what stock OpenCode displays', () => {
  // Credits here would make Sonnet read as $3,000/1M in the per-turn cost line.
  const cfg = opencodeConfig(OPTS) as { provider: Record<string, { models: Record<string, { cost?: Record<string, number> }> }> };
  const entry = cfg.provider['baze-claude']!.models['claude-sonnet-5']!;
  assert.equal(entry.cost?.input, 3);
  assert.equal(entry.cost?.cache_read, 0.3);
});

test('the small model and the sub-agents are pinned to cheap models this key has', () => {
  const cfg = opencodeConfig(OPTS) as {
    small_model: string;
    agent: Record<string, { model: string; steps: number }>;
  };
  assert.equal(cfg.small_model, 'baze-claude/claude-haiku-4-5-20251001');
  assert.equal(cfg.agent.explore!.model, 'baze-gemini/gemini-3.6-flash');
  assert.equal(cfg.agent.explore!.steps, 100);
  assert.equal(cfg.agent.general!.steps, 200);
});

test('a live catalog refuses a model this key cannot call', () => {
  assert.throws(() => opencodeConfig({ ...OPTS, model: 'not-a-model' }), (e: { hint?: string }) => /baze models/.test(e.hint ?? ''));
});

test('offline, a pinned model outside the fallback gets an entry on the lane its family implies', () => {
  // OpenCode rejects a `model` that no provider lists - and Claude on the
  // compat provider would silently lose prompt caching.
  const claude = opencodeConfig({ ...OPTS, rows: [], catalogLive: false, model: 'claude-opus-5' }) as { model: string };
  assert.equal(claude.model, 'baze-claude/claude-opus-5');
  const other = opencodeConfig({ ...OPTS, rows: [], catalogLive: false, model: 'deepseek-v4' }) as {
    model: string;
    provider: Record<string, { models: Record<string, unknown> }>;
  };
  assert.equal(other.model, 'baze/deepseek-v4');
  assert.ok(other.provider.baze?.models['deepseek-v4']);
});

test('the output limit is the catalog figure, and OpenCode\'s own 32000 when unknown', () => {
  // An 8k model carries 8192 in the catalog; a model whose provider publishes
  // no ceiling (Grok) must not be cut to 8k - it answers past 24k.
  const cfg = opencodeConfig(OPTS) as {
    provider: Record<string, { models: Record<string, { limit: { context: number; output: number } }> }>;
  };
  assert.equal(cfg.provider['baze-gemini']!.models['gemini-3.6-flash']!.limit.output, 65536);
  assert.equal(cfg.provider['baze-claude']!.models['claude-sonnet-5']!.limit.output, 32000);
  assert.equal(cfg.provider.baze!.models['deepseek-chat']!.limit.output, 8192);
  assert.equal(cfg.provider.baze!.models['grok-4.7']!.limit.output, 32000);
});

test('the default model is namespaced by its own provider', () => {
  const cfg = opencodeConfig(OPTS) as { model: string };
  assert.equal(cfg.model, 'baze-claude/claude-sonnet-5');
});

test('the config is injected by env, so no file is touched', () => {
  const plan = buildOpencodePlan(OPTS);
  assert.deepEqual(plan.args, []);
  assert.ok(plan.env.OPENCODE_CONFIG_CONTENT.length > 0);
  assert.equal(plan.env.BAZE_API_KEY, 'k');
});

test('every provider reads the key from the env var, not from a literal', () => {
  const cfg = opencodeConfig(OPTS) as { provider: Record<string, { options: { apiKey: string } }> };
  for (const p of Object.values(cfg.provider)) assert.equal(p.options.apiKey, '{env:BAZE_API_KEY}');
});
