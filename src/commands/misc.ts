import { execFileSync, spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ensureCacheDir } from '../config.js';
import { c, ok, out, say } from '../ui.js';

export const PACKAGE_NAME = '@mindlogic-ai/baze';
const DAY_MS = 24 * 60 * 60 * 1000;

interface UpdateMeta {
  last_check?: string;
  latest_version?: string;
}

export function shouldCheckUpdate(meta: UpdateMeta | undefined, now: Date = new Date()): boolean {
  if (!meta?.last_check) return true;
  const last = Date.parse(meta.last_check);
  if (Number.isNaN(last)) return true;
  return now.getTime() - last >= DAY_MS;
}

export function updateNudge(current: string, latest: string): string | undefined {
  if (!latest || latest === current) return undefined;
  return `A newer baze is available (${current} -> ${latest}). Run \`baze update\`.`;
}

const metaPath = (): string => join(ensureCacheDir(), 'update-meta.json');

function readMeta(): UpdateMeta | undefined {
  try {
    return JSON.parse(readFileSync(metaPath(), 'utf8')) as UpdateMeta;
  } catch {
    return undefined;
  }
}

function writeMeta(meta: UpdateMeta): void {
  try {
    writeFileSync(metaPath(), JSON.stringify(meta), { mode: 0o600 });
  } catch {
    // A read-only HOME only means no nudge.
  }
}

/** Reads the cache only - no network, no delay. */
export function printCachedNudge(current: string): void {
  const latest = readMeta()?.latest_version;
  const nudge = latest ? updateNudge(current, latest) : undefined;
  if (nudge) say(c.dim(nudge));
}

/**
 * The registry call runs in a detached child, so no command ever waits for
 * it - an awaited fetch, even with a timeout, still held every command (and
 * the first `baze login`) for up to its full length. `last_check` is written
 * before the spawn so parallel commands start one check, not several.
 */
export function refreshInBackground(): void {
  const meta = readMeta();
  if (!shouldCheckUpdate(meta)) return;
  writeMeta({ ...meta, last_check: new Date().toISOString() });
  try {
    const child = spawn(process.execPath, [process.argv[1]!, '__update-check'], {
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
  } catch {
    // Offline, sandboxed, no fork - none of it is the user's problem.
  }
}

/** Body of the hidden `__update-check` command. Silent by design. */
export async function refreshUpdateMeta(): Promise<number> {
  try {
    const res = await fetch(`https://registry.npmjs.org/${PACKAGE_NAME}/latest`, {
      signal: AbortSignal.timeout(5000),
    });
    const body = (await res.json()) as { version?: unknown };
    if (typeof body.version === 'string') {
      writeMeta({ last_check: new Date().toISOString(), latest_version: body.version });
    }
  } catch {
    // Try again tomorrow.
  }
  return 0;
}

export async function updateCommand(): Promise<number> {
  say(`Updating ${PACKAGE_NAME}...`);
  execFileSync('npm', ['install', '-g', `${PACKAGE_NAME}@latest`], { stdio: 'inherit' });
  ok('Done. Run `baze --version` to confirm.');
  return 0;
}

export async function docsCommand(): Promise<number> {
  const manual = new URL('../../AGENT_MANUAL.md', import.meta.url);
  out(readFileSync(manual, 'utf8'));
  return 0;
}
