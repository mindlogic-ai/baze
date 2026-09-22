import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildRerankBody } from './rerank.js';

test('the body carries only fields the gateway accepts', () => {
  const body = buildRerankBody('qwen3-rerank', 'q', ['a', 'b'], new Map());
  assert.deepEqual(body, { model: 'qwen3-rerank', query: 'q', documents: ['a', 'b'] });
});

test('--top-n is forwarded as a number', () => {
  const body = buildRerankBody('m', 'q', ['a', 'b'], new Map<string, string | true>([['top-n', '1']]));
  assert.equal(body.top_n, 1);
});

test('a document past the gateway cap is refused locally', () => {
  const long = 'x'.repeat(32_001);
  assert.throws(() => buildRerankBody('m', 'q', [long], new Map()), /32000/);
});

test('more documents than the gateway takes is refused locally', () => {
  const many = Array.from({ length: 501 }, (_, i) => `d${i}`);
  assert.throws(() => buildRerankBody('m', 'q', many, new Map()), /500/);
});

test('an empty query is refused before the request', () => {
  assert.throws(() => buildRerankBody('m', '   ', ['a'], new Map()), /query/i);
});
