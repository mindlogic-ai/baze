export type Lane = 'anthropic' | 'responses' | 'gemini' | 'compat';
/**
 * Every `type` `/v1/gateway/models/` can send. `embedding`, `rerank`,
 * `decisions` and `realtime` joined the list after `llm`; the launchers serve
 * chat only, so `chatModels()` drops them - but the type has to describe the
 * wire, or the next reader assumes a catalog row is always launchable.
 * `cli_contract` (api.ts) makes a type the server adds first visible.
 */
export type ModelType = 'llm' | 'audio' | 'image' | 'video' | 'embedding' | 'rerank' | 'decisions' | 'realtime';

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
  /**
   * Audio rows only: the engine behind the model (`google` = text-to-speech,
   * `google_lyria3` / `elevenlabs` = music, `soniox` = transcription). The
   * gateway's only way to tell those apart, since all are `type: "audio"`.
   */
  audioClient?: string | null;
  /**
   * Priced per audio token (`gpt-audio-1.5`): OpenAI refuses such a call
   * unless audio is on one side, so a text-only coding agent cannot use it.
   */
  audioTokens?: boolean;
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
