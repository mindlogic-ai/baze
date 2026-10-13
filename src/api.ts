import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { apiBase, cacheDir, ensureCacheDir } from './config.js';
import { gatewayBase } from './hosts.js';
import type { Lane, ModelRow, ModelType } from './types.js';
import { CliError } from './ui.js';

const CATALOG_TTL_MS = 10 * 60 * 1000;

/**
 * Bumped whenever `ModelRow` gains a field. The cache lives in the same
 * directory across upgrades, so a list an older baze wrote (one without
 * `audioClient`) must be refetched, not trusted for the rest of its TTL.
 */
const CATALOG_CACHE_VERSION = 3;

interface GatewayErrorBody {
  error?: { message?: string };
  /**
   * FastAPI's `detail`. This gateway sends an OBJECT - `raise_api_error` builds
   * `{"code": 4001, "message": "..."}` - while other
   * routes on the same host still send a plain string. Reading it as a string
   * printed "[object Object]" for every gateway error.
   */
  detail?: string | { code?: number; message?: string };
}

function detailText(detail: GatewayErrorBody['detail']): string | undefined {
  if (typeof detail === 'string') return detail;
  if (detail && typeof detail.message === 'string') return detail.message;
  return undefined;
}

function messageFor(status: number, body: GatewayErrorBody | undefined): string {
  const server = body?.error?.message ?? detailText(body?.detail);
  if (status === 401) return server ?? 'The API key was rejected.';
  if (status === 402) return server ?? 'Not enough credit for this call.';
  if (status === 403) return server ?? 'This key is not allowed to do that.';
  if (status === 404) return server ?? 'No such model or endpoint for this key.';
  if (status === 429) return server ?? 'Rate limit reached.';
  if (status === 503) return server ?? 'Baze is in maintenance.';
  return server ?? `Gateway returned HTTP ${status}.`;
}

function hintFor(status: number): string | undefined {
  if (status === 401)
    return 'Run `baze login` again. A key belongs to one deployment: a key in BAZE_API_KEY also needs BAZE_API_BASE if it is not for the default host.';
  if (status === 402) return 'Run `baze credits` to see the balance.';
  if (status === 404) return 'Run `baze models` to see what this key can call.';
  if (status === 429) return 'The gateway allows 120 requests a minute per member.';
  return undefined;
}

export interface RawReply {
  status: number;
  contentType: string;
  text: string;
  /** The gateway's X-Request-ID; absent on a gateway that does not send it yet. */
  requestId?: string;
}

export interface BytesReply {
  status: number;
  contentType: string;
  bytes: Buffer;
  requestId?: string;
  headers: Headers;
}

interface RequestOpts {
  apiKey: string;
  base?: string;
  method?: string;
  body?: unknown;
  /** Multipart upload; the runtime sets the boundary, so no content-type here. */
  form?: FormData;
  headers?: Record<string, string>;
  fetchImpl?: typeof fetch;
  /**
   * Give up after this long. Unset, a request gets DEFAULT_REQUEST_TIMEOUT_MS;
   * work that can run for minutes (generation, a chatbot turn, an MCP tool
   * call) sets its own.
   */
  timeoutMs?: number;
}

const requestIdOf = (res: Response): string | undefined => res.headers.get('x-request-id') ?? undefined;

