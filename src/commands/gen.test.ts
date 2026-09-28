import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseArgs } from '../args.js';
import { knownFor } from '../flags.js';
import { chargedCredits } from '../charge.js';
import { checkKindFlags, estimateHeadline, genCommand, parseTimeoutS, pollTiming } from './gen.js';

const parse = (...argv: string[]) => parseArgs(['gen', ...argv], knownFor('gen'));

test('a bad --timeout is refused before anything is sent', async () => {
  // It was read only once a job was submitted, so `--timeout 0` paid for a
  // video and then failed.
  process.env.BAZE_API_KEY = 'k';
  process.env.BAZE_API_BASE = 'https://gen.test';
  const real = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    return new Response('{}', { status: 200 });
  }) as typeof fetch;
  try {
    for (const argv of [
      ['video', 'a cat', '--model', 'v', '--timeout', '0'],
      ['image', 'a cat', '--model', 'i', '--timeout', 'soon'],
    ]) {
      await assert.rejects(genCommand(parse(...argv)), /--timeout is in seconds/);
    }
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = real;
  }
});

test('--timeout takes positive seconds only', () => {
  assert.equal(parseTimeoutS(undefined), 900);
  assert.equal(parseTimeoutS('30'), 30);
  for (const bad of ['0', '-5', '--json', true] as const) assert.throws(() => parseTimeoutS(bad));
});

test('an option the kind would ignore is refused', () => {
  // `baze gen speech --image ref.png` used to make a paid call without the image.
  assert.throws(() => checkKindFlags('speech', parse('speech', 'hi', '--image', 'ref.png')), /--image does not apply to baze gen speech/);
  assert.throws(() => checkKindFlags('image', parse('image', 'x', '--no-wait')), /--no-wait does not apply/);
  assert.throws(() => checkKindFlags('wait', parse('wait', 'id', '--set', 'a=b')), /--set does not apply/);
});

test("each kind's own options and the shared ones pass", () => {
  checkKindFlags('image', parse('image', 'x', '--model', 'm', '--set', 'q=low', '--image', 'a.png', '--n', '2', '-o', 'o.png', '--timeout', '60'));
  checkKindFlags('video', parse('video', 'x', '--model', 'm', '--set', 'duration=5', '--no-wait', '--json'));
  checkKindFlags('speech', parse('speech', 'x', '--voice', 'Kore', '--output', 's.wav'));
  checkKindFlags('music', parse('music', 'x', '--model', 'm', '--lyrics', 'la', '--seconds', '30', '--instrumental'));
  checkKindFlags('transcribe', parse('transcribe', 'f.wav', '--lang', 'ko', '--no-diarize', '--params'));
  checkKindFlags('wait', parse('wait', 'id', '--timeout', '60', '-o', 'v.mp4'));
});

function stubGateway(reply: (url: string, init?: RequestInit) => Response) {
  const calls: { url: string; body?: unknown }[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : undefined });
    return reply(String(url), init);
  }) as typeof fetch;
  return { calls, restore: () => (globalThis.fetch = real) };
}

test('--estimate asks the server for a price and generates nothing', async () => {
  process.env.BAZE_API_KEY = 'k';
  process.env.BAZE_API_BASE = 'https://gen.test';
  process.env.BAZE_CONFIG_DIR = (await import('node:fs')).mkdtempSync('/tmp/baze-est-');
  const gw = stubGateway((url) =>
    url.includes('/estimate/')
      ? new Response(JSON.stringify({ object: 'estimate', kind: 'video', model: 'v', credits: 43.59, exact: true, bound: 'exact', lines: [{ item: 'video', credits: 43.59, exact: true, bound: 'exact', basis: 'price_schema' }] }))
      : new Response(JSON.stringify({ parameters: [{ name: 'duration', values: [5, 10] }] })),
  );
  try {
    const code = await genCommand(parse('video', 'a red ball', '--model', 'v', '--set', 'duration=10', '--estimate', '--json'));
    assert.equal(code, 0);
    const posts = gw.calls.filter((c) => c.body !== undefined);
    assert.equal(posts.length, 1, 'only the estimate was posted');
    assert.match(posts[0]!.url, /\/v1\/gateway\/estimate\/$/);
    assert.deepEqual(posts[0]!.body, { kind: 'video', model: 'v', parameters: { duration: 10 } });
    const { readHistory } = await import('../history.js');
    assert.equal(readHistory().length, 0, 'a quote is not a job');
  } finally {
    gw.restore();
  }
});

