import type { Parsed } from '../args.js';
import { fetchCatalog } from '../api.js';
import { byType } from '../catalog.js';
import { resolveCredential } from '../config.js';
import type { ModelType } from '../types.js';
import { c, CliError, info, out, say } from '../ui.js';

const LANE_LABEL = {
  anthropic: 'Claude native',
  responses: 'Responses',
  gemini: 'Gemini native',
  compat: 'OpenAI-compat',
} as const;

/** Every type `/v1/gateway/models/` can send, in the order it sends them. */
export const KNOWN_TYPES: readonly ModelType[] = [
  'llm',
  'audio',
  'image',
  'video',
  'embedding',
  'rerank',
  'realtime',
];

export function requireApiKey(): string {
  const cred = resolveCredential();
  if (!cred.apiKey) {
    throw new CliError('No API key.', { hint: 'Run `baze login`, or set BAZE_API_KEY.' });
  }
  return cred.apiKey;
}

export async function modelsCommand(parsed: Parsed): Promise<number> {
  const apiKey = requireApiKey();
  const asked = parsed.flags.get('type');
  const type = typeof asked === 'string' ? asked : 'llm';
  // "No such type" and "no models of that type" are different answers, and a
  // typo must not read as an empty catalog.
  if (!KNOWN_TYPES.includes(type as ModelType)) {
    throw new CliError(`Unknown --type ${type}.`, { hint: `Try one of: ${KNOWN_TYPES.join(', ')}.` });
  }
  const query = parsed.positionals[0]?.toLowerCase();
  const rows = byType(await fetchCatalog(apiKey), type as ModelType).filter(
    (r) => !query || r.id.toLowerCase().includes(query),
  );

  if (parsed.flags.get('json')) {
    out(JSON.stringify(rows, null, 2));
    return 0;
  }

  if (rows.length === 0) {
    say(query ? `No ${type} model matches "${query}".` : `This key has no ${type} models.`);
    return 0;
  }

  const width = Math.max(...rows.map((r) => r.id.length));
  say(c.dim(`${'model'.padEnd(width)}  lane            context     $/1M in   $/1M out`));
  for (const r of rows) {
    const ctx = r.contextLimit ? `${Math.round(r.contextLimit / 1000)}k` : '-';
    const pin = r.pricing?.inputPer1mUsd?.toFixed(2) ?? '-';
    const pout = r.pricing?.outputPer1mUsd?.toFixed(2) ?? '-';
    out(`${r.id.padEnd(width)}  ${LANE_LABEL[r.lane].padEnd(14)}  ${ctx.padStart(8)}  ${pin.padStart(8)}  ${pout.padStart(8)}`);
  }
  info('');
  info('Prices are provider list USD per 1M tokens.');
  if (type === 'llm') {
    info('Claude Code runs Claude-native models only; Codex runs Responses models; OpenCode runs all four lanes.');
  } else if (type === 'realtime') {
    // Live voice is a WebSocket session with a microphone on the other end;
    // baze has no command for it (a native audio module would break the
    // zero-dependency rule), so the row is listed and nothing more.
    info('Realtime models are WebSocket voice sessions; no baze command runs them.');
  } else {
    // An embedding or rerank row has no output lane, so that column is `-` by
    // design, not for want of a price.
    info(`No harness runs ${type} models; use \`baze ${type === 'rerank' ? 'rerank' : 'embed'}\`.`);
  }
  return 0;
}
