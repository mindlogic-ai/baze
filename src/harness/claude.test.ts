import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertClaudeModel, buildClaudePlan, claudeEnv } from './claude.js';
import type { ModelRow } from '../types.js';

// buildClaudePlan writes its temp settings file under configDir(), which reads
// this variable when it is called - so setting it here, before any test runs,
// is enough. Without it the suite writes into the developer's real ~/.baze.
process.env.BAZE_CONFIG_DIR = mkdtempSync(join(tmpdir(), 'baze-claude-'));

const ROWS: ModelRow[] = [
  { id: 'claude-sonnet-5', type: 'llm', lane: 'anthropic', contextLimit: 200000, pricing: null },
  { id: 'gpt-5.6-terra', type: 'llm', lane: 'responses', contextLimit: 1050000, pricing: null },
];
const OPTS = { apiKey: 'k', apiBase: 'https://a.test', rows: ROWS, passthrough: [] };

test('ANTHROPIC_API_KEY is present and empty so no saved claude.ai login wins', () => {
  const env = claudeEnv(OPTS);
  assert.equal(env.ANTHROPIC_API_KEY, '');
  assert.equal(env.ANTHROPIC_AUTH_TOKEN, 'k');
  assert.equal(env.ANTHROPIC_BASE_URL, 'https://a.test/v1/gateway/claude');
});

test('a non-Claude model is refused with an explanation, not a 400', () => {
  // The fix is named in the hint, which the error boundary prints under the message.
  assert.throws(() => assertClaudeModel('gpt-5.6-terra', ROWS), (e: { hint?: string }) => /baze codex/.test(e.hint ?? ''));
});

test('a model the key does not have is "not available", not "use Codex"', () => {
  assert.throws(
    () => assertClaudeModel('claude-sonet-5', ROWS),
    (e: { message: string; hint?: string }) => /not available/.test(e.message) && /baze models/.test(e.hint ?? ''),
  );
});

test('offline, an unlisted Claude model is allowed and a GPT model is still refused', () => {
  // The fallback lists only a few ids; claude-opus-5 must not be refused for
  // that, and gpt-5.6-terra must not reach Claude Code and 400 on turn one.
  assert.doesNotThrow(() => buildClaudePlan({ ...OPTS, rows: [], catalogLive: false, model: 'claude-opus-5' }).cleanup?.());
  assert.throws(() => buildClaudePlan({ ...OPTS, rows: [], catalogLive: false, model: 'gpt-5.6-terra' }));
});

test('the plan passes --settings with a file carrying the same env', () => {
  const plan = buildClaudePlan(OPTS);
  const i = plan.args.indexOf('--settings');
  assert.notEqual(i, -1);
  const written = JSON.parse(readFileSync(plan.args[i + 1]!, 'utf8'));
  assert.equal(written.env.ANTHROPIC_BASE_URL, 'https://a.test/v1/gateway/claude');
  plan.cleanup?.();
});

test('a user --settings in the passthrough wins and we add none', () => {
  const plan = buildClaudePlan({ ...OPTS, passthrough: ['--settings', '/tmp/mine.json'] });
  assert.equal(plan.args.filter((a) => a === '--settings').length, 1);
  plan.cleanup?.();
});

test('cleanup removes the temp settings file', () => {
  const plan = buildClaudePlan(OPTS);
  const path = plan.args[plan.args.indexOf('--settings') + 1]!;
  plan.cleanup?.();
  assert.throws(() => readFileSync(path, 'utf8'));
});