test("the headline says which way the charge can move, as the server says", () => {
  const quote = (bound: 'exact' | 'minimum' | 'maximum' | 'approximate') =>
    estimateHeadline({ model: 'm', credits: 8, exact: bound === 'exact', bound });
  assert.equal(quote('exact'), 'm: 8 credits');
  assert.equal(quote('minimum'), 'm: at least 8 credits');
  assert.equal(quote('maximum'), 'm: at most 8 credits');
  // Own credit at another rate: it can land either side, so not "at least".
  assert.equal(quote('approximate'), 'm: about 8 credits');
});

test('a server without estimates says so instead of "no such model"', async () => {
  process.env.BAZE_API_KEY = 'k';
  process.env.BAZE_API_BASE = 'https://old.test';
  const gw = stubGateway((url) =>
    url.includes('/estimate/')
      ? new Response(JSON.stringify({ detail: 'Not Found' }), { status: 404 })
      : new Response(JSON.stringify({})),
  );
  try {
    await assert.rejects(genCommand(parse('music', '--model', 'lyria', '--estimate')), /cannot quote prices yet/);
  } finally {
    gw.restore();
  }
});

test('--estimate is refused for kinds that are not quoted', () => {
  assert.throws(() => checkKindFlags('speech', parse('speech', 'hi', '--estimate')), /--estimate does not apply/);
  assert.throws(() => checkKindFlags('transcribe', parse('transcribe', 'a.wav', '--estimate')), /--estimate does not apply/);
});

test('the charge is read from credits_charged, else the KRW billing block', () => {
  assert.equal(chargedCredits({ credits_charged: 40 }), 40);
  assert.equal(chargedCredits({ billing: { deducted_credit: 29.198 } }), 29.198);
  assert.equal(chargedCredits({ credits_charged: 5, billing: { deducted_credit: 9 } }), 5);
  assert.equal(chargedCredits({}), null);
  assert.equal(chargedCredits(undefined), null);
});

async function freshHome(host: string) {
  process.env.BAZE_API_KEY = 'k';
  process.env.BAZE_API_BASE = host;
  process.env.BAZE_CONFIG_DIR = (await import('node:fs')).mkdtempSync('/tmp/baze-charge-');
  process.chdir(process.env.BAZE_CONFIG_DIR);
  return (await import('../history.js')).readHistory;
}

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

test('an image records what it was charged', async () => {
  const readHistory = await freshHome('https://img.test');
  const gw = stubGateway((url) =>
    url.includes('/images/generate/')
      ? new Response(JSON.stringify({ data: [{ url: PNG }], credits_charged: 40 }))
      : new Response(JSON.stringify({ parameters: [] })),
  );
  try {
    assert.equal(await genCommand(parse('image', 'a dot', '--model', 'flux', '--json')), 0);
    const [entry] = readHistory();
    assert.equal(entry!.status, 'completed');
    assert.equal(entry!.credits, 40);
  } finally {
    gw.restore();
  }
});

test('a video that failed keeps no charge in history; the server refunds it', async () => {
  const readHistory = await freshHome('https://vid.test');
  const gw = stubGateway((url, init) =>
    url.includes('/video/generation/') && init?.method === 'POST'
      ? new Response(JSON.stringify({ operation_id: 'op1', status: 'processing', credits_charged: 43.59 }))
      : url.includes('/video/generation/op1/')
        ? new Response(JSON.stringify({ operation_id: 'op1', status: 'failed', error: 'refused' }))
        : new Response(JSON.stringify({ parameters: [] })),
  );
  try {
    await assert.rejects(genCommand(parse('video', 'a cat', '--model', 'v')), /The video failed: refused/);
    const [entry] = readHistory();
    assert.equal(entry!.status, 'failed');
    assert.equal(entry!.credits, null);
  } finally {
    gw.restore();
  }
});

test('a video left running records its charge at submit', async () => {
  const readHistory = await freshHome('https://vid2.test');
  const gw = stubGateway((url) =>
    url.includes('/video/generation/')
      ? new Response(JSON.stringify({ operation_id: 'op2', status: 'processing', billing: { deducted_credit: 31.8185 } }))
      : new Response(JSON.stringify({ parameters: [] })),
  );
  try {
    assert.equal(await genCommand(parse('video', 'a cat', '--model', 'v', '--no-wait', '--json')), 0);
    const [entry] = readHistory();
    assert.equal(entry!.status, 'processing');
    assert.equal(entry!.credits, 31.8185);
  } finally {
    gw.restore();
  }
});

