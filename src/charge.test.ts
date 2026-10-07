import assert from 'node:assert/strict';
import { test } from 'node:test';
import { billedLine, chargedCredits, chargedFromHeaders, chargeNote, historyCreditsCell } from './charge.js';

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

test('a reported charge is shown as credits', () => {
  assert.equal(chargeNote(1.08), '1.08 credits');
  assert.equal(chargeNote(0), '0 credits');
});

test('an unreported charge says billed and where the amount is, never "-" or a guess', () => {
  assert.equal(chargeNote(null), 'billed, amount not reported (see `baze usage`)');
  assert.equal(chargeNote(undefined), 'billed, amount not reported (see `baze usage`)');
});

test('history shows "billed" for a completed call without an amount, "-" otherwise', () => {
  assert.equal(historyCreditsCell({ status: 'completed', credits: 1.08 }), '1.08 cr');
  assert.equal(historyCreditsCell({ status: 'completed', credits: null }), 'billed');
  assert.equal(historyCreditsCell({ status: 'completed' }), 'billed');
  assert.equal(historyCreditsCell({ status: 'failed', credits: null }), '-');
  assert.equal(historyCreditsCell({ status: 'processing' }), '-');
});
