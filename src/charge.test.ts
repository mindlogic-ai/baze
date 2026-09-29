import assert from 'node:assert/strict';
import { test } from 'node:test';
import { billedLine, chargedCredits, chargedFromHeaders } from './charge.js';

test('a binary reply is charged from X-Credits-Charged, else the X-Billing block', () => {
  // Speech carries only X-Billing (KRW mode); it printed no charge at all
  // although 0.1967 credits were deducted (dev QA, 2026-09-28).
  assert.equal(chargedFromHeaders(new Headers({ 'x-credits-charged': '40' })), 40);
  assert.equal(chargedFromHeaders(new Headers({ 'x-billing': '{"deducted_credit":0.1967}' })), 0.1967);
  assert.equal(chargedFromHeaders(new Headers({ 'x-billing': 'not json' })), null);
  assert.equal(chargedFromHeaders(new Headers()), null);
});

test('a JSON reply is charged from credits_charged, else billing.deducted_credit', () => {
  assert.equal(chargedCredits({ credits_charged: 8 }), 8);
  assert.equal(chargedCredits({ billing: { deducted_credit: 0.0015 } }), 0.0015);
  assert.equal(chargedCredits({}), null);
});

test('a small charge is not printed as free', () => {
  assert.equal(billedLine('100 tokens', 0.0015), '100 tokens billed, 0.0015 credits');
  assert.equal(billedLine('3 item(s)', null), '3 item(s) billed');
});
