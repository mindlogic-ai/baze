import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseRpcResponse, readArguments } from './mcp.js';

const parsed = (positionals: string[]) => ({
  command: 'mcp',
  flags: new Map<string, string | true>(),
  positionals,
  passthrough: [],
});

test('an SSE reply yields the last JSON-RPC response, skipping comments and notifications', () => {
  const body = [
    ': keep-alive',
    'event: message',
    'data: {"jsonrpc":"2.0","method":"notifications/progress","params":{}}',
    '',
    'data: {"jsonrpc":"2.0","id":2,"result":{"tools":[{"name":"search_company"}]}}',
    '',
  ].join('\n');
  const r = parseRpcResponse('text/event-stream; charset=utf-8', body);
  assert.deepEqual(r.result, { tools: [{ name: 'search_company' }] });
});

test('a plain JSON reply is accepted as well', () => {
  const r = parseRpcResponse('application/json', '{"jsonrpc":"2.0","id":1,"result":{"ok":true}}');
  assert.deepEqual(r.result, { ok: true });
});

test('a JSON-RPC error object is returned, not thrown here - the caller names the suite', () => {
  const r = parseRpcResponse(
    'application/json',
    '{"jsonrpc":"2.0","id":1,"error":{"code":-32601,"message":"Unknown tool"}}',
  );
  assert.equal(r.error?.code, -32601);
});

test('a stream with no response at all is an error, not an empty result', () => {
  assert.throws(
    () => parseRpcResponse('text/event-stream', 'data: {"jsonrpc":"2.0","method":"notifications/x"}\n'),
    /without a JSON-RPC response/i,
  );
});

test('tool arguments come from the fourth positional as a JSON object', async () => {
  assert.deepEqual(await readArguments(parsed(['call', 'dart', 'search_company', '{"query":"삼성전자"}'])), {
    query: '삼성전자',
  });
});

test('a list or a scalar is refused before any request is made', async () => {
  await assert.rejects(() => readArguments(parsed(['call', 'dart', 't', '[1]'])), /object/);
  await assert.rejects(() => readArguments(parsed(['call', 'dart', 't', 'oops'])), /JSON object/);
});
