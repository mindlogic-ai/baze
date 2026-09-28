import assert from 'node:assert/strict';
import { test } from 'node:test';
import { KNOWN_TYPES, usd } from './models.js';
import { byType } from '../catalog.js';
import type { ModelRow } from '../types.js';

const row = (id: string, type: ModelRow['type']): ModelRow => ({
  id,
  type,
  lane: 'compat',
  contextLimit: null,
  pricing: null,
});

const ROWS: ModelRow[] = [
  row('gpt-5.6-terra', 'llm'),
  row('text-embedding-3-small', 'embedding'),
  row('qwen3-rerank', 'rerank'),
];

test('--type selects one category, not a prefix match', () => {
  assert.deepEqual(byType(ROWS, 'embedding').map((r) => r.id), ['text-embedding-3-small']);
  assert.deepEqual(byType(ROWS, 'rerank').map((r) => r.id), ['qwen3-rerank']);
});

test('KNOWN_TYPES is every type the gateway sends', () => {
  // `/models` with no ?type= returns all eight, in this order (models.py
  // GATEWAY_MODEL_TYPES). A missing entry here rejects a type the server serves:
  // `decisions` was missing and `baze models --type decisions` said "Unknown".
  assert.deepEqual([...KNOWN_TYPES], ['llm', 'audio', 'image', 'video', 'embedding', 'rerank', 'decisions', 'realtime']);
});

test('a price keeps the digits it has, up to four', () => {
  // jev-latest is $0.042 per 1M; two fixed decimals printed 0.04.
  assert.equal(usd(0.042), '0.042');
  assert.equal(usd(2), '2.00');
  assert.equal(usd(0.13), '0.13');
  assert.equal(usd(null), '-');
});
