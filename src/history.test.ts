import assert from 'node:assert/strict';
import { mkdtempSync, statSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, test } from 'node:test';
import { findHistory, historyPath, readHistory, recordHistory } from './history.js';

beforeEach(() => {
  process.env.BAZE_CONFIG_DIR = mkdtempSync(join(tmpdir(), 'baze-history-'));
});

const base = { kind: 'video' as const, model: 'm', host: 'h' };

test('the last line for an id is its state, and earlier fields survive', () => {
  recordHistory({ ...base, id: 'a1', at: '2026-09-23T00:00:00Z', status: 'submitted', prompt: 'p' });
  recordHistory({ ...base, id: 'a1', at: '2026-09-23T00:00:01Z', status: 'processing', operationId: 'gw.x.op' });
  recordHistory({ ...base, id: 'a1', at: '2026-09-23T00:00:09Z', status: 'completed', files: ['/f.mp4'] });
  const [entry] = readHistory();
  assert.equal(entry!.status, 'completed');
  assert.equal(entry!.prompt, 'p');
  assert.equal(entry!.operationId, 'gw.x.op');
  assert.deepEqual(entry!.files, ['/f.mp4']);
});

test('newest first, by last update, and a garbled line is skipped', () => {
  recordHistory({ ...base, id: 'old', at: '1', status: 'submitted' });
  recordHistory({ ...base, id: 'new', at: '2', status: 'submitted' });
  appendFileSync(historyPath(), '{not json\n');
  recordHistory({ ...base, id: 'old', at: '3', status: 'completed' });
  assert.deepEqual(readHistory().map((e) => e.id), ['old', 'new']);
});

test('a job is found by its history id or by its operation id', () => {
  recordHistory({ ...base, id: 'b2', at: '1', status: 'processing', operationId: 'gw.s.job' });
  assert.equal(findHistory('b2')?.id, 'b2');
  assert.equal(findHistory('gw.s.job')?.id, 'b2');
  assert.equal(findHistory('nope'), undefined);
});

test('the file is owner-only and a long prompt is cut', () => {
  recordHistory({ ...base, id: 'c3', at: '1', status: 'submitted', prompt: 'x'.repeat(2000) });
  assert.equal(statSync(historyPath()).mode & 0o777, 0o600);
  assert.equal(readHistory()[0]!.prompt!.length, 500);
});
