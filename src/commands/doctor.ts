import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Parsed } from '../args.js';
import { CLI_CONTRACT, fetchCatalogDetail } from '../api.js';
import { apiBase, loadStoredCredentials, resolveCredential } from '../config.js';
import { claudeEnv } from '../harness/claude.js';
import { readSkillSource, skillState, skillTargets } from './skill.js';
import { c, fail, info, maskKey, ok, say, warn } from '../ui.js';

export function claudeSettingsPath(): string {
  return join(process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude'), 'settings.json');
}
export function codexConfigPath(): string {
  return join(process.env.CODEX_HOME ?? join(homedir(), '.codex'), 'config.toml');
}
export function opencodeConfigPath(): string {
  return join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'opencode', 'opencode.json');
}

/**
 * A user-level settings.json `env` block outranks shell variables, so anything
 * in there pointing elsewhere silently wins over a plain `claude`.
 */
export function conflictingClaudeEnv(settings: unknown, expectedBase: string): string | undefined {
  if (!settings || typeof settings !== 'object') return undefined;
  const env = (settings as { env?: unknown }).env;
  if (!env || typeof env !== 'object') return undefined;
  const block = env as Record<string, unknown>;

  const base = block.ANTHROPIC_BASE_URL;
  if (typeof base === 'string' && base && base !== expectedBase) {
    return `ANTHROPIC_BASE_URL is set to ${base}`;
  }
  const key = block.ANTHROPIC_API_KEY;
  if (typeof key === 'string' && key !== '') {
    return 'ANTHROPIC_API_KEY is set to a literal key';
  }
  return undefined;
}

/**
 * Pure, so the rule is testable: only a NEWER server contract is drift. An
 * older or silent server is fine - a customer on an old CLI against a newer
 * gateway must keep working, and this warns; it never fails (spec §4.7).
 */
export function contractDrift(server: number | undefined, ours: number = CLI_CONTRACT): string | undefined {
  if (server === undefined || server <= ours) return undefined;
  return `The gateway publishes contract ${server}; this baze was built for ${ours}.`;
}

function toolVersion(bin: string): string | undefined {
  try {
    // A tool that hangs on --version (a first-run prompt, a broken shim) must not hang doctor.
    return execFileSync(bin, ['--version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 })
      .trim()
      .split('\n')[0];
  } catch {
    return undefined;
  }
}

export async function doctorCommand(_parsed: Parsed): Promise<number> {
  let problems = 0;

  const [major = 0, minor = 0] = process.versions.node.split('.').map(Number);
  if (major > 20 || (major === 20 && minor >= 10)) ok(`Node.js ${process.versions.node}`);
  else {
    fail(`Node.js ${process.versions.node} - baze needs 20.10 or newer.`);
    problems++;
  }

  const cred = resolveCredential();
  if (!cred.apiKey) {
    fail('No API key.');
    info('Run `baze login`, or set BAZE_API_KEY.');
    problems++;
  } else {
    const base = apiBase();
    try {
      const catalog = await fetchCatalogDetail(cred.apiKey, { force: true, base });
      ok(`Key ${maskKey(cred.apiKey)} (${cred.source}) works on ${base} - ${catalog.rows.filter((r) => r.type === 'llm').length} chat models.`);
      const drift = contractDrift(catalog.contract);
      if (drift) {
        warn(drift);
        info('Run `baze update`. Commands keep working; a new lane or model type may be missing.');
        problems++;
      }
      if (cred.source === 'stored' && !loadStoredCredentials()?.host) {
        warn('No host was recorded for this key; run `baze login` again to detect it.');
      }
    } catch (error) {
      fail(`Key rejected on ${base}: ${error instanceof Error ? error.message : String(error)}`);
      problems++;
    }
  }

  for (const [label, bin] of [
    ['Claude Code', 'claude'],
    ['Codex CLI', 'codex'],
    ['OpenCode', 'opencode'],
  ] as const) {
    const version = toolVersion(bin);
    if (version) ok(`${label} (${bin}): ${version}`);
    else info(`${label} (${bin}): not installed - baze runs the tools you already have.`);
  }

  const settingsPath = claudeSettingsPath();
  if (existsSync(settingsPath)) {
    let parsed: unknown;
    let readable = true;
    try {
      parsed = JSON.parse(readFileSync(settingsPath, 'utf8'));
    } catch {
      readable = false;
    }
    const conflict = readable
      ? conflictingClaudeEnv(parsed, claudeEnv({ apiKey: '', apiBase: apiBase() }).ANTHROPIC_BASE_URL)
      : undefined;
    if (!readable) {
      // An unreadable file has not been checked, so say nothing about conflicts.
      warn(`${settingsPath} is not valid JSON; \`baze setup claude\` would refuse to touch it.`);
      problems++;
    } else if (conflict) {
      warn(`${settingsPath}: ${conflict}.`);
      info('That block outranks shell variables. `baze claude` overrides it with --settings, but a plain `claude` will not reach us.');
      problems++;
    } else {
      ok(`${settingsPath} does not conflict with baze.`);
    }
  }

  for (const [label, path] of [
    ['Codex', codexConfigPath()],
    ['OpenCode', opencodeConfigPath()],
  ] as const) {
    if (existsSync(path)) ok(`${label} config: ${path}`);
  }

  // Advice, not a problem: baze works without the skill; the agent just does
  // not know about `baze gen` and `baze bot`.
  const skill = readSkillSource();
  for (const target of skillTargets()) {
    const state = skillState(target, skill);
    if (state === 'current') ok(`baze skill for ${target.label}: ${target.file}`);
    else if (state === 'missing') info(`baze skill for ${target.label}: not installed - \`baze skill install\` teaches it gen, bot and the cost rules.`);
    else if (state === 'outdated') warn(`baze skill for ${target.label} is out of date - run \`baze skill install\`.`);
  }

  say('');
  if (problems === 0) ok('Everything checks out.');
  else say(c.yellow(`${problems} thing${problems === 1 ? '' : 's'} to fix.`));
  return problems === 0 ? 0 : 1;
}
