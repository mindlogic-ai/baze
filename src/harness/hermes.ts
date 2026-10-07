import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { hasFlag } from '../args.js';
import { chatModels, launchRows } from '../catalog.js';
import { gatewayBase } from '../hosts.js';
import type { LaunchPlan, ModelRow } from '../types.js';
import { CliError } from '../ui.js';
import type { HarnessOptions } from './claude.js';

/**
 * Hermes Agent (NousResearch) speaks OpenAI Chat Completions to
 * `<base_url>/chat/completions`, so through the gateway's OpenAI-compatible
 * endpoint it reaches every chat model the key can call. Every lane rides the
 * Chat Completions path, Claude included - so Anthropic prompt caching does
 * not apply there, unlike `baze claude` or OpenCode's native Claude provider.
 *
 * The launch is env-only, measured against Hermes v0.21.1:
 *   - `--provider custom` with `CUSTOM_BASE_URL` picks the endpoint and beats
 *     whatever provider or base_url ~/.hermes/config.yaml names;
 *   - Hermes never sends OPENAI_API_KEY (or CUSTOM_API_KEY on this path) to a
 *     host other than openai.com - it sends `Bearer no-key-required` and the
 *     gateway answers 401. The one env key it does send to a custom host is
 *     `<VENDOR>_API_KEY`, the vendor being the host's registrable label
 *     (hermes_cli/runtime_provider.py `_host_derived_api_key`). So the key goes
 *     out under that name: MINDLOGIC_API_KEY for factchat-cloud.mindlogic.ai,
 *     BAZE_API_KEY for api.baze.co.
 */
export const HERMES_BASE_URL_ENV = 'CUSTOM_BASE_URL';

/**
 * Port of Hermes' `_host_derived_api_key` name rule. Returns the env var name
 * Hermes reads for this base URL, or undefined where Hermes derives none (an
 * IP, localhost, a single-label host, or a vendor label
 * Hermes reserves for its own gated paths).
 */
export function hermesKeyEnvName(baseUrl: string): string | undefined {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    return undefined;
  }
  const hostname = url.hostname.toLowerCase();
  const labels = hostname.split('.').filter((l) => l !== '');
  const last = labels[labels.length - 1] ?? '';
  if (hostname === '' || hostname === 'localhost' || hostname.includes(':') || /\d/.test(last)) return undefined;
  while (labels.length > 0 && (labels[0] === 'api' || labels[0] === 'www')) labels.shift();
  if (labels.length < 2) return undefined;
  const vendor = labels[labels.length - 2]!.replace(/[^A-Za-z0-9]/g, '_').toUpperCase();
  if (!/^[A-Z]/.test(vendor) || ['OPENAI', 'OPENROUTER', 'OLLAMA'].includes(vendor)) return undefined;
  return `${vendor}_API_KEY`;
}

/**
 * Hermes loads ~/.hermes/.env with override, so a CUSTOM_BASE_URL or the
 * derived key in that file beats what this launch sets. Returns the names that
 * would win, so the launch can say so instead of failing with a 401.
 */
export function dotenvOverrides(text: string, names: readonly string[]): string[] {
  const defined = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line);
    if (m) defined.add(m[1]!);
  }
  return names.filter((n) => defined.has(n));
}

function hermesDotenvPath(): string {
  return join(process.env.HERMES_HOME ?? join(homedir(), '.hermes'), '.env');
}

function readDotenv(path: string): string {
  try {
    return existsSync(path) ? readFileSync(path, 'utf8') : '';
  } catch {
    return '';
  }
}

export function assertHermesModel(model: string, rows: ModelRow[], live: boolean): void {
  if (!live) return;
  if (rows.some((r) => r.id === model && r.audioTokens)) {
    throw new CliError(`${model} answers only with audio, so a coding agent cannot use it.`, {
      hint: 'Call it through the chat completions API with audio input or output.',
    });
  }
  if (!chatModels(rows).some((r) => r.id === model)) {
    throw new CliError(`${model} is not available to this key.`, {
      hint: 'Run `baze models` to see what it can call.',
    });
  }
}

export function buildHermesPlan(o: HarnessOptions & { dotenvText?: string }): LaunchPlan {
  const live = o.catalogLive !== false;
  if (o.model) assertHermesModel(o.model, launchRows(o.rows, o.model, live), live);

  const base = gatewayBase(o.apiBase);
  const keyEnv = hermesKeyEnvName(base);
  if (!keyEnv) {
    throw new CliError(`Hermes will not send an API key to ${base}.`, {
      hint: 'Hermes only sends a key from the environment to a named host (it derives the variable from the domain). Add a provider with `base_url` and `api_key_env: BAZE_API_KEY` to ~/.hermes/config.yaml and run `hermes` directly.',
    });
  }

  const args: string[] = [];
  if (!hasFlag(o.passthrough, '--provider')) args.push('--provider', 'custom');
  if (o.model && !hasFlag(o.passthrough, '-m') && !hasFlag(o.passthrough, '--model')) args.push('-m', o.model);
  args.push(...o.passthrough);

  const notes = [
    `Hermes -> ${base} (Chat Completions)${o.model ? ` · model ${o.model}` : ''}`,
    'Nothing was written to disk; your ~/.hermes config is untouched.',
  ];
  const dotenvPath = hermesDotenvPath();
  const overridden = dotenvOverrides(o.dotenvText ?? readDotenv(dotenvPath), [HERMES_BASE_URL_ENV, keyEnv]);
  if (overridden.length > 0) {
    notes.push(`${dotenvPath} sets ${overridden.join(' and ')}, and Hermes lets that file win over this launch. Remove it there if the session does not reach Baze.`);
  }

  return {
    bin: 'hermes',
    args,
    env: { [HERMES_BASE_URL_ENV]: base, [keyEnv]: o.apiKey },
    notes,
  };
}
