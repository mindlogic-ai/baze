import type { Parsed } from '../args.js';
import { fetchCatalog } from '../api.js';
import { chatModels } from '../catalog.js';
import { resolveCredential } from '../config.js';
import { c, CliError, info, out, say } from '../ui.js';

const LANE_LABEL = {
  anthropic: 'Claude native',
  responses: 'Responses',
  gemini: 'Gemini native',
  compat: 'OpenAI-compat',
} as const;

export function requireApiKey(): string {
  const cred = resolveCredential();
  if (!cred.apiKey) {
    throw new CliError('No API key.', { hint: 'Run `baze login`, or set BAZE_API_KEY.' });
  }
  return cred.apiKey;
}

export async function modelsCommand(parsed: Parsed): Promise<number> {
  const apiKey = requireApiKey();
  const query = parsed.positionals[0]?.toLowerCase();
  const rows = chatModels(await fetchCatalog(apiKey)).filter(
    (r) => !query || r.id.toLowerCase().includes(query),
  );

  if (parsed.flags.get('json')) {
    out(JSON.stringify(rows, null, 2));
    return 0;
  }

  if (rows.length === 0) {
    say(query ? `No model matches "${query}".` : 'This key has no chat models.');
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
  info('Claude Code runs Claude-native models only; Codex runs Responses models; OpenCode runs all four lanes.');
  return 0;
}
