export type FlagKind = 'boolean' | 'value';
export type KnownFlags = Readonly<Record<string, FlagKind>>;

export interface Parsed {
  command?: string;
  flags: Map<string, string | true>;
  positionals: string[];
  passthrough: string[];
}

/**
 * Consumes only the flags we declare. The first unknown flag ends our parsing
 * and everything from there — including flags whose names we do know — belongs
 * to the child tool. That rule is what lets `baze claude -p "..." --verbose`
 * forward faithfully without us knowing Claude Code's whole flag set.
 */
export function parseArgs(argv: string[], known: KnownFlags): Parsed {
  const flags = new Map<string, string | true>();
  const positionals: string[] = [];
  let command: string | undefined;
  let i = 0;

  for (; i < argv.length; i++) {
    const arg = argv[i]!;

    if (arg === '--') {
      i++;
      break;
    }

    if (arg.startsWith('-')) {
      const eq = arg.indexOf('=');
      const name = (eq === -1 ? arg : arg.slice(0, eq)).replace(/^--?/, '');
      const kind = known[name];
      if (!kind) break;

      if (kind === 'boolean') {
        if (eq !== -1) throw new Error(`--${name} takes no value`);
        flags.set(name, true);
        continue;
      }

      if (eq !== -1) {
        flags.set(name, arg.slice(eq + 1));
        continue;
      }
      const value = argv[i + 1];
      if (value === undefined) throw new Error(`--${name} needs a value`);
      flags.set(name, value);
      i++;
      continue;
    }

    if (command === undefined) command = arg;
    else positionals.push(arg);
  }

  return { command, flags, positionals, passthrough: argv.slice(i) };
}

export function hasFlag(args: readonly string[], flag: string): boolean {
  return args.some((a) => a === flag || a.startsWith(`${flag}=`));
}
