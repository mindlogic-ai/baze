import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkCount, checkParams, describeParams, type ParamSpec, parseSets } from './params.js';

// The shape `GET /models/bytedance/seedance-1-pro/` and `/models/gpt-image-1/` publish.
const VIDEO: ParamSpec[] = [
  { name: 'duration', type: 'duration', required: true, default: 2, values: [2, 5, 10] },
  { name: 'resolution', type: 'enum', required: false, default: '480p', values: ['480p', '720p'] },
];
const IMAGE: ParamSpec[] = [
  { name: 'n', type: 'num_images', required: true, default: 1, max: 4 },
  { name: 'quality', type: 'enum', values: ['low', 'high'] },
];

test('--set pairs split on the first =', () => {
  assert.deepEqual([...parseSets(['a=1', 'prompt=x=y'])], [['a', '1'], ['prompt', 'x=y']]);
  assert.throws(() => parseSets(['novalue']), /key=value/);
  assert.throws(() => parseSets(['=1']), /key=value/);
});

test('an allowed value is sent with the type the schema declares', () => {
  const out = checkParams(new Map([['duration', '5'], ['resolution', '720p']]), VIDEO, 'm');
  assert.deepEqual(out, { duration: 5, resolution: '720p' });
  assert.equal(typeof out.duration, 'number');
});

test('a value outside the list is refused before anything is sent, naming the allowed ones', () => {
  assert.throws(
    () => checkParams(new Map([['duration', '99']]), VIDEO, 'seedance'),
    (e: Error & { hint?: string }) => /duration=99/.test(e.message) && /2, 5, 10/.test(e.hint ?? ''),
  );
});

test('an unknown parameter is refused, listing what the model takes', () => {
  assert.throws(
    () => checkParams(new Map([['fps', '24']]), VIDEO, 'seedance'),
    (e: Error & { hint?: string }) => /no parameter "fps"/.test(e.message) && /resolution/.test(e.hint ?? ''),
  );
});

test('the image count is --n, never a --set of the model count field', () => {
  assert.throws(() => checkParams(new Map([['n', '2']]), IMAGE, 'gpt-image-1'), /--n/);
});

test('with no published schema the values pass through, numbers as numbers', () => {
  assert.deepEqual(checkParams(new Map([['duration', '5'], ['style', 'anime']]), undefined, 'm'), {
    duration: 5,
    style: 'anime',
  });
});

test('--n is checked against the model limit, and one-image models refuse more', () => {
  assert.equal(checkCount(undefined, IMAGE), 1);
  assert.equal(checkCount('3', IMAGE), 3);
  assert.throws(() => checkCount('5', IMAGE), /at most 4/);
  assert.throws(() => checkCount('0', IMAGE), /positive integer/);
  assert.throws(() => checkCount('2', VIDEO), /one image per call/);
  assert.equal(checkCount('2', undefined), 2); // no schema: the gateway decides
});

test('--params prints the flag a person types for each parameter', () => {
  const lines = describeParams(IMAGE);
  assert.match(lines[0]!, /^--n\s+<= 4\s+\(default 1\)$/);
  assert.match(lines[1]!, /^--set quality=\s+low \| high$/);
});
