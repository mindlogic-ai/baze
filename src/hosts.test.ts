import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HOSTS, gatewayBase, detectHost, hostOrder } from './hosts.js';
import { CliError } from './ui.js';

test('gatewayBase appends the gateway prefix and trims slashes', () => {
  assert.equal(gatewayBase('https://a.test/'), 'https://a.test/v1/gateway');
});

test('the last-used host is tried first', () => {
  assert.deepEqual(hostOrder(HOSTS.ncp), [HOSTS.ncp, HOSTS.aws]);
  assert.deepEqual(hostOrder(undefined), [HOSTS.aws, HOSTS.ncp]);
});

test('detectHost stops at the first host whose probe succeeds and returns its value', async () => {
  const tried: string[] = [];
  const found = await detectHost([HOSTS.ncp, HOSTS.aws], async (host) => {
    tried.push(host);
    return ['row'];
  });
  assert.equal(found.host, HOSTS.ncp);
  assert.deepEqual(found.value, ['row']);
  assert.deepEqual(tried, [HOSTS.ncp]); // the key never went to the other host
});

const refused = (status: number) => new CliError('refused', { status });

test('detectHost throws a written error when every host refuses the key', async () => {
  await assert.rejects(
    () => detectHost([HOSTS.aws, HOSTS.ncp], async () => {
      throw refused(401);
    }),
    /not accepted/i,
  );
});

test("a stopped tenant's 503 (the gateway's own body) moves on: the key's live copy is on the other host", async () => {
  const tried: string[] = [];
  const found = await detectHost([HOSTS.aws, HOSTS.ncp], async (host) => {
    tried.push(host);
    if (host === HOSTS.aws) throw new CliError('stopped', { status: 503, gatewayCode: 503 });
    return ['row'];
  });
  assert.equal(found.host, HOSTS.ncp);
  assert.deepEqual(tried, [HOSTS.aws, HOSTS.ncp]);
});

test('a 5xx stops the probe: the key was delivered, and the next host must not get it too', async () => {
  const tried: string[] = [];
  await assert.rejects(
    () => detectHost([HOSTS.aws, HOSTS.ncp], async (host) => {
      tried.push(host);
      throw refused(503);
    }),
    (e: Error) => /could not check/i.test(e.message) && !/not accepted/i.test(e.message),
  );
  assert.deepEqual(tried, [HOSTS.aws]);
});
