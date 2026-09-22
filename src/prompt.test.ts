import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { readSecretFrom } from './prompt.js';

test('reads one line and strips the newline', async () => {
  const input = Readable.from(['sk-test-key\n']) as unknown as NodeJS.ReadStream;
  assert.equal(await readSecretFrom(input), 'sk-test-key');
});

test('trims stray whitespace from a pasted key', async () => {
  const input = Readable.from(['  sk-test-key  \n']) as unknown as NodeJS.ReadStream;
  assert.equal(await readSecretFrom(input), 'sk-test-key');
});

test('rejects an empty line rather than saving nothing', async () => {
  const input = Readable.from(['\n']) as unknown as NodeJS.ReadStream;
  await assert.rejects(() => readSecretFrom(input), /No key/i);
});
