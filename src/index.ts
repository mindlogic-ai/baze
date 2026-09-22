#!/usr/bin/env node
import { parseArgs, type Parsed } from './args.js';
import { knownFor } from './flags.js';
import { CliError, fail, say, setQuiet } from './ui.js';

export const VERSION = '__VERSION__';

const MIN_NODE = [20, 10] as const;

function checkNode(): void {
  const [major = 0, minor = 0] = process.versions.node.split('.').map(Number);
  if (major > MIN_NODE[0] || (major === MIN_NODE[0] && minor >= MIN_NODE[1])) return;
  // Nothing has been written to stdout yet, so exiting here is safe.
  fail(`baze needs Node ${MIN_NODE[0]}.${MIN_NODE[1]} or newer; this is ${process.versions.node}.`);
  say('Install a current Node (https://nodejs.org) and run `baze doctor` again.');
  process.exit(1);
}

const HELP = `baze - run your coding agent through the FactChat gateway. (v${VERSION})

  baze login                 store and validate an API key (AWS and NCP alike)
  baze auth                  which key and host are in effect
  baze models [query]        models this key can call
  baze embed [text...]       embedding vectors for text
  baze rerank <query> [doc...]
                             order documents by relevance to a query
  baze guard [text...]       find or mask personal data in text
  baze mcp [list|tools|call] the FactChat MCP suites (DART, KRX, ...) through the gateway
  baze credits               remaining credit balance
  baze usage                 spend, by model, key or day
  baze claude | codex | opencode
                             run that tool through the gateway; every flag but
                             --model/--dry-run goes to the tool, nothing is written
  baze setup <tool>          write the configuration permanently, with a backup
  baze doctor                check key, host, Node, tool versions, config conflicts
  baze env                   eval "$(baze env)" to export BAZE_API_KEY
  baze update | docs         upgrade baze; print the agent manual

Global flags
  --json                     machine-readable stdout
  --api-base <url>           same as BAZE_API_BASE, for this call
  --no-input                 never prompt; fail instead
  -q, --quiet                drop hints and progress notes
  baze help <command>        help for one command (a launcher's --help is the tool's own)

Environment
  BAZE_API_KEY               beats the stored key (CI, containers)
  BAZE_API_BASE              beats the stored host
  BAZE_CONFIG_DIR            config directory (default ~/.baze)
`;

/** One screen per command. Launchers forward everything after `--` to the tool. */
const USAGE: Record<string, string> = {
  login: `baze login [--with-key] [--host <url>]
  Paste a key (echo off) or pipe one with --with-key. The key says which
  FactChat it belongs to, so AWS and NCP users run the same command; it is
  checked before it is saved to ~/.baze/credentials.json (0600). --host is only
  for an on-premise server.`,
  logout: `baze logout [--revoke]
  Delete the stored key. --revoke also disables the key on the server first -
  use it for a key that may have leaked.`,
  auth: 'baze auth\n  Show the masked key, where it came from, and the host in effect.',
  env: 'baze env\n  Print `export BAZE_API_KEY=...` for eval "$(baze env)".',
  models: `baze models [query] [--type llm|audio|image|video|embedding|rerank|realtime] [--json]
  Models this key can call, with lane, context and list price. --type defaults
  to llm; embedding, rerank and realtime rows have no output price, so that column is -.`,
  embed: `baze embed [text...] [--file <path>] [--model ID] [--dimensions N] [--task-type T] [--json]
  Embedding vectors. Text comes from arguments, one per line of --file, or stdin.
  Without --model, the first embedding model this key can call. --task-type is
  gemini-embedding-2 only. At most 2048 inputs per call; billed per token.`,
  rerank: `baze rerank <query> [doc...] [--file <path>] [--model ID] [--top-n N] [--json]
  Order documents by relevance. The first argument is the query; the rest, one
  per line of --file, or stdin, are the documents. At most 500 documents of
  32,000 characters; billed per token.`,
  guard: `baze guard [text...] [--file <path>] [--mode mask|detect] [--categories a,b] [--json]
  Find personal data in text, and by default return it masked. Text comes from
  arguments, one per line of --file, or stdin. At most 100 items of 20,000
  characters, billed per item. Text only - image screening is not served here.
  Without --categories, every category the masking server accepts.`,
  mcp: `baze mcp [list] | baze mcp tools <suite> | baze mcp call <suite> <tool> ['{json}'] [--json]
  The FactChat first-party MCP suites (DART, KRX, Naver, ...). Listing and
  tools are free; each call is billed as one tool call. Arguments are one JSON
  object, from the argument or stdin. The suites are not injected into the
  launchers; configure a harness with the URL this prints if you want one there.`,
  credits: 'baze credits [--json]\n  Monthly, purchased and org-granted balances, and the renewal date.',
  usage: `baze usage [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--by model|key|day] [--scope key|member] [--json]
  Gateway spend. --scope key (default) is the key in use; member is every key you own,
  and --by key implies it. Dates are Korea time; the default window is this month; at most 92 days.`,
  claude: `baze claude [--model ID] [--dry-run] [<claude args>]
  Run Claude Code through the gateway. Claude models only. Nothing is written to
  disk. Every other argument, --help included, goes to claude unchanged.`,
  codex: `baze codex [--model ID] [--reasoning-effort low|medium|high|max] [--dry-run] [<codex args>]
  Run Codex through the gateway on the Responses API. GPT models only. Every
  other argument, --help and --json included, goes to codex unchanged.`,
  opencode: `baze opencode [--model ID] [--dry-run] [<opencode args>]
  Run OpenCode with four FactChat providers - the only harness that reaches every
  model. Every other argument, --help included, goes to opencode unchanged.`,
  setup: `baze setup <claude|codex|opencode> [--model ID] [--dry-run]
  Write the configuration permanently. The old file is backed up first.`,
  doctor: 'baze doctor\n  Check Node, key, host, installed tools and conflicting config. Exits 1 if anything needs fixing.',
  update: 'baze update\n  npm install -g @mindlogic-ai/baze@latest',
  docs: 'baze docs\n  Print AGENT_MANUAL.md.',
};

