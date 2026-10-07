import { test } from 'node:test';
import assert from 'node:assert/strict';
import { claudeEnv } from '../harness/claude.js';
import { mergeClaudeSettings } from '../writers/backup.js';
import { dryRunText } from './setup.js';

const KEY = 'sk-baze-0123456789abcdefWXYZ';

test('the dry-run Claude settings show the key masked, never in full', () => {
  const next = mergeClaudeSettings({}, claudeEnv({ apiKey: KEY, apiBase: 'https://factchat-cloud.mindlogic.ai' }));
  const text = `${JSON.stringify(next, null, 2)}\n`;
  assert.ok(text.includes(KEY), 'the real write carries the real key');
  const shown = dryRunText(text, KEY);
  assert.ok(!shown.includes(KEY));
  assert.match(shown, /"ANTHROPIC_AUTH_TOKEN": "sk-baz\.\.\.WXYZ"/);
});

test('every occurrence is masked and nothing else changes', () => {
  const text = `a=${KEY}\nb=${KEY}\nc=keep\n`;
  assert.equal(dryRunText(text, KEY), 'a=sk-baz...WXYZ\nb=sk-baz...WXYZ\nc=keep\n');
});

test('a config that names the variable instead of the key is printed as is', () => {
  const text = 'env_key = "BAZE_API_KEY"\n';
  assert.equal(dryRunText(text, KEY), text);
});

test('an empty key masks nothing', () => {
  assert.equal(dryRunText('x', ''), 'x');
});
