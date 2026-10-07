import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildHermesPlan, dotenvOverrides, hermesKeyEnvName } from './hermes.js';
import { pickDefault } from '../catalog.js';
import { HOSTS } from '../hosts.js';
import type { ModelRow } from '../types.js';

const ROWS: ModelRow[] = [
  { id: 'claude-sonnet-5', type: 'llm', lane: 'anthropic', contextLimit: 200000, pricing: null },
  { id: 'gpt-6-sol', type: 'llm', lane: 'responses', contextLimit: 1050000, pricing: null },
  { id: 'gemini-3.5-flash', type: 'llm', lane: 'gemini', contextLimit: 1000000, pricing: null },
  { id: 'grok-4.7', type: 'llm', lane: 'compat', contextLimit: 500000, pricing: null },
  { id: 'gpt-audio-1.5', type: 'llm', lane: 'compat', contextLimit: null, pricing: null, audioTokens: true },
  { id: 'dall-e', type: 'image', lane: 'compat', contextLimit: null, pricing: null },
];
const OPTS = { apiKey: 'k', apiBase: HOSTS.aws, model: 'gpt-6-sol', rows: ROWS, passthrough: [], dotenvText: '' };

test('derives the env var name Hermes reads for each Baze host', () => {
  // Measured against Hermes v0.21.1 `_host_derived_api_key`.
  assert.equal(hermesKeyEnvName(`${HOSTS.aws}/v1/gateway`), 'MINDLOGIC_API_KEY');
  assert.equal(hermesKeyEnvName(`${HOSTS.ncp}/v1/gateway`), 'BAZE_API_KEY');
  assert.equal(hermesKeyEnvName('https://dev-factchat.mindlogic.ai:8443/v1/gateway'), 'MINDLOGIC_API_KEY');
});

test('no name where Hermes derives none', () => {
  for (const url of ['http://10.0.0.5/v1', 'http://localhost:8000/v1', 'http://[::1]/v1', 'http://intranet/v1', 'https://api.openai.com/v1', 'not a url']) {
    assert.equal(hermesKeyEnvName(url), undefined, url);
  }
});

test('points Hermes at the gateway with the key under the derived name, not in argv', () => {
  const plan = buildHermesPlan(OPTS);
  assert.equal(plan.bin, 'hermes');
  assert.deepEqual(plan.env, { CUSTOM_BASE_URL: `${HOSTS.aws}/v1/gateway`, MINDLOGIC_API_KEY: 'k' });
  assert.deepEqual(plan.args, ['--provider', 'custom', '-m', 'gpt-6-sol']);
  assert.equal(plan.tempFiles, undefined);
});

test('uses the host baze resolved for the key, never a fixed one', () => {
  const plan = buildHermesPlan({ ...OPTS, apiBase: HOSTS.ncp });
  assert.deepEqual(plan.env, { CUSTOM_BASE_URL: `${HOSTS.ncp}/v1/gateway`, BAZE_API_KEY: 'k' });
});

test('every other argument goes to hermes, after the provider and model', () => {
  const plan = buildHermesPlan({ ...OPTS, passthrough: ['-z', 'hi', '--yolo'] });
  assert.deepEqual(plan.args, ['--provider', 'custom', '-m', 'gpt-6-sol', '-z', 'hi', '--yolo']);
});

test("the user's own -m or --provider is left alone", () => {
  assert.deepEqual(buildHermesPlan({ ...OPTS, passthrough: ['-m', 'grok-4.7'] }).args, ['--provider', 'custom', '-m', 'grok-4.7']);
  assert.deepEqual(buildHermesPlan({ ...OPTS, passthrough: ['--provider=custom'] }).args, ['-m', 'gpt-6-sol', '--provider=custom']);
});

test('every lane is launchable; unknown, audio and media models are refused', () => {
  for (const model of ['claude-sonnet-5', 'gpt-6-sol', 'gemini-3.5-flash', 'grok-4.7']) {
    assert.doesNotThrow(() => buildHermesPlan({ ...OPTS, model }), model);
  }
  assert.throws(() => buildHermesPlan({ ...OPTS, model: 'nope' }), /not available to this key/);
  assert.throws(() => buildHermesPlan({ ...OPTS, model: 'gpt-audio-1.5' }), /only with audio/);
  assert.throws(() => buildHermesPlan({ ...OPTS, model: 'dall-e' }), /not available to this key/);
});

test('offline, an unlisted model is not refused', () => {
  assert.doesNotThrow(() => buildHermesPlan({ ...OPTS, model: 'glm-5.3', catalogLive: false }));
});

test('a host Hermes will not send a key to is an error, not a 401 later', () => {
  assert.throws(() => buildHermesPlan({ ...OPTS, apiBase: 'http://10.0.0.5:8000' }), /will not send an API key/);
});

test('warns when ~/.hermes/.env would override the launch', () => {
  assert.deepEqual(dotenvOverrides('# x\nexport CUSTOM_BASE_URL=x\nOPENAI_API_KEY=y\n', ['CUSTOM_BASE_URL', 'MINDLOGIC_API_KEY']), ['CUSTOM_BASE_URL']);
  const plan = buildHermesPlan({ ...OPTS, dotenvText: 'MINDLOGIC_API_KEY=old\n' });
  assert.ok(plan.notes.some((n) => n.includes('MINDLOGIC_API_KEY')));
  assert.equal(buildHermesPlan(OPTS).notes.length, 2);
});

test('the default model is not Claude, which loses prompt caching on Chat Completions', () => {
  assert.equal(pickDefault('hermes', [...ROWS, { id: 'gpt-5.6-terra', type: 'llm', lane: 'responses', contextLimit: null, pricing: null }]), 'gpt-5.6-terra');
});
