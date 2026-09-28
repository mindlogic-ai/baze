import assert from 'node:assert/strict';
import { test } from 'node:test';
import { displayWidth, fit, formatCredits, shortPath, termWidth } from './ui.js';

test('fit cuts with an ellipsis and never exceeds the width', () => {
  assert.equal(fit('abcdef', 10), 'abcdef');
  assert.equal(fit('abcdef', 4), 'abc…');
  assert.equal(fit('abcdef', 0), '');
});

test('a home path reads with ~', () => {
  assert.equal(shortPath('/Users/a/.claude/settings.json', '/Users/a'), '~/.claude/settings.json');
  assert.equal(shortPath('/Users/ab/x', '/Users/a'), '/Users/ab/x');
});

test('piped output is not cut unless COLUMNS asks', () => {
  // Tests run with stdout piped.
  const saved = process.env.COLUMNS;
  delete process.env.COLUMNS;
  assert.equal(termWidth(), Number.POSITIVE_INFINITY);
  process.env.COLUMNS = '90';
  assert.equal(termWidth(), 90);
  if (saved === undefined) delete process.env.COLUMNS;
  else process.env.COLUMNS = saved;
});

test('a charge under 0.01 keeps four decimals', () => {
  assert.equal(formatCredits(0.0015), '0.0015');
  assert.equal(formatCredits(33.756), '33.76');
  assert.equal(formatCredits(0), '0');
});

test('Korean text is fitted by the columns it takes, not by its length', () => {
  assert.equal(displayWidth('청약홈'), 6);
  const cut = fit('분양 announcements 청약홈', 10);
  assert.ok(displayWidth(cut) <= 10);
  assert.ok(cut.endsWith('…'));
});
