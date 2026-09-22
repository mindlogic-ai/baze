import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCodexPlan, codexOverrides } from './codex.js';
import type { ModelRow } from '../types.js';

const ROWS: ModelRow[] = [
  { id: 'gpt-5.6-terra', type: 'llm', lane: 'responses', contextLimit: 1050000, pricing: null },
];
const OPTS = { apiKey: 'k', apiBase: 'https://a.test', model: 'gpt-5.6-terra', rows: ROWS, passthrough: [] };

test('uses the Responses wire API against the gateway root', () => {
  const flat = codexOverrides(OPTS).join(' ');
  assert.match(flat, /wire_api="responses"/);
  assert.match(flat, /base_url="https:\/\/a\.test\/v1\/gateway"/);
});

test('reads the key from an env var, never from an override value', () => {
  const flat = codexOverrides(OPTS).join(' ');
  assert.match(flat, /env_key="BAZE_API_KEY"/);
  assert.equal(flat.includes('"k"'), false);
});

test('resets service_tier, which the gateway has no priced tier for', () => {
  assert.match(codexOverrides(OPTS).join(' '), /service_tier="default"/);
});

test('disables the hosted web_search tool that 400s on the first turn', () => {
  assert.match(codexOverrides(OPTS).join(' '), /web_search="disabled"/);
});

test('a user-supplied web_search override is left alone', () => {
  const flat = codexOverrides({ ...OPTS, passthrough: ['-c', 'web_search="enabled"'] }).join(' ');
  assert.equal(flat.includes('web_search="disabled"'), false);
});

test('the key is in env, not in argv', () => {
  const plan = buildCodexPlan(OPTS);
  assert.equal(plan.env.BAZE_API_KEY, 'k');
  assert.equal(plan.args.join(' ').includes('"k"'), false);
});
