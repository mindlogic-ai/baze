import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs } from './args.js';

const KNOWN = { model: 'value', 'dry-run': 'boolean', json: 'boolean' } as const;

test('reads the command and a value flag', () => {
  const p = parseArgs(['models', '--model', 'claude-sonnet-5'], KNOWN);
  assert.equal(p.command, 'models');
  assert.equal(p.flags.get('model'), 'claude-sonnet-5');
});

test('reads --flag=value form', () => {
  const p = parseArgs(['models', '--model=gpt-5.5'], KNOWN);
  assert.equal(p.flags.get('model'), 'gpt-5.5');
});

test('boolean flags take no value', () => {
  const p = parseArgs(['claude', '--dry-run'], KNOWN);
  assert.equal(p.flags.get('dry-run'), true);
  assert.deepEqual(p.passthrough, []);
});

test('an unknown flag begins the passthrough and keeps its order', () => {
  const p = parseArgs(['claude', '--model', 'claude-opus-5', '-p', 'fix the test', '--verbose'], KNOWN);
  assert.equal(p.flags.get('model'), 'claude-opus-5');
  assert.deepEqual(p.passthrough, ['-p', 'fix the test', '--verbose']);
});

test('a known flag after the passthrough starts is NOT consumed', () => {
  const p = parseArgs(['claude', '-p', 'hi', '--dry-run'], KNOWN);
  assert.equal(p.flags.has('dry-run'), false);
  assert.deepEqual(p.passthrough, ['-p', 'hi', '--dry-run']);
});

test('a bare -- forces everything after it into passthrough', () => {
  const p = parseArgs(['claude', '--', '--model', 'x'], KNOWN);
  assert.deepEqual(p.passthrough, ['--model', 'x']);
});

test('positionals collect after the command', () => {
  const p = parseArgs(['models', 'claude'], KNOWN);
  assert.deepEqual(p.positionals, ['claude']);
});
