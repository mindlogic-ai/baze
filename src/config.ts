import { chmodSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { hostForKey } from './keys.js';
import type { Credential, StoredCredentials, UserConfig } from './types.js';

export const DEFAULT_API_BASE = 'https://factchat-cloud.mindlogic.ai';
export const ENV_KEY_NAME = 'BAZE_API_KEY';
export const ENV_BASE_NAME = 'BAZE_API_BASE';

export function configDir(): string {
  return process.env.BAZE_CONFIG_DIR ?? join(homedir(), '.baze');
}
export const credentialsPath = (): string => join(configDir(), 'credentials.json');
export const configPath = (): string => join(configDir(), 'config.json');
export const cacheDir = (): string => join(configDir(), 'cache');
export const tmpDir = (): string => join(configDir(), 'tmp');

function ensureDir(dir: string): string {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

export const ensureTmpDir = (): string => ensureDir(tmpDir());
export const ensureCacheDir = (): string => ensureDir(cacheDir());

export function readJsonFile<T>(path: string): T | undefined {
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  } catch {
    // A hand-edited or truncated file must not take the CLI down; treat it as absent.
    return undefined;
  }
}

/**
 * Owner-only, always. The create mode is subject to umask, so chmod again —
 * and swallow the failure on filesystems without POSIX mode bits.
 */
export function writePrivateJson(path: string, value: unknown): void {
  ensureDir(configDir());
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  try {
    chmodSync(path, 0o600);
  } catch {
    // Windows / ACL filesystems: best effort.
  }
}

export const loadUserConfig = (): UserConfig => readJsonFile<UserConfig>(configPath()) ?? {};
export const saveUserConfig = (config: UserConfig): void => writePrivateJson(configPath(), config);
export const loadStoredCredentials = (): StoredCredentials | undefined =>
  readJsonFile<StoredCredentials>(credentialsPath());

export function saveCredentials(update: Partial<StoredCredentials>): string {
  const path = credentialsPath();
  const current = loadStoredCredentials() ?? {};
  writePrivateJson(path, { ...current, ...update, saved_at: new Date().toISOString() });
  return path;
}

export function clearCredentials(): boolean {
  const path = credentialsPath();
  if (!existsSync(path)) return false;
  unlinkSync(path);
  return true;
}

/** Environment first, so CI, containers and the sandbox need no file. */
export function resolveCredential(): Credential {
  const fromEnv = process.env[ENV_KEY_NAME]?.trim();
  if (fromEnv) return { apiKey: fromEnv, source: 'env' };
  const stored = loadStoredCredentials();
  if (stored?.api_key) return { apiKey: stored.api_key, source: 'stored', path: credentialsPath() };
  return { source: 'none' };
}

/**
 * Where the key in effect lives. An explicit base wins; then the host a login
 * recorded for this same key (it may be a local or staging server chosen on
 * purpose); then the key's own deployment tag. A different key from the
 * environment never inherits the stored host - an NCP key would otherwise go
 * to AWS and 401 unexplained.
 */
export function apiBase(): string {
  const stored = loadStoredCredentials();
  const envKey = process.env[ENV_KEY_NAME]?.trim();
  const key = envKey || stored?.api_key;
  const storedHostApplies = !envKey || envKey === stored?.api_key;
  const base =
    process.env[ENV_BASE_NAME] ||
    (storedHostApplies ? stored?.host : undefined) ||
    (key ? hostForKey(key) : undefined) ||
    loadUserConfig().api_base ||
    DEFAULT_API_BASE;
  return base.replace(/\/+$/, '');
}
