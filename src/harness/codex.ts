import { ENV_KEY_NAME } from '../config.js';
import { gatewayBase } from '../hosts.js';
import type { LaunchPlan } from '../types.js';
import type { HarnessOptions } from './claude.js';

export const CODEX_PROVIDER_ID = 'baze';

const toml = (value: string): string => JSON.stringify(value);

/**
 * Codex reads ~/.codex/config.toml, but `-c key=value` beats the file, so a
 * launch never edits the user's config.
 */
export function codexOverrides(o: HarnessOptions): string[] {
  const overrides = [
    `model_provider=${toml(CODEX_PROVIDER_ID)}`,
    `model_providers.${CODEX_PROVIDER_ID}.name=${toml('Baze')}`,
    `model_providers.${CODEX_PROVIDER_ID}.base_url=${toml(gatewayBase(o.apiBase))}`,
    `model_providers.${CODEX_PROVIDER_ID}.env_key=${toml(ENV_KEY_NAME)}`,
    `model_providers.${CODEX_PROVIDER_ID}.wire_api=${toml('responses')}`,
  ];
  if (o.model) overrides.push(`model=${toml(o.model)}`);

  if (o.reasoningEffort) {
    const effort =
      o.reasoningEffort === 'max' ? 'xhigh' : o.reasoningEffort === 'none' ? 'minimal' : o.reasoningEffort;
    overrides.push(`model_reasoning_effort=${toml(effort)}`);
  }

  // A service_tier in the user's config asks for a tier the gateway has no
  // pricing contract for; reset it for this launch only.
  overrides.push(`service_tier=${toml('default')}`);

  // Codex 0.144+ ships the OpenAI-hosted `web_search` tool on every turn. The
  // gateway has no pricing contract for a hosted tool and answers 400, which
  // kills the very first turn. Leave a user's own override alone.
  const userSetWebSearch = o.passthrough.some((a) => /^web_search\s*=/.test(a));
  if (!userSetWebSearch) overrides.push(`web_search=${toml('disabled')}`);

  return overrides.flatMap((entry) => ['-c', entry]);
}

export function buildCodexPlan(o: HarnessOptions): LaunchPlan {
  return {
    bin: 'codex',
    args: [...codexOverrides(o), ...o.passthrough],
    env: { [ENV_KEY_NAME]: o.apiKey },
    notes: [
      `Codex -> ${gatewayBase(o.apiBase)} (Responses API)${o.model ? ` · model ${o.model}` : ''}${o.reasoningEffort ? ` · reasoning ${o.reasoningEffort}` : ''}`,
      'service_tier and the hosted web_search tool are reset for this launch; your config.toml is untouched.',
    ],
  };
}
