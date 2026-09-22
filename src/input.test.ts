import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readTextInputs } from './input.js';
import { writeFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const parsed = (positionals: string[], flags: Record<string, string> = {}) => ({
  command: 'embed',
  flags: new Map<string, string | true>(Object.entries(flags)),
  positionals,
  passthrough: [],
});

test('positional arguments are the inputs, in order', async () => {
  assert.deepEqual(await readTextInputs(parsed(['a', 'b']), { what: 'text' }), ['a', 'b']);
});

test('--file is one input per line, blank lines dropped', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'baze-input-'));
  const file = join(dir, 'docs.txt');
  writeFileSync(file, 'first\n\nsecond\n');
  assert.deepEqual(await readTextInputs(parsed([], { file }), { what: 'text' }), ['first', 'second']);
});

test('a file that is all blank lines is an error, not an empty request', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'baze-input-'));
  const file = join(dir, 'empty.txt');
  writeFileSync(file, '\n\n\n');
  await assert.rejects(() => readTextInputs(parsed([], { file }), { what: 'text' }), /no text/i);
});

test('positionals win over --file rather than being silently merged', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'baze-input-'));
  const file = join(dir, 'docs.txt');
  writeFileSync(file, 'fromfile\n');
  await assert.rejects(
    () => readTextInputs(parsed(['arg'], { file }), { what: 'text' }),
    /both/i,
  );
});
