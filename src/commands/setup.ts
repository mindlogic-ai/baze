import { existsSync, readFileSync } from 'node:fs';
import type { Parsed } from '../args.js';
import { fetchCatalog } from '../api.js';
import { pickDefault, type Tool } from '../catalog.js';
import { apiBase, ENV_KEY_NAME } from '../config.js';
import { claudeEnv } from '../harness/claude.js';
import { opencodeConfig } from '../harness/opencode.js';
import { c, CliError, info, ok, out, say, warn } from '../ui.js';
import { backup, mergeClaudeSettings, readJsonObject, writeText } from '../writers/backup.js';
import { upsertCodexConfig } from '../writers/codex.js';
import { claudeSettingsPath, codexConfigPath, opencodeConfigPath } from './doctor.js';
import { requireApiKey } from './models.js';

const TOOLS: Tool[] = ['claude', 'codex', 'opencode'];

export async function setupCommand(parsed: Parsed): Promise<number> {
  const tool = parsed.positionals[0] as Tool | undefined;
  if (!tool || !TOOLS.includes(tool)) {
    throw new CliError('Name the tool to configure: baze setup <claude|codex|opencode> [--model ID] [--dry-run]');
  }

  const apiKey = requireApiKey();
  const base = apiBase();
  const dryRun = parsed.flags.get('dry-run') === true;
  // Unlike a launch, a permanent config must not be written from a guess: an
  // unreachable catalog is an error here, not a fallback.
  const rows = await fetchCatalog(apiKey, { base });
  const flagModel = parsed.flags.get('model');
  const model = typeof flagModel === 'string' ? flagModel : pickDefault(tool, rows);
  if (!model) {
    throw new CliError(`This key has no model that ${tool} can run.`, { hint: 'Run `baze models` to see what it can call.' });
  }

  if (tool === 'claude') {
    const path = claudeSettingsPath();
    const next = mergeClaudeSettings(readJsonObject(path), claudeEnv({ apiKey, apiBase: base }));
    const text = `${JSON.stringify(next, null, 2)}\n`;
    if (dryRun) {
      out(text);
      return 0;
    }
    const bak = backup(path);
    writeText(path, text);
    ok(`Wrote the FactChat env block into ${path}.${bak ? ` (backup: ${bak})` : ''}`);
    warn('This file now holds your API key in plain text. It is the user-level settings file, not a project one, so it will not be committed - but on a shared machine prefer `baze claude`.');
    info('A plain `claude` now goes through the gateway. To undo, restore the backup.');
    return 0;
  }

  if (tool === 'codex') {
    const path = codexConfigPath();
    const current = existsSync(path) ? readFileSync(path, 'utf8') : '';
    const text = upsertCodexConfig(current, { model, apiBase: base });
    if (dryRun) {
      out(text);
      return 0;
    }
    const bak = backup(path);
    writeText(path, text);
    ok(`Added the FactChat provider to ${path} and set the default model to ${model}.${bak ? ` (backup: ${bak})` : ''}`);
    printEnvHint();
    return 0;
  }

  const path = opencodeConfigPath();
  const existing = readJsonObject(path);
  const generated = opencodeConfig({ apiKey, apiBase: base, model, rows, passthrough: [] }) as {
    provider: Record<string, unknown>;
    model?: string;
    small_model?: string;
    agent?: Record<string, unknown>;
  };
  const currentProviders = (existing.provider && typeof existing.provider === 'object' ? existing.provider : {}) as Record<
    string,
    unknown
  >;
  const next = {
    $schema: 'https://opencode.ai/config.json',
    ...existing,
    provider: { ...currentProviders, ...generated.provider },
    ...(generated.model ? { model: generated.model } : {}),
    // Keep a user's own small model and agents; only fill them in when absent.
    ...(generated.small_model && !existing.small_model ? { small_model: generated.small_model } : {}),
    ...(generated.agent && !existing.agent ? { agent: generated.agent } : {}),
  };
  const text = `${JSON.stringify(next, null, 2)}\n`;
  if (dryRun) {
    out(text);
    return 0;
  }
  const bak = backup(path);
  writeText(path, text);
  ok(`Added ${Object.keys(generated.provider).length} FactChat providers to ${path}, default model ${model}.${bak ? ` (backup: ${bak})` : ''}`);
  printEnvHint();
  return 0;
}

function printEnvHint(): void {
  say('');
  say(`This config reads the key from ${c.bold(ENV_KEY_NAME)} in your shell. Add one line to ~/.zshrc:`);
  say(`  ${c.cyan('eval "$(baze env)"')}`);
  info('Or skip that and run `baze codex` / `baze opencode`, which need no shell variable.');
}
