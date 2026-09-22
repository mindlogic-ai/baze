import assert from 'node:assert/strict';
import { test } from 'node:test';
import { KNOWN_TYPES } from './models.js';
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
  // `/models` with no ?type= returns all seven, in this order (models.py
  // GATEWAY_MODEL_TYPES). A missing entry here rejects a type the server serves.
  assert.deepEqual([...KNOWN_TYPES], ['llm', 'audio', 'image', 'video', 'embedding', 'rerank', 'realtime']);
});
