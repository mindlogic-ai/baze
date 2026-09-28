import { homedir } from 'node:os';

const noColor = Boolean(process.env.NO_COLOR);
const ESC = String.fromCharCode(27);
const palette = (on: boolean) => {
  const wrap = (code: string) => (s: string) => (on ? `${ESC}[${code}m${s}${ESC}[0m` : s);
  return { bold: wrap('1'), dim: wrap('2'), red: wrap('31'), green: wrap('32'), yellow: wrap('33'), cyan: wrap('36') };
};

/** Colors for stderr, the human channel. */
export const c = palette(process.stderr.isTTY === true && !noColor);

/**
 * Colors for stdout tables - only on a terminal, so `| jq`, `> file` and
 * --json stay plain. Tables used to be plain even on a terminal because only
 * stderr was checked.
 */
export const cOut = palette(process.stdout.isTTY === true && !noColor);

/** One glyph per state, colored; the text next to it stays plain. */
export const mark = {
  ok: c.green('✔'),
  warn: c.yellow('!'),
  fail: c.red('✘'),
  off: c.dim('·'),
};

/**
 * The width a stdout line is fitted to: the terminal's. Piped output is not
 * cut (a grep must see the whole line) unless COLUMNS asks for a width.
 */
export function termWidth(): number {
  if (process.stdout.isTTY) return process.stdout.columns || 100;
  const asked = Number(process.env.COLUMNS);
  return Number.isFinite(asked) && asked > 0 ? asked : Number.POSITIVE_INFINITY;
}

/** Columns a character takes on a terminal: Hangul, CJK and full-width forms take two. */
function cellWidth(ch: string): number {
  const cp = ch.codePointAt(0) ?? 0;
  return (cp >= 0x1100 && cp <= 0x115f) ||
    (cp >= 0x2e80 && cp <= 0xa4cf) ||
    (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xfe30 && cp <= 0xfe4f) ||
    (cp >= 0xff00 && cp <= 0xff60) ||
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x20000 && cp <= 0x3fffd)
    ? 2
    : 1;
}

/** The columns `s` takes on a terminal. */
export function displayWidth(s: string): number {
  let w = 0;
  for (const ch of s) w += cellWidth(ch);
  return w;
}

/**
 * Cut to `width` terminal columns with an ellipsis. Counted in columns, not
 * characters: a Korean MCP description overflowed a line cut by length.
 */
export function fit(s: string, width: number): string {
  if (width < 1) return '';
  if (displayWidth(s) <= width) return s;
  let out = '';
  let w = 0;
  for (const ch of s) {
    if (w + cellWidth(ch) > width - 1) break;
    out += ch;
    w += cellWidth(ch);
  }
  return `${out}…`;
}

/** A path as a person reads it: ~ for home. */
export function shortPath(p: string, home: string = homedir()): string {
  return home && (p === home || p.startsWith(`${home}/`)) ? `~${p.slice(home.length)}` : p;
}

/** A group heading on stderr, with dim context after it. */
export function section(title: string, meta?: string): void {
  say(`${c.bold(title)}${meta ? `  ${c.dim(meta)}` : ''}`);
}

/** One line under a heading: glyph, label, then dim detail. */
export function item(glyph: string, label: string, detail?: string): void {
  say(`  ${glyph} ${label}${detail ? `  ${c.dim(detail)}` : ''}`);
}

/** stdout: data only, so `| jq` always works. */
export function out(s = ''): void {
  process.stdout.write(`${s}\n`);
}

/** stderr: everything a human reads. */
export function say(s = ''): void {
  process.stderr.write(`${s}\n`);
}

let quiet = false;

/** `-q`: drop hints and progress notes. Results, warnings and errors still print. */
export function setQuiet(q: boolean): void {
  quiet = q;
}

export const ok = (s: string): void => say(`${mark.ok} ${s}`);
export const warn = (s: string): void => say(`${mark.warn} ${s}`);
export const fail = (s: string): void => say(`${mark.fail} ${s}`);
export const info = (s: string): void => {
  if (!quiet) say(c.dim(s));
};

/**
 * Credits as a person reads them; `--json` keeps the gateway's exact number.
 * Two decimals, except a charge under 0.01 keeps four - an embedding call is
 * charged 0.0015 credits exactly, and "0" read as free.
 */
export function formatCredits(n: number): string {
  if (n !== 0 && Math.abs(n) < 0.01) return String(Math.round(n * 10_000) / 10_000);
  return String(Math.round(n * 100) / 100);
}

/** Never print a key in full. First 6 and last 4 only. */
export function maskKey(key: string): string {
  if (key.length <= 12) return '*'.repeat(key.length);
  return `${key.slice(0, 6)}...${key.slice(-4)}`;
}

export class CliError extends Error {
  readonly hint?: string;
  readonly exitCode: number;
  /** HTTP status when the gateway answered; undefined for local and network errors. */
  readonly status?: number;
  /** The gateway's X-Request-ID for the failed call - what support asks for. */
  readonly requestId?: string;
  /** Seconds from a 429's Retry-After header, when the gateway sent one. */
  readonly retryAfterS?: number;
  constructor(
    message: string,
    options: { hint?: string; exitCode?: number; status?: number; requestId?: string; retryAfterS?: number } = {},
  ) {
    super(message);
    this.name = 'CliError';
    this.hint = options.hint;
    this.exitCode = options.exitCode ?? 1;
    this.status = options.status;
    this.requestId = options.requestId;
    this.retryAfterS = options.retryAfterS;
  }
}
