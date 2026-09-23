import { test } from 'node:test';
import assert from 'node:assert/strict';
import { catalogCachePath, fetchCatalogDetail, gatewayFetch, laneFor } from './api.js';

test('the lane comes from the endpoints the gateway publishes', () => {
  // /models has no `lane` field; `endpoints` names the native path per model.
  assert.equal(laneFor(['/v1/gateway/chat/completions/', '/v1/gateway/claude/v1/messages/']), 'anthropic');
  assert.equal(
    laneFor(['/v1/gateway/chat/completions/', '/v1/gateway/gemini/v1beta/models/gemini-3.6-flash:generateContent']),
    'gemini',
  );
  assert.equal(laneFor(['/v1/gateway/chat/completions/', '/v1/gateway/responses/']), 'responses');
  assert.equal(laneFor(['/v1/gateway/chat/completions/']), 'compat');
  // An older gateway sends no endpoints at all: the compat lane answers for
  // every relayable model, so that is the safe default.
  assert.equal(laneFor(undefined), 'compat');
});

test('an object `detail` is read, not stringified', async () => {
  // factchat/v1/errors.py sends {"detail": {"code": 4001, "message": "..."}};
  // reading it as a string printed "[object Object]" for every gateway error.
  const fake = (async () =>
    new Response(JSON.stringify({ detail: { code: 4001, message: 'This key has no access to gpt-5.6-terra.' } }), {
      status: 403,
    })) as unknown as typeof fetch;
  await assert.rejects(
    gatewayFetch('/v1/gateway/models/', { apiKey: 'k', base: 'https://a.test', fetchImpl: fake }),
    (e: Error) => e.message.includes('This key has no access to gpt-5.6-terra.'),
  );
});

test('the catalog cache is separate per key and per host', () => {
  process.env.BAZE_CONFIG_DIR = '/tmp/baze-cache-test';
  const a = catalogCachePath('https://a.test', 'key-1');
  assert.notEqual(a, catalogCachePath('https://a.test', 'key-2'));
  assert.notEqual(a, catalogCachePath('https://b.test', 'key-1'));
  assert.equal(a.includes('key-1'), false); // the key itself never lands in a filename
});

test('sends a bearer token and returns parsed JSON', async () => {
  let seen: Headers | undefined;
  const fake = (async (_u: string | URL, init?: RequestInit) => {
    seen = new Headers(init?.headers);
    return new Response('{"object":"ok"}', { status: 200 });
  }) as unknown as typeof fetch;
  const body = await gatewayFetch<{ object: string }>('/credits/', {
    apiKey: 'secret',
    base: 'https://a.test',
    fetchImpl: fake,
  });
  assert.equal(body.object, 'ok');
  assert.equal(seen?.get('authorization'), 'Bearer secret');
});

test('401 becomes an error that names the fix, not a status code', async () => {
  const fake = (async () =>
    new Response('{"error":{"message":"authentication_error - Invalid API key"}}', { status: 401 })) as unknown as typeof fetch;
  await assert.rejects(
    () => gatewayFetch('/credits/', { apiKey: 'bad', base: 'https://a.test', fetchImpl: fake }),
    /Invalid API key/,
  );
});

test('402 explains that the balance ran out and exits 2', async () => {
  const fake = (async () => new Response('{"error":{"message":"insufficient credit"}}', { status: 402 })) as unknown as typeof fetch;
  await assert.rejects(
    () => gatewayFetch('/chat/completions', { apiKey: 'k', base: 'https://a.test', fetchImpl: fake }),
    (e: Error & { exitCode?: number }) => /credit/i.test(e.message) && e.exitCode === 2,
  );
});

test('the server contract version rides along with the catalog, and an older server has none', async () => {
  process.env.BAZE_CONFIG_DIR = '/tmp/baze-cache-test';
  const newer = (async () =>
    new Response(
      JSON.stringify({ object: 'list', cli_contract: 7, data: [{ id: 'm', type: 'llm', endpoints: ['/v1/gateway/claude/'] }] }),
      { status: 200 },
    )) as unknown as typeof fetch;
  const detail = await fetchCatalogDetail('k', { base: 'https://contract.test', force: true, fetchImpl: newer });
  assert.equal(detail.contract, 7);
  assert.equal(detail.rows[0]?.lane, 'anthropic');
  const older = (async () => new Response(JSON.stringify({ object: 'list', data: [] }), { status: 200 })) as unknown as typeof fetch;
  const old = await fetchCatalogDetail('k', { base: 'https://older.test', force: true, fetchImpl: older });
  assert.equal(old.contract, undefined);
});

test('a gateway error carries the request id the gateway sent', async () => {
  const fake = (async () =>
    new Response(JSON.stringify({ detail: { code: 404, message: 'nope' } }), {
      status: 404,
      headers: { 'x-request-id': 'req-123' },
    })) as unknown as typeof fetch;
  await assert.rejects(
    gatewayFetch('/models/x/', { apiKey: 'k', base: 'https://a.test', fetchImpl: fake }),
    (e: Error & { requestId?: string }) => e.requestId === 'req-123',
  );
});

test('a /v1/ path the gateway handed out goes to the same host, not under /v1/gateway', async () => {
  const { gatewayFetchBytes } = await import('./api.js');
  let url = '';
  const fake = (async (u: string) => {
    url = u;
    return new Response(Buffer.from([1, 2]), { status: 200, headers: { 'content-type': 'video/mp4', 'x-request-id': 'r9' } });
  }) as unknown as typeof fetch;
  const got = await gatewayFetchBytes('/v1/gateway/video/generation/gw.a.b/download/?model=m', {
    apiKey: 'k',
    base: 'https://a.test/',
    fetchImpl: fake,
  });
  assert.equal(url, 'https://a.test/v1/gateway/video/generation/gw.a.b/download/?model=m');
  assert.deepEqual([...got.bytes], [1, 2]);
  assert.equal(got.requestId, 'r9');
});

test('a provider download never carries the API key', async () => {
  const { downloadPublic } = await import('./api.js');
  let init: RequestInit | undefined;
  const fake = (async (_u: string, i?: RequestInit) => {
    init = i;
    return new Response('x', { status: 200, headers: { 'content-type': 'image/png' } });
  }) as unknown as typeof fetch;
  await downloadPublic('https://cdn.provider.test/out.png', fake);
  assert.equal(init?.headers, undefined);
});
