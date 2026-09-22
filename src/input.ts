import { readFileSync } from 'node:fs';
import type { Parsed } from './args.js';
import { CliError } from './ui.js';

/** Reads all of stdin. Used only when stdin is a pipe, never a terminal. */
export async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

const lines = (raw: string): string[] =>
  raw.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);

/**
 * One text per positional, per line of --file, or per line of stdin.
 *
 * Exactly one source, never a merge: a command that quietly concatenated
 * `baze guard "$TEXT" --file list.txt` would screen a different set than the
 * caller named, and the bill is per item.
 */
export async function readTextInputs(
  parsed: Parsed,
  opts: { what: string },
): Promise<string[]> {
  const file = parsed.flags.get('file');
  const hasPositionals = parsed.positionals.length > 0;
  if (file && hasPositionals) {
    throw new CliError(`Give ${opts.what} as arguments or with --file, not both.`);
  }
  if (hasPositionals) return parsed.positionals;
  if (typeof file === 'string') {
    let raw: string;
    try {
      raw = file === '-' ? await readStdin() : readFileSync(file, 'utf8');
    } catch {
      throw new CliError(`Cannot read ${file}.`);
    }
    const values = lines(raw);
    if (values.length === 0) throw new CliError(`${file} has no text in it.`);
    return values;
  }
  if (!process.stdin.isTTY) {
    const values = lines(await readStdin());
    if (values.length > 0) return values;
  }
  throw new CliError(`No ${opts.what} given.`, {
    hint: `Pass it as an argument, with --file <path>, or on stdin.`,
  });
}
