import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runPlan } from './spawn.js';

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
