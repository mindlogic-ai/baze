import type { Parsed } from '../args.js';
import { BATCH_REQUEST_TIMEOUT_MS, fetchCatalog, gatewayFetch } from '../api.js';
import { billedLine, type ChargeReply, chargedCredits } from '../charge.js';
import { byType } from '../catalog.js';
import { readTextInputs } from '../input.js';
import { requireApiKey } from './models.js';
import { CliError, info, out, say } from '../ui.js';

/** The server's caps (`rerank_relay`). Checked here so an oversized batch
 * costs a local error instead of a round trip. */
const MAX_DOCUMENTS = 500;
const MAX_DOCUMENT_CHARS = 32_000;
const MAX_QUERY_CHARS = 8_000;

interface RerankBody {
  model: string;
  query: string;
  documents: string[];
  top_n?: number;
}

export function buildRerankBody(
  model: string,
  query: string,
  documents: string[],
  flags: Map<string, string | true>,
): RerankBody {
  if (!query.trim()) throw new CliError('The query must not be empty.');
  if (query.length > MAX_QUERY_CHARS) {
    throw new CliError(`The query is longer than ${MAX_QUERY_CHARS} characters.`);
  }
  if (documents.length > MAX_DOCUMENTS) {
    throw new CliError(`Too many documents (${documents.length}). The gateway accepts ${MAX_DOCUMENTS}.`);
  }
  const over = documents.findIndex((d) => d.length > MAX_DOCUMENT_CHARS);
  if (over !== -1) {
    throw new CliError(`Document ${over} is longer than ${MAX_DOCUMENT_CHARS} characters.`);
  }
  const body: RerankBody = { model, query, documents };
  const topN = flags.get('top-n');
  if (typeof topN === 'string') {
    const n = Number(topN);
    if (!Number.isInteger(n) || n < 1) throw new CliError('--top-n must be a positive integer.');
    body.top_n = n;
  }
  return body;
}

async function resolveModel(apiKey: string, asked: string | true | undefined): Promise<string> {
  if (typeof asked === 'string') return asked;
  const first = byType(await fetchCatalog(apiKey), 'rerank')[0];
  if (!first) {
    throw new CliError('This key has no rerank model.', {
      hint: 'Run `baze models --type rerank` to check.',
    });
  }
  return first.id;
}

interface RerankResponse extends ChargeReply {
  model: string;
  results: { index: number; relevance_score: number | null }[];
  usage?: { total_tokens?: number };
}

export async function rerankCommand(parsed: Parsed): Promise<number> {
  const apiKey = requireApiKey();
  // The query is the first positional; the rest, or --file, are the documents.
  const [query, ...rest] = parsed.positionals;
  if (query === undefined) {
    throw new CliError('No query given.', { hint: 'baze rerank "<query>" <doc> <doc>…' });
  }
  const documents = await readTextInputs(
    { ...parsed, positionals: rest },
    { what: 'documents' },
  );

  const model = await resolveModel(apiKey, parsed.flags.get('model'));

  const res = await gatewayFetch<RerankResponse>('/rerank/', {
    apiKey,
    timeoutMs: BATCH_REQUEST_TIMEOUT_MS,
    method: 'POST',
    body: buildRerankBody(model, query, documents, parsed.flags),
  });

  if (parsed.flags.get('json')) {
    out(JSON.stringify(res, null, 2));
    return 0;
  }

  say(`${res.results.length} of ${documents.length} documents, best first  (${res.model})`);
  for (const row of res.results) {
    const text = documents[row.index] ?? '';
    const head = text.length > 72 ? `${text.slice(0, 71)}…` : text;
    out(`${(row.relevance_score ?? 0).toFixed(4)}  [${row.index}] ${head}`);
  }
  info('');
  info(`${billedLine(`${res.usage?.total_tokens ?? 0} tokens`, chargedCredits(res))}.`);
  return 0;
}
