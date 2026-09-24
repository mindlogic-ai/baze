import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { conversationPath, loadConversation } from './bot.js';

test('no saved conversation is an empty thread', () => {
  process.env.BAZE_CONFIG_DIR = mkdtempSync(join(tmpdir(), 'baze-bot-'));
  assert.deepEqual(loadConversation('7'), []);
});

test('a damaged conversation is an error, not a silent fresh start', () => {
  // `--continue` on a truncated file sent a paid turn with none of the thread.
  process.env.BAZE_CONFIG_DIR = mkdtempSync(join(tmpdir(), 'baze-bot-'));
  const path = conversationPath('7');
  mkdirSync(dirname(path), { recursive: true });
  for (const body of ['[{"role":"user","con', '{"not":"a list"}']) {
    writeFileSync(path, body);
    assert.throws(() => loadConversation('7'), /damaged/);
  }
});
