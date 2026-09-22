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

/** The flag set for a command. An unknown command gets the globals, so `--help` still parses. */
export function knownFor(command: string | undefined): KnownFlags {
  return (command !== undefined && COMMAND_FLAGS[command]) || GLOBAL;
}