async function dispatch(parsed: Parsed): Promise<number> {
  switch (parsed.command) {
    case 'login':
      return (await import('./commands/login.js')).loginCommand(parsed);
    case 'logout':
      return (await import('./commands/login.js')).logoutCommand(parsed);
    case 'auth':
      return (await import('./commands/login.js')).authCommand();
    case 'env':
      return (await import('./commands/login.js')).envCommand();
    case 'models':
      return (await import('./commands/models.js')).modelsCommand(parsed);
    case 'credits':
      return (await import('./commands/credits.js')).creditsCommand(parsed);
    case 'usage':
      return (await import('./commands/usage.js')).usageCommand(parsed);
    case 'claude':
    case 'codex':
    case 'opencode':
      return (await import('./commands/run.js')).runCommand(parsed.command, parsed);
    case 'doctor':
      return (await import('./commands/doctor.js')).doctorCommand(parsed);
    case 'setup':
      return (await import('./commands/setup.js')).setupCommand(parsed);
    case 'update':
      return (await import('./commands/misc.js')).updateCommand();
    case 'docs':
      return (await import('./commands/misc.js')).docsCommand();
    case '__update-check':
      return (await import('./commands/misc.js')).refreshUpdateMeta();
    case 'embed':
      return (await import('./commands/embed.js')).embedCommand(parsed);
    case 'rerank':
      return (await import('./commands/rerank.js')).rerankCommand(parsed);
    default:
      throw new CliError(`Unknown command: ${parsed.command}`, { hint: 'Run `baze --help` for the list.' });
  }
}

async function main(argv: string[]): Promise<number> {
  checkNode();
  const first = argv[0];

  if (first === undefined || first === '--help' || first === '-h') {
    say(HELP);
    return 0;
  }
  if (first === 'help') {
    // `baze help claude` is the only way to baze's own text for a launcher:
    // `baze claude --help` is Claude Code's help, by design.
    const usage = argv[1] !== undefined ? USAGE[argv[1]] : undefined;
    say(usage ?? HELP);
    return 0;
  }
  if (first === '--version' || first === '-v') {
    say(VERSION);
    return 0;
  }

  const parsed = parseArgs(argv, knownFor(first));

  if (parsed.flags.get('help') === true) {
    const usage = parsed.command ? USAGE[parsed.command] : undefined;
    say(usage ?? HELP);
    return 0;
  }
  if (parsed.flags.get('q') === true || parsed.flags.get('quiet') === true) setQuiet(true);
  const apiBaseFlag = parsed.flags.get('api-base');
  if (typeof apiBaseFlag === 'string') process.env.BAZE_API_BASE = apiBaseFlag;

  const code = await dispatch(parsed);
  // After the command, never before, and only for a person at a terminal.
  // `env` output is eval'd, and the hidden check must not recurse.
  const quietCommand = parsed.command === 'env' || parsed.command === '__update-check';
  if (!quietCommand && process.stderr.isTTY) {
    const misc = await import('./commands/misc.js');
    misc.printCachedNudge(VERSION);
    misc.refreshInBackground();
  }
  return code;
}

// A reader that stops early (`baze models --json | head`) closes the pipe;
// that is the reader's choice, not our error.
process.stdout.on('error', (error: NodeJS.ErrnoException) => {
  if (error.code === 'EPIPE') process.exit(0);
  // Throwing from an 'error' listener is itself uncaught; report and stop.
  process.stderr.write(`baze: cannot write output (${error.code ?? error.message})\n`);
  process.exit(1);
});

// process.exitCode, never process.exit(): exit() drops stdout writes still
// queued for a pipe, which would break `baze models --json | jq`.
main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    if (error instanceof CliError) {
      fail(error.message);
      if (error.hint) say(error.hint);
      process.exitCode = error.exitCode;
      return;
    }
    fail(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
