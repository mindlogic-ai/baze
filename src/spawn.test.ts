import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describePlan, runPlan } from './spawn.js';

const plan = (script: string) => ({ bin: 'sh', args: ['-c', script], env: {}, notes: [] });

test('a normal non-zero exit is passed through', async () => {
  assert.equal(await runPlan(plan('exit 3'), { dryRun: false }), 3);
});

test('a signal-killed child does not report success', async () => {
  // code === null, signal === 'SIGTERM'. `code ?? 0` used to report 0 here.
  assert.equal(await runPlan(plan('kill -TERM $$'), { dryRun: false }), 143);
});

test('cleanup runs even when the child is killed', async () => {
  let cleaned = false;
  await runPlan({ ...plan('kill -TERM $$'), cleanup: () => { cleaned = true; } }, { dryRun: false });
  assert.equal(cleaned, true);
});

test('a dry run masks every *_API_KEY, whatever the tool calls it', () => {
  const lines = describePlan({
    bin: 'hermes',
    args: [],
    env: { MINDLOGIC_API_KEY: 'baze_0123456789abcdefghijklmnopqrstuvwxyzAB', CUSTOM_BASE_URL: 'https://a.test/v1/gateway' },
    notes: [],
  }).join('\n');
  assert.equal(lines.includes('0123456789abcdef'), false);
  assert.match(lines, /CUSTOM_BASE_URL=https:\/\/a\.test\/v1\/gateway/);
});
