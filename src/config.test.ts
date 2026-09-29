import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, statSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'baze-test-'));
  process.env.BAZE_CONFIG_DIR = dir;
  delete process.env.BAZE_API_KEY;
  delete process.env.BAZE_API_BASE;
});

test('saveCredentials writes 0600 and the value survives', async () => {
  const { saveCredentials, credentialsPath } = await import('./config.js');
  const path = saveCredentials({ api_key: 'abc123', host: 'https://example.test' });
  assert.equal(path, credentialsPath());
  assert.equal(statSync(path).mode & 0o777, 0o600);
  assert.equal(JSON.parse(readFileSync(path, 'utf8')).api_key, 'abc123');
});

test('saveCredentials merges rather than replacing', async () => {
  const { saveCredentials, loadStoredCredentials } = await import('./config.js');
  saveCredentials({ api_key: 'abc123' });
  saveCredentials({ host: 'https://example.test' });
  const stored = loadStoredCredentials();
  assert.equal(stored?.api_key, 'abc123');
  assert.equal(stored?.host, 'https://example.test');
});

test('the environment beats the stored key', async () => {
  const { saveCredentials, resolveCredential } = await import('./config.js');
  saveCredentials({ api_key: 'stored-key' });
  process.env.BAZE_API_KEY = 'env-key';
  const cred = resolveCredential();
  assert.equal(cred.apiKey, 'env-key');
  assert.equal(cred.source, 'env');
});

test('resolveCredential reports none when there is nothing', async () => {
  const { resolveCredential } = await import('./config.js');
  assert.equal(resolveCredential().source, 'none');
});

test('a corrupt credentials file is treated as absent, not as a crash', async () => {
  const { credentialsPath, resolveCredential } = await import('./config.js');
  mkdirSync(dir, { recursive: true });
  writeFileSync(credentialsPath(), '{not json');
  assert.equal(resolveCredential().source, 'none');
});

test('clearCredentials removes the file and reports whether there was one', async () => {
  const { saveCredentials, clearCredentials } = await import('./config.js');
  saveCredentials({ api_key: 'x' });
  assert.equal(clearCredentials(), true);
  assert.equal(clearCredentials(), false);
});

test('a host chosen at login outranks the key tag for that same key', async () => {
  const { saveCredentials, apiBase } = await import('./config.js');
  saveCredentials({ api_key: `baze_${'a'.repeat(32)}40IzHq`, host: 'http://127.0.0.1:8094' });
  assert.equal(apiBase(), 'http://127.0.0.1:8094');
});

test('apiBase prefers the env var, then the stored host', async () => {
  const { saveCredentials, apiBase } = await import('./config.js');
  saveCredentials({ api_key: 'stored-key', host: 'https://stored.test' });
  assert.equal(apiBase(), 'https://stored.test');
  process.env.BAZE_API_BASE = 'https://env.test/';
  assert.equal(apiBase(), 'https://env.test');
});

test('a different key from the env does not inherit the stored key host', async () => {
  // The stored host was detected for the stored key. A key from BAZE_API_KEY
  // may belong to the other deployment, so it gets the default instead.
  const { saveCredentials, apiBase, DEFAULT_API_BASE } = await import('./config.js');
  saveCredentials({ api_key: 'stored-key', host: 'https://stored.test' });
  process.env.BAZE_API_KEY = 'another-key';
  assert.equal(apiBase(), DEFAULT_API_BASE);
  process.env.BAZE_API_KEY = 'stored-key';
  assert.equal(apiBase(), 'https://stored.test');
  // A tagged key names its own deployment, whatever was stored.
  process.env.BAZE_API_KEY = `baze_${'a'.repeat(32)}40IzHq`;
  assert.equal(apiBase(), 'https://api.baze.co');
});
