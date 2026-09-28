import { relative } from 'node:path';
import type { Parsed } from '../args.js';
import { historyPath, readHistory } from '../history.js';
import { CliError, cOut, fit, formatCredits, info, out, say, shortPath, termWidth } from '../ui.js';

const STATUS_GLYPH: Record<string, string> = { completed: '✔', failed: '✘', processing: '◷', submitted: '◷' };
const STATUS_MARK: Record<string, (s: string) => string> = {
  completed: cOut.green,
  failed: cOut.red,
  processing: cOut.yellow,
  submitted: cOut.yellow,
};

/** Relative to here when under it, else ~-shortened; --json keeps paths absolute. */
function shown(p: string): string {
  const rel = relative(process.cwd(), p);
  return rel.startsWith('..') ? shortPath(p) : rel;
}

/** Cut a path from the left so the file name stays visible. */
function fitPath(s: string, width: number): string {
  if (s.length <= width || width < 8) return fit(s, Math.max(width, 0));
  return s.includes('/') ? `…${s.slice(s.length - width + 1)}` : fit(s, width);
}

export async function historyCommand(parsed: Parsed): Promise<number> {
  const rawLast = parsed.flags.get('last');
  const last = typeof rawLast === 'string' ? Number(rawLast) : 20;
  if (!Number.isInteger(last) || last < 1) throw new CliError('--last must be a positive integer.');
  const kind = parsed.flags.get('kind');
  const rows = readHistory()
    .filter((e) => typeof kind !== 'string' || e.kind === kind)
    .slice(0, last);

  if (parsed.flags.get('json')) {
    // snake_case like every other --json document; the file keeps its own names.
    const wire = rows.map((e) => ({
      id: e.id,
      at: e.at,
      kind: e.kind,
      model: e.model,
      status: e.status,
      host: e.host,
      ...(e.prompt !== undefined ? { prompt: e.prompt } : {}),
      ...(e.operationId !== undefined ? { operation_id: e.operationId } : {}),
      ...(e.files !== undefined ? { files: e.files } : {}),
      ...(e.credits !== undefined ? { credits: e.credits } : {}),
      ...(e.requestId !== undefined ? { request_id: e.requestId } : {}),
      ...(e.error !== undefined ? { error: e.error } : {}),
    }));
    out(JSON.stringify(wire, null, 2));
    return 0;
  }
  if (rows.length === 0) {
    say('Nothing yet. `baze gen` and `baze bot ask` record every call here.');
    return 0;
  }
  // One fixed shape per line, fitted to the terminal: the model column is
  // padded, credits sit right-aligned, and paths are shortened - a full temp
  // path pushed every line past 150 characters (feedback, 2026-09-28).
  const modelWidth = Math.min(28, Math.max(...rows.map((e) => e.model.length)));
  const credits = rows.map((e) => (typeof e.credits === 'number' ? `${formatCredits(e.credits)} cr` : '-'));
  const creditWidth = Math.max(...credits.map((s) => s.length));
  rows.forEach((e, i) => {
    const glyph = (STATUS_MARK[e.status] ?? cOut.dim)(STATUS_GLYPH[e.status] ?? '?');
    const at = new Date(e.at);
    const when = `${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')} ${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
    const head = `${glyph} ${e.id}  ${when}  ${e.kind.padEnd(10)} ${fit(e.model, modelWidth).padEnd(modelWidth)}  ${credits[i]!.padStart(creditWidth)}  `;
    const what = e.files?.length
      ? e.files.map(shown).join(', ')
      : e.status === 'processing' || e.status === 'submitted'
        ? `${e.status} · baze gen wait ${e.id}`
        : (e.error ?? e.prompt ?? '').replace(/\s+/g, ' ');
    // The glyph is one character on screen however long its color codes are.
    const room = termWidth() - (head.length - glyph.length + 1);
    out(`${head}${cOut.dim(fitPath(what, room))}`);
  });
  info('');
  info(`Resume an unfinished job with \`baze gen wait <id>\`. Full records: --json  (${historyPath()})`);
  return 0;
}
