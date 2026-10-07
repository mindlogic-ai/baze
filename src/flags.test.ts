import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseArgs } from './args.js';
import { COMMAND_FLAGS, GLOBAL, LAUNCHER, knownFor } from './flags.js';

// Measured 2026-09-21: every flag here is one the tool itself accepts, so
// consuming it would change what the user asked the tool to do.
const COLLISIONS = {
  claude: ['--file', '--help'],
  codex: ['--help', '--json'],
  opencode: ['--file', '--help'],
  hermes: ['-z', '-m', '--help'],
} as const;

for (const [tool, flags] of Object.entries(COLLISIONS)) {
  test(`${tool}: the tool's own flags pass through untouched`, () => {
    for (const flag of flags) {
      const p = parseArgs([tool, flag, 'x'], knownFor(tool));
      assert.equal(p.flags.size, 0, `${flag} was consumed`);
      assert.deepEqual(p.passthrough, [flag, 'x']);
    }
  });
}

test('a launcher owns --model, --dry-run and --api-base; codex also --reasoning-effort', () => {
  assert.deepEqual(Object.keys(LAUNCHER).sort(), ['api-base', 'dry-run', 'model']);
  assert.deepEqual(Object.keys(COMMAND_FLAGS.codex!).sort(), ['api-base', 'dry-run', 'model', 'reasoning-effort']);
  const p = parseArgs(
    ['codex', '--model', 'gpt-5.6-terra', '--reasoning-effort', 'high', 'exec', '--json', 'hi'],
    knownFor('codex'),
  );
  assert.equal(p.flags.get('model'), 'gpt-5.6-terra');
  assert.equal(p.flags.get('reasoning-effort'), 'high');
  assert.deepEqual(p.positionals, ['exec']);
  assert.deepEqual(p.passthrough, ['--json', 'hi']);
});

test('launchers do not own the global flags: --json, --help and -q belong to the tool', () => {
  for (const tool of ['claude', 'codex', 'opencode', 'hermes']) {
    const known = knownFor(tool);
    for (const g of Object.keys(GLOBAL)) {
      if (g !== 'api-base') assert.equal(known[g], undefined, `${tool} consumes --${g}`);
    }
  }
});

test('every other command accepts every global flag', () => {
  for (const [cmd, known] of Object.entries(COMMAND_FLAGS)) {
    if (cmd === 'claude' || cmd === 'codex' || cmd === 'opencode' || cmd === 'hermes') continue;
    for (const g of Object.keys(GLOBAL)) assert.equal(known[g], GLOBAL[g], `${cmd} lacks --${g}`);
  }
});

test('an unknown command still parses --help', () => {
  const p = parseArgs(['nope', '--help'], knownFor('nope'));
  assert.equal(p.flags.get('help'), true);
});

test('an unknown flag on a non-launcher command is reported, not dropped', async () => {
  const { claimStrayArgs } = await import('./flags.js');
  const parsed = { command: 'embed', positionals: ['x'], passthrough: ['--dimension', '256'] };
  assert.equal(claimStrayArgs(parsed, ['embed', 'x', '--dimension', '256']), '--dimension');
});

test('a launcher keeps its passthrough for the tool', async () => {
  const { claimStrayArgs } = await import('./flags.js');
  const parsed = { command: 'claude', positionals: [], passthrough: ['-p', 'hi'] };
  assert.equal(claimStrayArgs(parsed, ['claude', '-p', 'hi']), undefined);
  assert.deepEqual(parsed.passthrough, ['-p', 'hi']);
});

test('after an explicit -- the rest are arguments, so a prompt may start with a dash', async () => {
  const { claimStrayArgs } = await import('./flags.js');
  const parsed = { command: 'gen', positionals: ['image'], passthrough: ['-5 degrees at dawn'] };
  assert.equal(claimStrayArgs(parsed, ['gen', 'image', '--', '-5 degrees at dawn']), undefined);
  assert.deepEqual(parsed.positionals, ['image', '-5 degrees at dawn']);
  assert.deepEqual(parsed.passthrough, []);
});
