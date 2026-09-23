import type { KnownFlags } from './args.js';

/** Flags every command except a launcher accepts. */
export const GLOBAL: KnownFlags = {
  json: 'boolean',
  'api-base': 'value',
  'no-input': 'boolean',
  q: 'boolean',
  quiet: 'boolean',
  help: 'boolean',
};

/**
 * A launcher must be indistinguishable from the tool it wraps: `baze claude
 * --help` is Claude Code's help, `baze codex exec --json` is Codex's JSON
 * mode, `baze opencode run --file x` is OpenCode's file flag. So a launcher
 * owns three flags and nothing else - not even the globals. `--model` is the
 * one deliberate overlap: baze puts the model into the tool's own config, so
 * consuming it here is how the flag reaches the tool.
 */
export const LAUNCHER: KnownFlags = {
  model: 'value',
  'dry-run': 'boolean',
  'api-base': 'value',
};

// `search` is not here: `--search` arrives with `baze chat` in S3.
export const COMMAND_FLAGS: Readonly<Record<string, KnownFlags>> = {
  login: { ...GLOBAL, host: 'value', 'with-key': 'boolean' },
  logout: { ...GLOBAL, revoke: 'boolean' },
  auth: GLOBAL,
  env: GLOBAL,
  models: { ...GLOBAL, type: 'value' },
  embed: { ...GLOBAL, file: 'value', model: 'value', dimensions: 'value', 'task-type': 'value' },
  rerank: { ...GLOBAL, file: 'value', model: 'value', 'top-n': 'value' },
  guard: { ...GLOBAL, file: 'value', mode: 'value', categories: 'value' },
  mcp: GLOBAL,
  gen: {
    ...GLOBAL,
    model: 'value',
    set: 'list',
    image: 'list',
    n: 'value',
    o: 'value',
    output: 'value',
    'no-wait': 'boolean',
    timeout: 'value',
    params: 'boolean',
    voice: 'value',
    lyrics: 'value',
    seconds: 'value',
    instrumental: 'boolean',
    lang: 'value',
    'no-diarize': 'boolean',
  },
  bot: { ...GLOBAL, continue: 'boolean', save: 'boolean', timeout: 'value' },
  history: { ...GLOBAL, last: 'value', kind: 'value' },
  credits: GLOBAL,
  usage: { ...GLOBAL, from: 'value', to: 'value', by: 'value', scope: 'value' },
  claude: LAUNCHER,
  codex: { ...LAUNCHER, 'reasoning-effort': 'value' },
  opencode: LAUNCHER,
  setup: { ...GLOBAL, model: 'value', 'dry-run': 'boolean' },
  doctor: GLOBAL,
  update: GLOBAL,
  docs: GLOBAL,
};

/** Commands whose unknown flags belong to the tool they launch. Every other command rejects them. */
export const PASSTHROUGH_COMMANDS: ReadonlySet<string> = new Set(['claude', 'codex', 'opencode']);

/**
 * The parser stops at the first flag it does not know and hands the rest on,
 * which is right for a launcher and wrong everywhere else: `baze embed "x"
 * --dimension 256` used to embed at the default size and say nothing. After
 * an explicit `--` the rest are arguments, as in any Unix tool - a prompt may
 * start with a dash. Returns the offending token, or undefined when all is well
 * (and moves `--` arguments into positionals).
 */
export function claimStrayArgs(
  parsed: { command?: string; positionals: string[]; passthrough: string[] },
  argv: readonly string[],
): string | undefined {
  if (!parsed.command || PASSTHROUGH_COMMANDS.has(parsed.command) || parsed.passthrough.length === 0) return undefined;
  const dashdash = argv.indexOf('--');
  if (dashdash !== -1 && argv.length - dashdash - 1 === parsed.passthrough.length) {
    parsed.positionals.push(...parsed.passthrough);
    parsed.passthrough = [];
    return undefined;
  }
  return parsed.passthrough.find((a) => a.startsWith('-')) ?? parsed.passthrough[0];
}

/** The flag set for a command. An unknown command gets the globals, so `--help` still parses. */
export function knownFor(command: string | undefined): KnownFlags {
  return (command !== undefined && COMMAND_FLAGS[command]) || GLOBAL;
}
