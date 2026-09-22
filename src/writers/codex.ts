import { ENV_KEY_NAME } from '../config.js';
import { CODEX_PROVIDER_ID } from '../harness/codex.js';
import { gatewayBase } from '../hosts.js';

/**
 * Rewrite ~/.codex/config.toml so a plain `codex` uses the gateway. Top-level
 * `model_provider`/`model` are replaced in the preamble (everything before the
 * first table header) and a fresh [model_providers.baze] table replaces any
 * previous one. Every other table is left byte-for-byte - we are editing
 * someone's config, not generating it.
 */
export function upsertCodexConfig(text: string, o: { model: string; apiBase: string }): string {
  const lines = text.split(/\r?\n/);
  const firstHeader = lines.findIndex((l) => /^\s*\[/.test(l));
  const preambleEnd = firstHeader === -1 ? lines.length : firstHeader;

  // The preamble also loses any dotted key that writes into the table we are
  // about to rebuild (`model_providers.baze.base_url = "..."` at top level).
  // TOML rejects a key defined twice, so leaving one behind made `codex` fail
  // to start with a duplicate-key error rather than use the gateway.
  const dropPreamble = new RegExp(
    `^\\s*(model_provider|model|model_providers\\.${CODEX_PROVIDER_ID}(\\.|\\s|=))`,
  );
  const preamble = lines.slice(0, preambleEnd).filter((l) => !dropPreamble.test(l));
  const rest = lines.slice(preambleEnd);

  // Drop the old table AND its sub-tables ([model_providers.baze.http_headers]).
  // Matching only the exact header left orphans that re-attached themselves to
  // the fresh block with stale values.
  const ours = new RegExp(`^\\s*\\[model_providers\\.${CODEX_PROVIDER_ID}(\\]|\\.)`);
  const cleaned: string[] = [];
  let skipping = false;
  for (const line of rest) {
    if (/^\s*\[/.test(line)) {
      skipping = ours.test(line);
    }
    if (!skipping) cleaned.push(line);
  }
  while (cleaned.length && cleaned[cleaned.length - 1]!.trim() === '') cleaned.pop();
  while (preamble.length && preamble[preamble.length - 1]!.trim() === '') preamble.pop();

  const block = [
    `[model_providers.${CODEX_PROVIDER_ID}]`,
    'name = "FactChat"',
    `base_url = "${gatewayBase(o.apiBase)}"`,
    `env_key = "${ENV_KEY_NAME}"`,
    'wire_api = "responses"',
  ];

  return [
    ...preamble,
    `model_provider = "${CODEX_PROVIDER_ID}"`,
    `model = "${o.model}"`,
    ...(cleaned.length ? ['', ...cleaned] : []),
    '',
    ...block,
    '',
  ].join('\n');
}
