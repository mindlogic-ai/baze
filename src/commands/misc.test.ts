import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shouldCheckUpdate, updateNudge } from './misc.js';

const NOW = new Date('2026-09-16T12:00:00Z');

test('checks when nothing has been recorded', () => {
  assert.equal(shouldCheckUpdate(undefined, NOW), true);
});

test('does not check twice within 24 hours', () => {
  assert.equal(shouldCheckUpdate({ last_check: '2026-09-16T06:00:00Z' }, NOW), false);
});

test('checks again after 24 hours', () => {
  assert.equal(shouldCheckUpdate({ last_check: '2026-09-15T06:00:00Z' }, NOW), true);
});

test('a corrupt timestamp is treated as never checked', () => {
  assert.equal(shouldCheckUpdate({ last_check: 'yesterday' }, NOW), true);
});

test('nudges only when the latest version differs', () => {
  assert.equal(updateNudge('0.1.0', '0.1.0'), undefined);
  assert.match(String(updateNudge('0.1.0', '0.2.0')), /0\.2\.0/);
});
