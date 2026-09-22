import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { CliError } from '../ui.js';

/** Timestamped copy next to the original, so a revert is one `cp`. */
export function backup(path: string): string | undefined {
  if (!existsSync(path)) return undefined;
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '');
  const target = `${path}.bak-${stamp}`;
  copyFileSync(path, target);
  return target;
}

/** These files carry the API key: owner-only, and tighten an existing file. */
export function writeText(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text, { mode: 0o600 });
  try {
    chmodSync(path, 0o600);
  } catch {
    // Windows / ACL filesystems: best effort.
  }
}

export function readJsonObject(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {};
  const raw = readFileSync(path, 'utf8');
  if (!raw.trim()) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('object expected');
    return parsed as Record<string, unknown>;
  } catch {
    throw new CliError(`${path} is not valid JSON, so it was left untouched.`, {
      hint: 'Fix the syntax (comments are not allowed in JSON) and run the command again.',
    });
  }
}

export function mergeClaudeSettings(
  existing: Record<string, unknown>,
  env: Record<string, string>,
): Record<string, unknown> {
  const current = (existing.env && typeof existing.env === 'object' ? existing.env : {}) as Record<string, unknown>;
  return { ...existing, env: { ...current, ...env } };
}
