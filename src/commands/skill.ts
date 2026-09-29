import { existsSync, mkdirSync, readdirSync, readFileSync, rmdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import type { Parsed } from '../args.js';
import { CliError, info, ok, out, say } from '../ui.js';

/**
 * The skill that teaches Claude Code and Codex to use `baze gen`, `baze bot`
 * and the cost rules. It ships in the package; a tool only reads it from its
 * own skills folder, so it does nothing until installed there.
 */
const SOURCE = new URL('../../skills/baze/SKILL.md', import.meta.url);

export interface SkillTarget {
  label: string;
  /** The tool's config home, where it reads skills from. */
  home: string;
  file: string;
  /**
   * Whether the tool itself is installed. A config folder is not proof - one
   * outlives an uninstall, and `baze setup codex` creates ~/.codex on a
   * machine without Codex - and a fresh install has none until its first run
   * (dev QA, 2026-09-28). Absent, the folder decides (tests build targets by hand).
   */
  installed?: boolean;
}

/** Whether `bin` is an executable on PATH; no process is started. */
export function onPath(bin: string, path: string = process.env.PATH ?? ''): boolean {
  const exts = process.platform === 'win32' ? (process.env.PATHEXT ?? '.EXE;.CMD').split(';') : [''];
  return path
    .split(delimiter)
    .filter(Boolean)
    .some((dir) => exts.some((ext) => existsSync(join(dir, `${bin}${ext}`))));
}

const toolInstalled = (target: SkillTarget): boolean => target.installed ?? existsSync(target.home);

export function skillTargets(): SkillTarget[] {
  const claude = process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude');
  const codex = process.env.CODEX_HOME ?? join(homedir(), '.codex');
  return [
    { label: 'Claude Code', home: claude, file: join(claude, 'skills', 'baze', 'SKILL.md'), installed: onPath('claude') },
    { label: 'Codex', home: codex, file: join(codex, 'skills', 'baze', 'SKILL.md'), installed: onPath('codex') },
  ];
}

export type SkillState = 'no-tool' | 'missing' | 'current' | 'outdated';

export function skillState(target: SkillTarget, source: string): SkillState {
  if (!toolInstalled(target)) return 'no-tool';
  if (!existsSync(target.file)) return 'missing';
  return readFileSync(target.file, 'utf8') === source ? 'current' : 'outdated';
}

export function readSkillSource(): string {
  return readFileSync(SOURCE, 'utf8');
}

/** Writes the skill into every tool that is set up here; returns the files written. */
export function installSkill(source: string, targets: SkillTarget[] = skillTargets()): string[] {
  const present = targets.filter(toolInstalled);
  if (present.length === 0) {
    throw new CliError('Neither Claude Code nor Codex is installed on this machine.', {
      hint: 'Install one of them first; baze looks for `claude` and `codex` on PATH.',
    });
  }
  const written: string[] = [];
  for (const target of present) {
    if (skillState(target, source) === 'current') continue;
    mkdirSync(dirname(target.file), { recursive: true });
    writeFileSync(target.file, source);
    written.push(target.file);
  }
  return written;
}

/** Removes only our file, and the `baze` folder when that leaves it empty. */
export function uninstallSkill(targets: SkillTarget[] = skillTargets()): string[] {
  const removed: string[] = [];
  for (const target of targets) {
    if (!existsSync(target.file)) continue;
    rmSync(target.file);
    removed.push(target.file);
    const dir = dirname(target.file);
    if (readdirSync(dir).length === 0) rmdirSync(dir);
  }
  return removed;
}

export async function skillCommand(parsed: Parsed): Promise<number> {
  const action = parsed.positionals[0] ?? 'install';
  const source = readSkillSource();

  if (action === 'show') {
    out(source);
    return 0;
  }
  if (action === 'status') {
    for (const target of skillTargets()) say(`${target.label}: ${describe(skillState(target, source), target)}`);
    return 0;
  }
  if (action === 'install') {
    if (parsed.flags.get('dry-run') === true) {
      for (const target of skillTargets()) say(`${target.label}: ${describe(skillState(target, source), target)}`);
      return 0;
    }
    const written = installSkill(source);
    if (written.length === 0) {
      ok('The baze skill is already installed and current.');
      return 0;
    }
    for (const file of written) ok(`Installed ${file}`);
    info('Claude Code and Codex read it at the start of a session, so restart any that are open.');
    return 0;
  }
  if (action === 'uninstall') {
    const removed = uninstallSkill();
    if (removed.length === 0) say('The baze skill was not installed.');
    for (const file of removed) ok(`Removed ${file}`);
    return 0;
  }
  throw new CliError(`Unknown action "${action}".`, { hint: 'baze skill install|uninstall|status|show' });
}

function describe(state: SkillState, target: SkillTarget): string {
  switch (state) {
    case 'no-tool':
      return 'not installed here';
    case 'missing':
      return 'not installed - run `baze skill install`';
    case 'outdated':
      return `outdated at ${target.file} - run \`baze skill install\``;
    case 'current':
      return `installed (${target.file})`;
  }
}
