const useColor = process.stderr.isTTY === true && !process.env.NO_COLOR;
const ESC = String.fromCharCode(27);
const wrap = (code: string) => (s: string) => (useColor ? `${ESC}[${code}m${s}${ESC}[0m` : s);

export const c = {
  bold: wrap('1'),
  dim: wrap('2'),
  red: wrap('31'),
  green: wrap('32'),
  yellow: wrap('33'),
  cyan: wrap('36'),
};

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

export const ok = (s: string): void => say(`${c.green('OK')} ${s}`);
export const warn = (s: string): void => say(`${c.yellow('!!')} ${s}`);
export const fail = (s: string): void => say(`${c.red('XX')} ${s}`);
export const info = (s: string): void => {
  if (!quiet) say(c.dim(s));
};

/** Credits as a person reads them; `--json` keeps the gateway's exact number. */
export function formatCredits(n: number): string {
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
  constructor(
    message: string,
    options: { hint?: string; exitCode?: number; status?: number; requestId?: string } = {},
  ) {
    super(message);
    this.name = 'CliError';
    this.hint = options.hint;
    this.exitCode = options.exitCode ?? 1;
    this.status = options.status;
    this.requestId = options.requestId;
  }
}
