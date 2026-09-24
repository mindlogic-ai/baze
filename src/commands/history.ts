import { relative } from 'node:path';
import type { Parsed } from '../args.js';
import { historyPath, readHistory } from '../history.js';
import { c, CliError, info, out, say } from '../ui.js';

const STATUS_COLOR = { completed: c.green, failed: c.red, processing: c.yellow, submitted: c.yellow } as const;

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
  for (const e of rows) {
    const status = (STATUS_COLOR[e.status] ?? ((s: string) => s))(e.status.padEnd(10));
    const at = new Date(e.at);
    const when = `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')} ${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
    // Paths relative to here when they are under it; --json keeps them absolute.
    const shown = (p: string) => (relative(process.cwd(), p).startsWith('..') ? p : relative(process.cwd(), p));
    const what = e.files?.length ? e.files.map(shown).join(', ') : (e.error ?? e.prompt ?? '').replace(/\s+/g, ' ').slice(0, 60);
    out(`${e.id}  ${when}  ${e.kind.padEnd(10)} ${status} ${e.model}  ${what}`);
  }
  info('');
  info(`Resume an unfinished job with \`baze gen wait <id>\`. Full records: --json  (${historyPath()})`);
  return 0;
}
