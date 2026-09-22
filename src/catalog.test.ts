import { test } from 'node:test';
import assert from 'node:assert/strict';
import { byLane, chatModels, FALLBACK_ROWS, launchRows, offlineLane, pickDefault } from './catalog.js';
import type { ModelRow } from './types.js';

const row = (id: string, lane: ModelRow['lane']): ModelRow => ({
  id, type: 'llm', lane, contextLimit: 200000, pricing: null,
});

const ROWS: ModelRow[] = [
  row('claude-sonnet-5', 'anthropic'),
  row('claude-haiku-4-5-20251001', 'anthropic'),
  row('gpt-5.6-terra', 'responses'),
  row('gemini-3.1-pro-preview', 'gemini'),
  row('deepseek-chat', 'compat'),
  { id: 'dall-e', type: 'image', lane: 'compat', contextLimit: null, pricing: null },
];

test('chatModels drops media rows', () => {
  assert.equal(chatModels(ROWS).length, 5);
});

test('byLane selects one lane', () => {
  assert.deepEqual(byLane(ROWS, 'anthropic').map((m) => m.id), ['claude-sonnet-5', 'claude-haiku-4-5-20251001']);
});

test('the Claude Code default is an Anthropic-lane model', () => {
  assert.equal(pickDefault('claude', ROWS), 'claude-sonnet-5');
});

test('the Codex default is a Responses-lane model', () => {
  assert.equal(pickDefault('codex', ROWS), 'gpt-5.6-terra');
});

test('pickDefault returns undefined when this key has nothing in that lane', () => {
  assert.equal(pickDefault('codex', byLane(ROWS, 'anthropic')), undefined);
});

test('offline, an unlisted model gets the lane the server would give it', () => {
  // Mirrors resolve_lane (server Task 5). Guessing compat for Claude would
  // lose prompt caching - the 7x case - on the one path nobody watches.
  assert.equal(offlineLane('claude-opus-5'), 'anthropic');
  assert.equal(offlineLane('gemini-3.7-flash'), 'gemini');
  assert.equal(offlineLane('gpt-5.6-sol'), 'responses');
  assert.equal(offlineLane('gpt-4o'), 'compat');
  assert.equal(offlineLane('deepseek-v4'), 'compat');
  const rows = launchRows([], 'claude-opus-5', false);
  assert.equal(rows.find((r) => r.id === 'claude-opus-5')?.lane, 'anthropic');
  assert.equal(launchRows(ROWS, 'claude-opus-5', true), ROWS); // a live catalog is never amended
});

test('the offline fallback gives every tool a default in its own lane', () => {
  // Without this, an unreachable catalog made `baze claude` throw and
  // `baze opencode` emit a model with no provider.
  for (const tool of ['claude', 'codex', 'opencode'] as const) {
    assert.ok(pickDefault(tool, FALLBACK_ROWS), `${tool} has no fallback default`);
  }
});
