import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatUsage, usageQuery, type UsageSummary } from './usage.js';

const BODY: UsageSummary = {
  object: 'usage_summary',
  start_date: '2026-09-01',
  end_date: '2026-09-16',
  timezone: 'Asia/Seoul',
  group_by: 'model',
  scope: 'key',
  total: { call_count: 1200, credits: 34567.8 },
  rows: [
    { key: 'claude-sonnet-5', call_count: 900, credits: 30000 },
    { key: 'gpt-5.6-terra', call_count: 300, credits: 4567.8 },
  ],
};

test('names the window and every row', () => {
  const text = formatUsage(BODY).join('\n');
  assert.match(text, /2026-09-01 to 2026-09-16/);
  assert.match(text, /claude-sonnet-5/);
  assert.match(text, /gpt-5\.6-terra/);
});

test('prints a total line', () => {
  assert.match(formatUsage(BODY).join('\n'), /total\s+1,200/);
});

test('--by key asks for every key the member owns; one key grouped by key is a one-row table', () => {
  assert.equal(usageQuery(new Map([['by', 'key']])).get('scope'), 'member');
  assert.equal(usageQuery(new Map()).get('scope'), 'key');
  assert.equal(usageQuery(new Map([['by', 'key'], ['scope', 'key']])).get('scope'), 'key');
  assert.equal(usageQuery(new Map([['scope', 'member']])).get('by'), 'model');
});

test('an empty result says so instead of printing an empty table', () => {
  const empty = { ...BODY, total: { call_count: 0, credits: 0 }, rows: [] };
  assert.match(formatUsage(empty).join('\n'), /No gateway calls/i);
});

test('credits always carry two decimals so the column lines up', async () => {
  const { formatUsage } = await import('./usage.js');
  const lines = formatUsage({
    object: 'usage', start_date: '2026-09-01', end_date: '2026-09-28', timezone: 'Asia/Seoul', group_by: 'model', scope: 'key',
    total: { call_count: 1200, credits: 2007.42 },
    rows: [
      { key: 'seedance', call_count: 3, credits: 845.9 },
      { key: 'veo', call_count: 1197, credits: 1161.52 },
    ],
  });
  assert.ok(lines.some((l) => l.endsWith('845.90')));
  assert.ok(lines.some((l) => /1,197\s+1,161\.52$/.test(l)));
});
