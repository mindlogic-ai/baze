export type Lane = 'anthropic' | 'responses' | 'gemini' | 'compat';
/**
 * Every `type` `/v1/gateway/models/` can send. `embedding` and `rerank` joined
 * the list when Step 3 shipped their endpoints, `realtime` (live voice, PR
 * #4841) after that; `baze` serves chat only, so `chatModels()` drops them -
 * but the type has to describe the wire, or the next reader assumes a catalog
 * row is always launchable. Two revisions (R7-5, R9-2) added a type here after
 * the server did; `cli_contract` (api.ts) now makes that drift visible.
 */
export type ModelType = 'llm' | 'audio' | 'image' | 'video' | 'embedding' | 'rerank' | 'realtime';

export interface ModelPricing {
  /**
   * Every rate is nullable: `/models` prints a cache key only when the model
   * really has that rate (a model with no cache price bills cache writes at
   * the full input rate, and publishing that would read as a discount).
   */
  inputPer1mUsd: number | null;
  outputPer1mUsd: number | null;
  cacheReadPer1mUsd: number | null;
  cacheWritePer1mUsd: number | null;
  /** Anthropic 1h-TTL cache write, 1.6x the 5m rate. Null on every other lane. */
  cacheWrite1hPer1mUsd: number | null;
}

export interface ModelRow {
  id: string;
  type: ModelType;
  lane: Lane;
  contextLimit: number | null;
  /** Provider output ceiling from the catalog; absent or null when unknown. */
  maxOutputTokens?: number | null;
  /** USD per 1M tokens at list price, newest `price` row - what the biller reads. */
  pricing: ModelPricing | null;
}

export interface LaunchPlan {
  bin: string;
  args: string[];
  env: Record<string, string>;
  notes: string[];
  /** Private files the plan created (they hold the key); shown as placeholders, removed by cleanup. */
  tempFiles?: string[];
  cleanup?: () => void;
}

export interface StoredCredentials {
  api_key?: string;
  host?: string;
  saved_at?: string;
}

export interface Credential {
  apiKey?: string;
  source: 'env' | 'stored' | 'none';
  path?: string;
}

export interface UserConfig {
  api_base?: string;
}
