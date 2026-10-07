import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Parsed } from '../args.js';
import { CLI_CONTRACT, fetchCatalogDetail } from '../api.js';
import { apiBase, loadStoredCredentials, resolveCredential } from '../config.js';
import { claudeEnv } from '../harness/claude.js';
import { readSkillSource, skillState, skillTargets } from './skill.js';
import { c, item, mark, maskKey, say, section, shortPath } from '../ui.js';

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

/**
 * Grouped the way `/mcp` in Claude Code is: a bold heading per area, one line
 * per thing with a colored glyph, detail dimmed. Ten flat "OK ..." lines mixed
 * the key, the tools, the config files and the skill (feedback, 2026-09-28).
 */
export async function doctorCommand(_parsed: Parsed): Promise<number> {
  let problems = 0;
  let advice = 0;
  const [major = 0, minor = 0] = process.versions.node.split('.').map(Number);
  const nodeOk = major > 20 || (major === 20 && minor >= 10);

  section('Account');
  const cred = resolveCredential();
  if (!cred.apiKey) {
    item(mark.fail, 'No API key', 'run `baze login`, or set BAZE_API_KEY');
    problems++;
  } else {
    const base = apiBase();
    try {
      const catalog = await fetchCatalogDetail(cred.apiKey, { force: true, base });
      const chat = catalog.rows.filter((r) => r.type === 'llm').length;
      item(mark.ok, `Key ${maskKey(cred.apiKey)}`, `${cred.source} · ${hostOf(base)} · ${chat} chat models`);
      const drift = contractDrift(catalog.contract);
      if (drift) {
        item(mark.warn, drift, 'run `baze update`; a new lane or model type may be missing');
        problems++;
      }
      if (cred.source === 'stored' && !loadStoredCredentials()?.host) {
        item(mark.warn, 'No host recorded for this key', 'run `baze login` again to detect it');
      }
    } catch (error) {
      item(mark.fail, `Key rejected on ${hostOf(base)}`, error instanceof Error ? error.message : String(error));
      problems++;
    }
  }

  say('');
  section('Coding agents', 'baze runs the ones you already have');
  const tools = [
    ['Claude Code', 'claude'],
    ['Codex CLI', 'codex'],
    ['OpenCode', 'opencode'],
    ['Hermes Agent', 'hermes'],
  ] as const;
  const width = Math.max(...tools.map(([label]) => label.length));
  for (const [label, bin] of tools) {
    const version = toolVersion(bin);
    // `2.1.283 (Claude Code)`, `codex-cli 0.157.1`: the number is what differs.
    if (version) item(mark.ok, label.padEnd(width), version.match(/\d+(?:\.\d+)+/)?.[0] ?? version);
    else item(mark.off, label.padEnd(width), 'not installed');
  }

  const files: Array<[string, string, string?]> = [];
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
      files.push([mark.warn, settingsPath, 'not valid JSON; `baze setup claude` would refuse to touch it']);
      problems++;
    } else if (conflict) {
      files.push([mark.warn, settingsPath, `${conflict} - outranks shell variables, so a plain \`claude\` will not reach us (\`baze claude\` still does)`]);
      problems++;
    } else {
      files.push([mark.ok, settingsPath, 'no conflict']);
    }
  }
  for (const path of [codexConfigPath(), opencodeConfigPath()]) {
    if (existsSync(path)) files.push([mark.ok, path]);
  }
  if (files.length > 0) {
    say('');
    section('Config files');
    for (const [glyph, path, detail] of files) item(glyph, shortPath(path), detail);
  }

  // Advice, not a problem: baze works without the skill; the agent just does
  // not know about `baze gen` and `baze bot`.
  const skill = readSkillSource();
  const targets = skillTargets()
    .map((target) => ({ target, state: skillState(target, skill) }))
    .filter(({ state }) => state !== 'no-tool');
  if (targets.length > 0) {
    say('');
    section('baze skill', 'teaches the agent gen, bot and the cost rules');
    const skillWidth = Math.max(...targets.map(({ target }) => target.label.length));
    for (const { target, state } of targets) {
      const label = target.label.padEnd(skillWidth);
      if (state === 'current') item(mark.ok, label, shortPath(target.file));
      else {
        item(mark.warn, label, state === 'outdated' ? 'out of date · run `baze skill install`' : 'not installed · run `baze skill install`');
        advice++;
      }
    }
  }

  if (!nodeOk) {
    say('');
    section('Runtime');
    item(mark.fail, `Node.js ${process.versions.node}`, 'baze needs 20.10 or newer');
    problems++;
  }

  say('');
  const extra = advice > 0 ? c.dim(` · ${advice} optional`) : '';
  if (problems === 0) say(`${mark.ok} All good${extra}`);
  else say(`${c.yellow(`${problems} thing${problems === 1 ? '' : 's'} to fix`)}${extra}`);
  return problems === 0 ? 0 : 1;
}

/** The host alone; the scheme adds nothing to read. */
const hostOf = (base: string): string => {
  try {
    return new URL(base).host;
  } catch {
    return base;
  }
};
