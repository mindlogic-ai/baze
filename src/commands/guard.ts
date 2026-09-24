import type { Parsed } from '../args.js';
import { BATCH_REQUEST_TIMEOUT_MS, gatewayFetch } from '../api.js';
import { readTextInputs } from '../input.js';
import { requireApiKey } from './models.js';
import { c, CliError, info, out, say } from '../ui.js';

/** The server's caps (`services/gateway/guard.py`). */
const MAX_ITEMS = 100;
const MAX_TEXT_CHARS = 20_000;
const MODES = ['mask', 'detect'];

interface GuardBody {
  input: string[];
  categories?: string[];
  mode?: string;
}

export function buildGuardBody(
  input: string[],
  flags: Map<string, string | true>,
): GuardBody {
  if (input.length > MAX_ITEMS) {
    throw new CliError(`Too many inputs (${input.length}). The gateway accepts ${MAX_ITEMS}.`);
  }
  const over = input.findIndex((t) => t.length > MAX_TEXT_CHARS);
  if (over !== -1) {
    throw new CliError(`input[${over}] is longer than ${MAX_TEXT_CHARS} characters.`);
  }
  const body: GuardBody = { input };
  const categories = flags.get('categories');
  if (typeof categories === 'string') {
    // Split and trim only. The accepted set is the server's, and it changes;
    // a copy here would go stale and reject something the gateway serves.
    const named = categories.split(',').map((v) => v.trim()).filter(Boolean);
    if (named.length === 0) throw new CliError('--categories needs at least one category.');
    body.categories = named;
  }
  const mode = flags.get('mode');
  if (typeof mode === 'string') {
    if (!MODES.includes(mode)) throw new CliError("--mode must be 'mask' or 'detect'.");
    body.mode = mode;
  }
  return body;
}

interface GuardResult {
  index: number;
  flagged: boolean;
  categories: string[];
  entities: { category: string; text: string }[];
  masked_text?: string;
}

interface GuardResponse {
  mode: string;
  flagged: boolean;
  results: GuardResult[];
  usage?: { requests?: number };
}

export async function guardCommand(parsed: Parsed): Promise<number> {
  const apiKey = requireApiKey();
  const input = await readTextInputs(parsed, { what: 'text' });

  const res = await gatewayFetch<GuardResponse>('/guard/', {
    apiKey,
    timeoutMs: BATCH_REQUEST_TIMEOUT_MS,
    method: 'POST',
    body: buildGuardBody(input, parsed.flags),
  });

  if (parsed.flags.get('json')) {
    out(JSON.stringify(res, null, 2));
    return 0;
  }

  for (const row of res.results) {
    if (res.mode === 'mask') {
      out(row.masked_text ?? input[row.index] ?? '');
    } else if (row.flagged) {
      const found = row.entities.map((e) => `${e.category}:${e.text}`).join(', ');
      out(`[${row.index}] ${c.dim(found)}`);
    } else {
      out(`[${row.index}] ${c.dim('clean')}`);
    }
  }

  info('');
  const flaggedCount = res.results.filter((r) => r.flagged).length;
  say(`${flaggedCount} of ${res.results.length} flagged. ${res.usage?.requests ?? res.results.length} item(s) billed.`);
  // Screening is per item, not per token, so an unflagged item costs the same.
  return 0;
}
