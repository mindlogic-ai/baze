import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildGuardBody } from './guard.js';

test('a single text is sent as an array, and mode defaults server-side', () => {
  assert.deepEqual(buildGuardBody(['call me on 010-1234-5678'], new Map()), {
    input: ['call me on 010-1234-5678'],
  });
});

test('--mode and --categories are forwarded', () => {
  const body = buildGuardBody(
    ['x'],
    new Map<string, string | true>([['mode', 'detect'], ['categories', 'phone, email']]),
  );
  assert.equal(body.mode, 'detect');
  assert.deepEqual(body.categories, ['phone', 'email']);
});

test('an unknown --mode fails here rather than as a server 400', () => {
  assert.throws(() => buildGuardBody(['x'], new Map<string, string | true>([['mode', 'redact']])), /mask.*detect/);
});

test('the category list is forwarded verbatim - the CLI keeps no copy of it', () => {
  // The accepted set lives on the server and a branch in flight narrows it.
  // Validating here would reject a category the server accepts, or accept one
  // it does not; either way the CLI would be the thing that is wrong.
  const body = buildGuardBody(['x'], new Map<string, string | true>([['categories', 'whatever']]));
  assert.deepEqual(body.categories, ['whatever']);
});

test('more items than the gateway accepts is refused locally', () => {
  const many = Array.from({ length: 101 }, (_, i) => `t${i}`);
  assert.throws(() => buildGuardBody(many, new Map()), /100/);
});
