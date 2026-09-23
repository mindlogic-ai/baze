import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { decodeDataUrl, extensionFor, imageInput, outputPaths, pcmToWav } from './media.js';

test('a local image becomes a data URL; URLs pass through untouched', () => {
  const dir = mkdtempSync(join(tmpdir(), 'baze-media-'));
  const file = join(dir, 'a.PNG');
  writeFileSync(file, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  assert.equal(imageInput(file), 'data:image/png;base64,iVBORw==');
  assert.equal(imageInput('https://x.test/a.png'), 'https://x.test/a.png');
  assert.equal(imageInput('data:image/png;base64,AA=='), 'data:image/png;base64,AA==');
  assert.throws(() => imageInput(join(dir, 'missing.png')), /No such file/);
  writeFileSync(join(dir, 'a.txt'), 'x');
  assert.throws(() => imageInput(join(dir, 'a.txt')), /not an image/);
});

test('the extension follows the content type, then the URL, then the default', () => {
  assert.equal(extensionFor('image/jpeg', 'https://x.test/a.png', 'png'), 'jpg');
  assert.equal(extensionFor('application/octet-stream', 'https://cdn.test/v/out.mp4?sig=1', 'bin'), 'mp4');
  assert.equal(extensionFor('', 'data:image/png;base64,AA', 'png'), 'png');
  assert.equal(extensionFor('', undefined, 'wav'), 'wav');
});

test('-o names one file; several get an index before the extension', () => {
  assert.deepEqual(outputPaths('image', 1, 'png', '/tmp/out.png'), ['/tmp/out.png']);
  assert.deepEqual(outputPaths('image', 2, 'png', '/tmp/out.png'), ['/tmp/out-1.png', '/tmp/out-2.png']);
  assert.deepEqual(outputPaths('image', 2, 'png', '/tmp/out'), ['/tmp/out-1.png', '/tmp/out-2.png']);
});

test('without -o the name carries the kind and local time and cannot repeat', () => {
  const at = new Date(2026, 8, 23, 17, 26, 14);
  const [a] = outputPaths('video', 1, 'mp4', undefined, at);
  const [b] = outputPaths('video', 1, 'mp4', undefined, at);
  assert.match(a!, /baze-video-20260923-172614-[0-9a-f]{4}\.mp4$/);
  assert.notEqual(a, b);
});

test('a data URL decodes to its bytes and type', () => {
  const { bytes, contentType } = decodeDataUrl('data:image/webp;base64,AQID');
  assert.deepEqual([...bytes], [1, 2, 3]);
  assert.equal(contentType, 'image/webp');
  assert.throws(() => decodeDataUrl('data:image/png,raw'), /unreadable/);
});

test('raw PCM gets a 44-byte RIFF header for 24 kHz 16-bit mono', () => {
  const wav = pcmToWav(Buffer.alloc(480));
  assert.equal(wav.length, 44 + 480);
  assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
  assert.equal(wav.readUInt32LE(4), 36 + 480);
  assert.equal(wav.toString('ascii', 8, 12), 'WAVE');
  assert.equal(wav.readUInt16LE(22), 1);
  assert.equal(wav.readUInt32LE(24), 24000);
  assert.equal(wav.readUInt32LE(28), 48000);
  assert.equal(wav.readUInt16LE(34), 16);
  assert.equal(wav.readUInt32LE(40), 480);
});
