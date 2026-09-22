import { test } from 'node:test';
import assert from 'node:assert/strict';
import { upsertCodexConfig } from './codex.js';

const O = { model: 'gpt-5.6-terra', apiBase: 'https://a.test' };

test('writes the provider table and the top-level selection into an empty file', () => {
  const out = upsertCodexConfig('', O);
  assert.match(out, /^model_provider = "baze"$/m);
  assert.match(out, /^\[model_providers\.baze\]$/m);
  assert.match(out, /wire_api = "responses"/);
});

test('a sub-table of the old provider goes with it', () => {
  // [model_providers.baze.http_headers] survived a header-only match and
  // re-attached itself to the fresh table with stale values.
  const existing = '[model_providers.baze]\nbase_url = "https://old.test"\n\n[model_providers.baze.http_headers]\nX-Old = "1"\n';
  const out = upsertCodexConfig(existing, O);
  assert.equal(out.includes('X-Old'), false);
  assert.equal(out.includes('old.test'), false);
});

test('a top-level dotted key for our own table is dropped, not duplicated', () => {
  // TOML rejects a key defined twice, so leaving this behind made codex refuse
  // to start rather than use the gateway.
  const existing = 'model_providers.baze.base_url = "https://old.test"\n\n[mcp_servers.mine]\ncommand = "node"\n';
  const out = upsertCodexConfig(existing, O);
  assert.equal(out.includes('model_providers.baze.base_url ='), false);
  assert.match(out, /\[mcp_servers\.mine\]/);
});

test('leaves an unrelated table byte-for-byte', () => {
  const existing = 'model = "o3"\n\n[mcp_servers.mine]\ncommand = "node"\nargs = ["x.js"]\n';
  const out = upsertCodexConfig(existing, O);
  assert.match(out, /\[mcp_servers\.mine\]\ncommand = "node"\nargs = \["x\.js"\]/);
});

test('replaces a previous baze provider table rather than appending a second', () => {
  const existing = '[model_providers.baze]\nname = "old"\nbase_url = "https://old.test"\n';
  const out = upsertCodexConfig(existing, O);
  assert.equal(out.match(/\[model_providers\.baze\]/g)?.length, 1);
  assert.equal(out.includes('https://old.test'), false);
});

test('replaces a stale top-level model line instead of leaving two', () => {
  const out = upsertCodexConfig('model = "o3"\nmodel_provider = "other"\n', O);
  assert.equal(out.match(/^model = /gm)?.length, 1);
  assert.match(out, /model = "gpt-5\.6-terra"/);
});