test('a rate-limited poll waits as told and the video still completes', async () => {
  // Parallel waits hit the 120/min limit; the first 429 marked a paid video
  // "failed" (dev QA, 2026-09-28).
  const readHistory = await freshHome('https://vid429.test');
  Object.assign(pollTiming, { pollMs: 1, retryMs: 1 });
  let polls = 0;
  const gw = stubGateway((url, init) => {
    if (url.includes('/video/generation/') && init?.method === 'POST') {
      return new Response(JSON.stringify({ operation_id: 'op3', status: 'processing', credits_charged: 33.75 }));
    }
    if (url.includes('/video/generation/op3/')) {
      polls++;
      return polls === 1
        ? new Response(JSON.stringify({ detail: { message: 'Rate limit' } }), { status: 429, headers: { 'retry-after': '0' } })
        : new Response(JSON.stringify({ operation_id: 'op3', status: 'completed', video_uri: 'data:video/mp4;base64,AAAA' }));
    }
    return new Response(JSON.stringify({ parameters: [] }));
  });
  try {
    assert.equal(await genCommand(parse('video', 'a cat', '--model', 'v', '--json')), 0);
    assert.equal(polls, 2);
    const [entry] = readHistory();
    assert.equal(entry!.status, 'completed');
    assert.equal(entry!.credits, 33.75);
  } finally {
    gw.restore();
    Object.assign(pollTiming, { pollMs: 5_000, retryMs: 5_000 });
  }
});

test('a poll that cannot be read leaves the paid job resumable, not failed', async () => {
  const readHistory = await freshHome('https://vid401.test');
  const gw = stubGateway((url, init) =>
    url.includes('/video/generation/') && init?.method === 'POST'
      ? new Response(JSON.stringify({ operation_id: 'op4', status: 'processing', credits_charged: 20 }))
      : url.includes('/video/generation/op4/')
        ? new Response(JSON.stringify({ detail: { message: 'This API key was revoked.' } }), { status: 401 })
        : new Response(JSON.stringify({ parameters: [] })),
  );
  try {
    await assert.rejects(genCommand(parse('video', 'a cat', '--model', 'v')), (error: Error & { hint?: string }) => {
      assert.match(error.message, /revoked/);
      assert.match(error.hint ?? '', /baze gen wait/);
      return true;
    });
    const [entry] = readHistory();
    assert.equal(entry!.status, 'processing');
    assert.equal(entry!.operationId, 'op4');
    assert.equal(entry!.credits, 20);
  } finally {
    gw.restore();
  }
});

test('an async image interrupted mid-poll keeps its operation id for gen wait', async () => {
  const readHistory = await freshHome('https://img401.test');
  const gw = stubGateway((url, init) =>
    url.includes('/images/generate/') && init?.method === 'POST'
      ? new Response(JSON.stringify({ operation_id: 'gw.img', status: 'processing', credits_charged: 8 }))
      : url.includes('/images/generate/gw.img/')
        ? new Response('{}', { status: 403 })
        : new Response(JSON.stringify({ parameters: [] })),
  );
  try {
    await assert.rejects(genCommand(parse('image', 'a cat', '--model', 'i')), /not allowed/);
    const [entry] = readHistory();
    assert.equal(entry!.status, 'processing');
    assert.equal(entry!.operationId, 'gw.img');
  } finally {
    gw.restore();
  }
});

test('--seconds on a Lyria model is refused before anything is paid for', async () => {
  const readHistory = await freshHome('https://lyria.test');
  const gw = stubGateway((url) =>
    url.includes('/models/')
      ? new Response(JSON.stringify({ data: [{ id: 'lyria-3-pro-preview', type: 'audio', audio_client: 'google_lyria3' }] }))
      : new Response('{}', { status: 400 }),
  );
  try {
    await assert.rejects(genCommand(parse('music', 'a song', '--model', 'lyria-3-pro-preview', '--seconds', '30')), /picks its own length/);
    assert.equal(gw.calls.some((c) => c.url.includes('/audio/music/')), false);
    assert.deepEqual(readHistory(), []);
  } finally {
    gw.restore();
  }
});
