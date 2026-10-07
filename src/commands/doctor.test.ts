import { test } from 'node:test';
import assert from 'node:assert/strict';
import { conflictingClaudeEnv, contractDrift, NODE_FLOOR, nodeSupported } from './doctor.js';

const OURS = 'https://factchat-cloud.mindlogic.ai/v1/gateway/claude';

test('no env block is no conflict', () => {
  assert.equal(conflictingClaudeEnv({}, OURS), undefined);
});

test('our own base url is no conflict', () => {
  assert.equal(conflictingClaudeEnv({ env: { ANTHROPIC_BASE_URL: OURS } }, OURS), undefined);
});

test('another gateway in settings.json is reported with its value', () => {
  const found = conflictingClaudeEnv({ env: { ANTHROPIC_BASE_URL: 'https://api.bizrouter.ai/claude' } }, OURS);
  assert.match(String(found), /bizrouter/);
});

test('a hard-coded ANTHROPIC_API_KEY is a conflict too', () => {
  assert.match(String(conflictingClaudeEnv({ env: { ANTHROPIC_API_KEY: 'sk-ant-xxx' } }, OURS)), /ANTHROPIC_API_KEY/);
});

test('an empty ANTHROPIC_API_KEY is what we ourselves write, so it is fine', () => {
  assert.equal(conflictingClaudeEnv({ env: { ANTHROPIC_API_KEY: '' } }, OURS), undefined);
});

test('a non-object settings file is not a crash', () => {
  assert.equal(conflictingClaudeEnv('nonsense', OURS), undefined);
});

test('a gateway ahead of this CLI is reported with both numbers', () => {
  assert.match(String(contractDrift(3, 1)), /contract 3.*built for 1/);
});

test('an older or silent gateway is not drift - a customer on an old server must keep working', () => {
  assert.equal(contractDrift(1, 1), undefined);
  assert.equal(contractDrift(0, 1), undefined);
  assert.equal(contractDrift(undefined, 1), undefined);
});

test('Node 20.10 and newer pass the doctor check', () => {
  for (const v of ['20.10.0', '20.18.1', '22.0.0', '24.2.0', 'v22.11.0']) assert.equal(nodeSupported(v), true, v);
});

test('Node older than 20.10 fails the doctor check', () => {
  for (const v of ['20.9.0', '20.0.0', '18.20.4', '16.0.0']) assert.equal(nodeSupported(v), false, v);
});

test('the doctor floor matches engines.node in package.json', async () => {
  const { readFileSync } = await import('node:fs');
  const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { engines: { node: string } };
  assert.equal(pkg.engines.node, `>=${NODE_FLOOR}`);
});
