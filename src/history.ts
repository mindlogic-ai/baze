import { appendFileSync, chmodSync, existsSync, readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { configDir, ensureCacheDir } from './config.js';

export type GenKind = 'image' | 'video' | 'speech' | 'music' | 'transcribe' | 'bot';
export type GenStatus = 'submitted' | 'processing' | 'completed' | 'failed';

/**
 * One line per event, never rewritten: a job is written when it is submitted
 * and again when it ends, and the last line for an id is its state. A crash
 * between the two - or a gateway that bills and then errors - leaves the
 * submitted line, which is what `baze gen wait` resumes from.
 */
export interface HistoryEntry {
  id: string;
  at: string;
  kind: GenKind;
  model: string;
  status: GenStatus;
  host: string;
  prompt?: string;
  operationId?: string;
  files?: string[];
  credits?: number | null;
  requestId?: string;
  error?: string;
}

export const historyPath = (): string => join(configDir(), 'history.jsonl');

/** Short enough to type back into `baze gen wait`. */
export const newHistoryId = (): string => randomBytes(4).toString('hex');

/** A prompt is kept for recognition, not as an archive. */
const PROMPT_KEEP = 500;

export function recordHistory(entry: HistoryEntry): void {
  // ensureCacheDir creates the config dir (0700) as a side effect of its parent.
  ensureCacheDir();
  const path = historyPath();
  const line = {
    ...entry,
    ...(entry.prompt !== undefined ? { prompt: entry.prompt.slice(0, PROMPT_KEEP) } : {}),
  };
  try {
    appendFileSync(path, `${JSON.stringify(line)}\n`, { mode: 0o600 });
    chmodSync(path, 0o600);
  } catch {
    // History is a convenience; a read-only HOME must not fail a paid call.
  }
}

/** Latest state per id, newest first. Unparseable lines are skipped. */
export function readHistory(): HistoryEntry[] {
  const path = historyPath();
  if (!existsSync(path)) return [];
  const latest = new Map<string, HistoryEntry>();
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line) as HistoryEntry;
      if (typeof entry.id !== 'string') continue;
      // A later line updates the id and moves it to the end of insertion order.
      const previous = latest.get(entry.id);
      latest.delete(entry.id);
      latest.set(entry.id, { ...(previous ?? {}), ...entry });
    } catch {
      continue;
    }
  }
  return [...latest.values()].reverse();
}

/** A history id, or an operation id the gateway handed out. */
export function findHistory(ref: string): HistoryEntry | undefined {
  return readHistory().find((e) => e.id === ref || e.operationId === ref);
}
