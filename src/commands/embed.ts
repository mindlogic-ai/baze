import type { Parsed } from '../args.js';
import { BATCH_REQUEST_TIMEOUT_MS, fetchCatalog, gatewayFetch } from '../api.js';
import { billedLine, type ChargeReply, chargedCredits } from '../charge.js';
import { byType } from '../catalog.js';
import { readTextInputs } from '../input.js';
import { requireApiKey } from './models.js';
import { CliError, info, out, say } from '../ui.js';

/** The server's cap (`embedding_relay.MAX_INPUTS`). Checked here so 2049 items
 * cost a local error instead of a round trip. */
const MAX_INPUTS = 2048;

interface EmbedBody {
  model: string;
  input: string[];
  dimensions?: number;
  task_type?: string;
}

export function buildEmbedBody(
  model: string,
  input: string[],
  flags: Map<string, string | true>,
): EmbedBody {
  if (input.length > MAX_INPUTS) {
    throw new CliError(`Too many inputs (${input.length}). The gateway accepts ${MAX_INPUTS}.`);
  }
  const body: EmbedBody = { model, input };
  const dimensions = flags.get('dimensions');
  if (typeof dimensions === 'string') {
    const n = Number(dimensions);
    if (!Number.isInteger(n) || n < 1) {
      throw new CliError('--dimensions must be a positive integer.');
    }
    body.dimensions = n;
  }
  const taskType = flags.get('task-type');
  if (typeof taskType === 'string') body.task_type = taskType.toUpperCase();
  return body;
}

interface EmbedResponse extends ChargeReply {
  data: { index: number; embedding: number[] }[];
  model: string;
  usage?: { prompt_tokens?: number; total_tokens?: number; image_tokens?: number };
}

async function resolveModel(apiKey: string, asked: string | true | undefined): Promise<string> {
  if (typeof asked === 'string') return asked;
  const rows = byType(await fetchCatalog(apiKey), 'embedding');
  const first = rows[0];
  if (!first) {
    throw new CliError('This key has no embedding model.', {
      hint: 'Run `baze models --type embedding` to check.',
    });
  }
  return first.id;
}

export async function embedCommand(parsed: Parsed): Promise<number> {
  const apiKey = requireApiKey();
  const input = await readTextInputs(parsed, { what: 'text' });
  const model = await resolveModel(apiKey, parsed.flags.get('model'));
  const body = buildEmbedBody(model, input, parsed.flags);

  const res = await gatewayFetch<EmbedResponse>('/embeddings/', {
    apiKey,
    timeoutMs: BATCH_REQUEST_TIMEOUT_MS,
    method: 'POST',
    body,
  });

  if (parsed.flags.get('json')) {
    out(JSON.stringify(res, null, 2));
    return 0;
  }

  const dims = res.data[0]?.embedding.length ?? 0;
  say(`${res.data.length} vector${res.data.length === 1 ? '' : 's'} x ${dims} dims  (${res.model})`);
  for (const row of res.data) {
    const head = row.embedding.slice(0, 4).map((v) => v.toFixed(4)).join(', ');
    out(`[${row.index}] ${head}${row.embedding.length > 4 ? ', …' : ''}`);
  }
  info('');
  info(`${billedLine(`${res.usage?.total_tokens ?? 0} tokens`, chargedCredits(res))}. Full vectors: --json`);
  return 0;
}
