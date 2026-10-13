import { unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { hasFlag } from '../args.js';
import { chatModels, launchRows } from '../catalog.js';
import { ensureTmpDir } from '../config.js';
import { gatewayBase } from '../hosts.js';
import type { LaunchPlan, ModelRow } from '../types.js';
import { CliError } from '../ui.js';

export interface HarnessOptions {
  apiKey: string;
  apiBase: string;
  model?: string;
  reasoningEffort?: string;
  rows: ModelRow[];
  /** False when `rows` is the offline fallback rather than this key's catalog. */
  catalogLive?: boolean;
  passthrough: string[];
  settingsFile?: boolean;
}

/**
 * ANTHROPIC_API_KEY must be present and empty, or Claude Code falls back to a
 * saved claude.ai login and the gateway never sees the traffic.
 */
export function claudeEnv(o: Pick<HarnessOptions, 'apiKey' | 'apiBase'>): Record<string, string> {
  return {
    ANTHROPIC_BASE_URL: `${gatewayBase(o.apiBase)}/claude`,
    ANTHROPIC_AUTH_TOKEN: o.apiKey,
    ANTHROPIC_API_KEY: '',
    CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY: '1',
  };
}

/**
 * Any chat model this key can call: the gateway serves a non-Claude model on
 * /claude by converting the Messages calls to chat completions.
 */
export function assertClaudeModel(model: string, rows: ModelRow[]): ModelRow {
  const row = chatModels(rows).find((r) => r.id === model);
  if (!row) {
    throw new CliError(`${model} is not available to this key.`, {
      hint: 'Run `baze models` to see the models it can call.',
    });
  }
  return row;
}

export function buildClaudePlan(o: HarnessOptions): LaunchPlan {
  // Offline, launchRows adds the pinned model, so an unlisted one is not refused.
  const row = o.model ? assertClaudeModel(o.model, launchRows(o.rows, o.model, o.catalogLive !== false)) : undefined;
  const env = claudeEnv(o);
  // Claude Code knows only Claude context windows and assumes 200k for any
  // other model, compacting early (or too late) without this.
  if (row && row.lane !== 'anthropic' && row.contextLimit) {
    env.CLAUDE_CODE_MAX_CONTEXT_TOKENS = String(row.contextLimit);
  }
  const args: string[] = [];
  let cleanup: (() => void) | undefined;
  const tempFiles: string[] = [];

  // A user-level settings.json `env` block outranks shell variables, so a stale
  // ANTHROPIC_BASE_URL from another gateway would silently win. The
  // command-line settings level beats every file, so hand the same block over
  // as a private temp file - the key never reaches argv.
  if (o.settingsFile !== false && !hasFlag(o.passthrough, '--settings')) {
    const path = join(ensureTmpDir(), `claude-settings-${process.pid}-${Date.now()}.json`);
    writeFileSync(path, JSON.stringify({ env }), { mode: 0o600 });
    args.push('--settings', path);
    tempFiles.push(path);
    cleanup = () => {
      try {
        unlinkSync(path);
      } catch {
        // already gone
      }
    };
  }

  if (o.model && !hasFlag(o.passthrough, '--model')) args.push('--model', o.model);
  args.push(...o.passthrough);

  return {
    bin: 'claude',
    args,
    env,
    notes: [
      `Claude Code -> ${env.ANTHROPIC_BASE_URL}${o.model ? ` · model ${o.model}` : ' · Claude Code default model'}`,
      'The /model picker lists every chat model this key can call, Claude first.',
    ],
    tempFiles,
    cleanup,
  };
}
