import { test } from 'node:test';
import assert from 'node:assert/strict';
import { catalogCachePath, contentFilterWarning, fetchCatalogDetail, gatewayFetch, laneFor } from './api.js';

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

test('the organization content filter rides along with the catalog, and an older server has none', async () => {
  process.env.BAZE_CONFIG_DIR = '/tmp/baze-cache-test';
  const filtering = (async () =>
    new Response(
      JSON.stringify({
        object: 'list',
        cli_contract: 1,
        content_filter: { enabled: true, blocks_personal_info: true, masks_personal_info: false, restricted_words: true },
        data: [{ id: 'm', type: 'llm', endpoints: ['/v1/gateway/claude/'] }],
      }),
      { status: 200 },
    )) as unknown as typeof fetch;
  const detail = await fetchCatalogDetail('k', { base: 'https://filter.test', force: true, fetchImpl: filtering });
  assert.deepEqual(detail.contentFilter, {
    enabled: true,
    blocksPersonalInfo: true,
    masksPersonalInfo: false,
    restrictedWords: true,
  });
  const older = (async () => new Response(JSON.stringify({ object: 'list', data: [] }), { status: 200 })) as unknown as typeof fetch;
  const old = await fetchCatalogDetail('k', { base: 'https://nofilter.test', force: true, fetchImpl: older });
  assert.equal(old.contentFilter, undefined);
});

test('the content-filter warning names what is refused, and is silent when the filter is off or unknown', () => {
  assert.equal(contentFilterWarning(undefined), undefined);
  assert.equal(
    contentFilterWarning({ enabled: false, blocksPersonalInfo: true, masksPersonalInfo: true, restrictedWords: true }),
    undefined,
  );
  const block = contentFilterWarning({ enabled: true, blocksPersonalInfo: true, masksPersonalInfo: false, restrictedWords: false });
  assert.match(String(block), /refuses API requests that contain personal data/);
  assert.match(String(block), /Request blocked by content policy/);
  const words = contentFilterWarning({ enabled: true, blocksPersonalInfo: false, masksPersonalInfo: false, restrictedWords: true });
  assert.match(String(words), /restricted words/);
  assert.doesNotMatch(String(words), /personal data/);
  const mask = contentFilterWarning({ enabled: true, blocksPersonalInfo: false, masksPersonalInfo: true, restrictedWords: false });
  assert.match(String(mask), /masks personal data/);
});
