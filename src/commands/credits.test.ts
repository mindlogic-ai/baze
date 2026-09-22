import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatCredits, type CreditBalance } from './credits.js';

const BODY: CreditBalance = {
  object: 'credit_balance',
  monthly_allocated: { quota: 10000, used: 2500, remaining: 7500, renewal_date: '2026-10-01T00:00:00+09:00' },
  purchased: { quota: 50000, used: 12000, remaining: 38000 },
  org_granted: { quota: 0, used: 0, remaining: 0 },
  total: { quota: 60000, used: 14500, remaining: 45500 },
};

test('shows every funded bucket and the total', () => {
  const text = formatCredits(BODY).join('\n');
  assert.match(text, /monthly/i);
  assert.match(text, /purchased/i);
  assert.match(text, /45,500/);
});

test('names the renewal date when there is one', () => {
  assert.match(formatCredits(BODY).join('\n'), /2026-10-01/);
});

test('hides an all-zero org_granted bucket instead of printing a row of zeros', () => {
  assert.doesNotMatch(formatCredits(BODY).join('\n'), /org granted/i);
});

test('shows org_granted when it is funded', () => {
  const funded = { ...BODY, org_granted: { quota: 100, used: 10, remaining: 90 } };
  assert.match(formatCredits(funded).join('\n'), /org granted/i);
});
