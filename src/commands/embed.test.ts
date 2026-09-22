import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildEmbedBody } from './embed.js';

test('the body carries only fields the gateway accepts', () => {
  const body = buildEmbedBody('text-embedding-3-small', ['a', 'b'], new Map());
  assert.deepEqual(body, { model: 'text-embedding-3-small', input: ['a', 'b'] });
});

test('dimensions and task_type are forwarded when given', () => {
  const body = buildEmbedBody(
    'gemini-embedding-2',
    ['a'],
    new Map<string, string | true>([['dimensions', '256'], ['task-type', 'retrieval_query']]),
  );
  assert.equal(body.dimensions, 256);
  // The server upper-cases it, but sending the documented form keeps the 400
  // legible when someone mistypes the value.
  assert.equal(body.task_type, 'RETRIEVAL_QUERY');
});

test('a non-numeric --dimensions fails here, not as a server 400', () => {
  assert.throws(
    () => buildEmbedBody('m', ['a'], new Map<string, string | true>([['dimensions', 'big']])),
    /positive integer/,
  );
});

test('more inputs than the gateway accepts is refused before the request', () => {
  const many = Array.from({ length: 2049 }, (_, i) => `t${i}`);
  assert.throws(() => buildEmbedBody('m', many, new Map()), /2048/);
});
