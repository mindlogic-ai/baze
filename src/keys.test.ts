import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HOSTS, hostForKey, inspectKey } from './keys.js';

const AWS_KEY = `baze_${'0'.repeat(32)}2v6s7v`;
const NCP_KEY = `baze_${'a'.repeat(32)}40IzHq`;

test('a key knows its host without showing it, with no request and no flag', () => {
  // Shared vectors with the server's test_api_key_format.py.
  assert.deepEqual(inspectKey(AWS_KEY), { kind: 'tagged', deployment: 'aws' });
  assert.equal(AWS_KEY.includes('aws') || NCP_KEY.includes('ncp'), false);
  assert.equal(hostForKey(AWS_KEY), HOSTS.aws);
  assert.equal(hostForKey(NCP_KEY), HOSTS.ncp);
});

test('a mistyped tagged key fails offline, before it reaches any host', () => {
  const typo = `${NCP_KEY.slice(0, 20)}b${NCP_KEY.slice(21)}`; // no deployment's checksum matches
  assert.throws(() => inspectKey(typo), /mistyped/i);
  assert.equal(hostForKey(typo), undefined);
});

test('an old untagged key is legacy and has no host of its own; on-premise needs --host', () => {
  assert.deepEqual(inspectKey('A'.repeat(32)), { kind: 'legacy' });
  assert.equal(hostForKey('A'.repeat(32)), undefined);
  assert.throws(() => inspectKey('sk-ant-not-ours'), /not a Baze key/i);
});
