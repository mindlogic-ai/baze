import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseArgs } from '../args.js';
import { knownFor } from '../flags.js';
import { checkKindFlags, genCommand, parseTimeoutS } from './gen.js';

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
