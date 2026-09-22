import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { backup, mergeClaudeSettings, readJsonObject, writeText } from './backup.js';

test('merges our env keys and keeps the rest of the file', () => {
  const merged = mergeClaudeSettings(
    { theme: 'dark', env: { MY_VAR: '1' } },
    { ANTHROPIC_BASE_URL: 'https://a.test/v1/gateway/claude' },
  );
  assert.equal((merged as { theme: string }).theme, 'dark');
  const env = (merged as { env: Record<string, string> }).env;
  assert.equal(env.MY_VAR, '1');
  assert.equal(env.ANTHROPIC_BASE_URL, 'https://a.test/v1/gateway/claude');
});

test('creates the env block when the file has none', () => {
  const merged = mergeClaudeSettings({ theme: 'dark' }, { ANTHROPIC_API_KEY: '' });
  assert.deepEqual((merged as { env: Record<string, string> }).env, { ANTHROPIC_API_KEY: '' });
});

test('backup makes a timestamped copy and writeText is 0600', () => {
  const dir = mkdtempSync(join(tmpdir(), 'baze-w-'));
  const path = join(dir, 'config.json');
  writeFileSync(path, '{"a":1}');
  const bak = backup(path);
  assert.ok(bak && bak.includes('.bak-'));
  writeText(path, '{"a":2}');
  assert.equal(statSync(path).mode & 0o777, 0o600);
  assert.equal(readdirSync(dir).length, 2);
});

test('an unparseable JSON config is refused, not overwritten', () => {
  const dir = mkdtempSync(join(tmpdir(), 'baze-w-'));
  const path = join(dir, 'bad.json');
  writeFileSync(path, '{ not json');
  assert.throws(() => readJsonObject(path), /not valid JSON/);
});