/** Retry-After in seconds. The gateway sends the delta form; an HTTP date is not read. */
export function retryAfterOf(res: Response): number | undefined {
  const raw = res.headers.get('retry-after');
  const n = raw === null ? Number.NaN : Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

const isTimeout = (error: unknown): boolean => (error as Error)?.name === 'TimeoutError';

/**
 * A read or a short call answers in well under a second; a minute means the
 * host is stuck, not busy. Without a bound a stalled connection held a command
 * open indefinitely.
 */
export const DEFAULT_REQUEST_TIMEOUT_MS = 60_000;

/** Embed, rerank and guard carry up to thousands of inputs in one call. */
export const BATCH_REQUEST_TIMEOUT_MS = 120_000;

const timedOut = (where: string, timeoutMs: number | undefined): CliError =>
  new CliError(`No answer from ${where} after ${Math.round((timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS) / 1000)}s.`, {
    hint:
      timeoutMs === undefined
        ? 'The server may be overloaded; try again in a moment.'
        : 'The request may still be running there; raise --timeout to wait longer.',
  });

/**
 * A body read under the request's timeout. The signal also covers the body, so
 * a stream that stalls after the headers ends here rather than hanging.
 */
async function readBody<T>(read: () => Promise<T>, where: string, timeoutMs: number | undefined): Promise<T> {
  try {
    return await read();
  } catch (error) {
    if (isTimeout(error)) throw timedOut(where, timeoutMs);
    throw new CliError(`The answer from ${where} was cut off.`, { hint: 'Check the network and retry.' });
  }
}

/** A provider file download: a finished result, so a stall means the host is not coming back. */
const DOWNLOAD_TIMEOUT_MS = 600_000;

/**
 * The authed request and the gateway's error mapping, before any reading of a
 * successful body. Every error carries the request id when the gateway sent one.
 */
async function gatewayRequest(path: string, opts: RequestOpts): Promise<Response> {
  const doFetch = opts.fetchImpl ?? fetch;
  const base = opts.base ?? apiBase();
  // An absolute gateway path (a download link the gateway itself handed out)
  // goes to the same host; anything else is under /v1/gateway.
  const url = path.startsWith('/v1/') ? `${base.replace(/\/+$/, '')}${path}` : `${gatewayBase(base)}${path}`;
  let res: Response;
  try {
    res = await doFetch(url, {
      method: opts.method ?? 'GET',
      headers: {
        authorization: `Bearer ${opts.apiKey}`,
        ...(opts.body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(opts.headers ?? {}),
      },
      ...(opts.form !== undefined ? { body: opts.form } : {}),
      ...(opts.body === undefined ? {} : { body: JSON.stringify(opts.body) }),
      signal: AbortSignal.timeout(opts.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    if (isTimeout(error)) throw timedOut(base, opts.timeoutMs);
    // No status: callers treat this as "unreachable", not "refused".
    throw new CliError(`Could not reach ${base}.`, {
      hint: 'Check the network, or the host in --api-base / BAZE_API_BASE.',
    });
  }
  if (!res.ok) {
    const text = await res.text();
    let parsed: GatewayErrorBody | undefined;
    try {
      parsed = text ? (JSON.parse(text) as GatewayErrorBody) : undefined;
    } catch {
      parsed = undefined;
    }
    const detail = parsed?.detail;
    throw new CliError(messageFor(res.status, parsed), {
      hint: hintFor(res.status),
      exitCode: res.status === 402 ? 2 : 1,
      status: res.status,
      requestId: requestIdOf(res),
      retryAfterS: res.status === 429 ? retryAfterOf(res) : undefined,
      gatewayCode: detail && typeof detail === 'object' && typeof detail.code === 'number' ? detail.code : undefined,
    });
  }
  return res;
}

/** A successful binary body (audio, a proxied video) with its headers. */
export async function gatewayFetchBytes(path: string, opts: RequestOpts): Promise<BytesReply> {
  const res = await gatewayRequest(path, opts);
  return {
    status: res.status,
    contentType: res.headers.get('content-type') ?? '',
    bytes: Buffer.from(await readBody(() => res.arrayBuffer(), opts.base ?? apiBase(), opts.timeoutMs)),
    requestId: requestIdOf(res),
    headers: res.headers,
  };
}

/**
 * A result file at a provider URL the gateway returned. No key goes with it:
 * these are third-party hosts, and a signed URL carries its own credential.
 */
export async function downloadPublic(
  url: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs: number = DOWNLOAD_TIMEOUT_MS,
): Promise<{ bytes: Buffer; contentType: string }> {
  const host = new URL(url).host;
  let res: Response;
  try {
    res = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    if (isTimeout(error)) throw timedOut(host, timeoutMs);
    throw new CliError(`Could not download ${host}.`, { hint: 'Check the network and retry.' });
  }
  if (!res.ok) throw new CliError(`Download failed: ${host} answered HTTP ${res.status}.`);
  const bytes = await readBody(() => res.arrayBuffer(), host, timeoutMs);
  return { bytes: Buffer.from(bytes), contentType: res.headers.get('content-type') ?? '' };
}

/**
 * The authed request with the gateway's error mapping and no parsing of a
 * successful body. `gatewayFetch` is this plus JSON; the MCP relay (Task 19)
 * needs the text itself, because the suites answer as an SSE stream.
 */
export async function gatewayFetchRaw(path: string, opts: RequestOpts): Promise<RawReply> {
  const res = await gatewayRequest(path, opts);
  return {
    status: res.status,
    contentType: res.headers.get('content-type') ?? '',
    text: await readBody(() => res.text(), opts.base ?? apiBase(), opts.timeoutMs),
    requestId: requestIdOf(res),
  };
}

export async function gatewayFetch<T>(path: string, opts: RequestOpts): Promise<T> {
  return (await gatewayFetchJson<T>(path, opts)).body;
}

/** JSON plus the request id, for commands that record or print it. */
export async function gatewayFetchJson<T>(
  path: string,
  opts: RequestOpts,
): Promise<{ body: T; requestId?: string }> {
  const { text, requestId } = await gatewayFetchRaw(path, opts);
  try {
    return { body: (text ? JSON.parse(text) : undefined) as T, requestId };
  } catch {
    return { body: undefined as T, requestId };
  }
}

interface RawModel {
  id: string;
  type: ModelType;
  /** Gateway paths that serve this model; the lane is read off this list. */
  endpoints?: string[] | null;
  context_limit?: number | null;
  max_output_tokens?: number | null;
  audio_client?: string | null;
  /** USD per 1M tokens. Null for a model with no price row; each key optional. */
  pricing?: {
    input?: number | null;
    output?: number | null;
    cache_read?: number | null;
    cache_write?: number | null;
    cache_write_1h?: number | null;
    audio_input?: number | null;
    audio_output?: number | null;
  } | null;
}

/**
 * The lane is not a field: `/models` publishes `endpoints`, the paths that
 * actually serve the model, and the native path names the lane. Deriving it
 * here keeps one source of truth on the server - a `lane` field would be a
 * second mapping to keep in sync with the routing it describes.
 *
 * Path matching only. These are URLs we build requests against, never text we
 * interpret.
 */
const LANE_BY_PATH: ReadonlyArray<readonly [string, Lane]> = [
  ['/gateway/claude/', 'anthropic'],
  ['/gateway/gemini/', 'gemini'],
  ['/gateway/responses', 'responses'],
];

export function laneFor(endpoints: readonly string[] | null | undefined): Lane {
  for (const [needle, lane] of LANE_BY_PATH) {
    if (endpoints?.some((e) => e.includes(needle))) return lane;
  }
  // No native path (or an older gateway that sends no endpoints): the
  // OpenAI-compatible lane, which every relayable model answers on.
  return 'compat';
}

function toRow(raw: RawModel): ModelRow {
  const p = raw.pricing;
  return {
    id: raw.id,
    type: raw.type,
    lane: laneFor(raw.endpoints),
    contextLimit: raw.context_limit ?? null,
    maxOutputTokens: raw.max_output_tokens ?? null,
    ...(p?.audio_input != null || p?.audio_output != null ? { audioTokens: true } : {}),
    ...(raw.type === 'audio' ? { audioClient: raw.audio_client ?? null } : {}),
    pricing: p
      ? {
          inputPer1mUsd: p.input ?? null,
          outputPer1mUsd: p.output ?? null,
          cacheReadPer1mUsd: p.cache_read ?? null,
          cacheWritePer1mUsd: p.cache_write ?? null,
          cacheWrite1hPer1mUsd: p.cache_write_1h ?? null,
        }
      : null,
  };
}

/**
 * Model visibility is per member group, and a machine can hold keys for both
 * deployments, so one shared cache file would serve one key's catalog to
 * another for ten minutes. Key the file by host and a hash of the key.
 */
export function catalogCachePath(base: string, apiKey: string): string {
  const id = createHash('sha256').update(`${base}\n${apiKey}`).digest('hex').slice(0, 16);
  return join(cacheDir(), `catalog-${id}.json`);
}

/**
 * The `/models` contract this build was written against. The server publishes
 * its own as `cli_contract` and bumps it only when an older CLI could no longer
 * describe the wire - a new catalog type, a new lane, a key or auth change;
 * never for a new model. `baze doctor` compares the two (spec §4.7).
 */
export const CLI_CONTRACT = 1;

export interface Catalog {
  rows: ModelRow[];
  /** Absent on a gateway older than revision 9. */
  contract?: number;
}

export async function fetchCatalogDetail(
  apiKey: string,
  opts: { force?: boolean; base?: string; fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<Catalog> {
  const base = opts.base ?? apiBase();
  ensureCacheDir();
  const file = catalogCachePath(base, apiKey);
  if (!opts.force && existsSync(file)) {
    try {
      const cached = JSON.parse(readFileSync(file, 'utf8')) as { v?: number; at: number; rows: ModelRow[]; contract?: number };
      if (cached.v === CATALOG_CACHE_VERSION && Date.now() - cached.at < CATALOG_TTL_MS) {
        return { rows: cached.rows, contract: cached.contract };
      }
    } catch {
      // fall through and refetch
    }
  }
  const body = await gatewayFetch<{ data: RawModel[]; cli_contract?: number }>('/models/', {
    apiKey,
    base,
    fetchImpl: opts.fetchImpl,
    timeoutMs: opts.timeoutMs,
  });
  const catalog: Catalog = { rows: body.data.map(toRow) };
  if (typeof body.cli_contract === 'number') catalog.contract = body.cli_contract;
  try {
    writeFileSync(file, JSON.stringify({ v: CATALOG_CACHE_VERSION, at: Date.now(), ...catalog }), { mode: 0o600 });
  } catch {
    // A read-only HOME must not break the command.
  }
  return catalog;
}

export async function fetchCatalog(
  apiKey: string,
  opts: { force?: boolean; base?: string; fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<ModelRow[]> {
  return (await fetchCatalogDetail(apiKey, opts)).rows;
}
