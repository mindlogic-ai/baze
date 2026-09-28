import { existsSync, readFileSync } from 'node:fs';
import { basename } from 'node:path';
import type { Parsed } from '../args.js';
import {
  downloadPublic,
  fetchCatalog,
  gatewayFetch,
  gatewayFetchBytes,
  gatewayFetchJson,
} from '../api.js';
import { byType } from '../catalog.js';
import { apiBase } from '../config.js';
import { findHistory, type GenKind, type HistoryEntry, newHistoryId, recordHistory } from '../history.js';
import {
  decodeDataUrl,
  extensionFor,
  imageInput,
  outputPaths,
  pcmToWav,
  writeResult,
} from '../media.js';
import { checkCount, checkParams, describeParams, type ParamSpec, parseSets } from '../params.js';
import { c, CliError, formatCredits, info, out, say } from '../ui.js';
import { requireApiKey } from './models.js';

const KINDS = ['image', 'video', 'speech', 'music', 'transcribe'] as const;
type Kind = (typeof KINDS)[number];

/** The waits between polls; tests shorten them. */
export const pollTiming = { pollMs: 5_000, retryMs: 5_000 };
const DEFAULT_TIMEOUT_S = 900;
/** One status poll or model card: small answers, so a minute means the host is gone. */
const QUICK_REQUEST_MS = 60_000;

/**
 * The options each kind reads, besides the globals and `--model`, `-o`,
 * `--params`, `--timeout`. Anything else would be accepted and ignored on a
 * paid call, so it is refused.
 */
const KIND_FLAGS: Readonly<Record<Kind | 'wait', readonly string[]>> = {
  image: ['set', 'image', 'n', 'estimate'],
  video: ['set', 'image', 'no-wait', 'estimate'],
  speech: ['voice'],
  music: ['lyrics', 'seconds', 'instrumental', 'estimate'],
  transcribe: ['lang', 'no-diarize'],
  wait: [],
};
const SHARED_FLAGS = ['model', 'o', 'output', 'params', 'timeout'];

interface Ctx {
  apiKey: string;
  parsed: Parsed;
  json: boolean;
  host: string;
  /** Checked before anything is sent: a bad value must not surface after a paid submit. */
  timeoutS: number;
}

interface Result {
  kind: GenKind;
  model: string;
  historyId: string;
  files: string[];
  operationId?: string;
  requestId?: string;
  credits?: number | null;
  text?: string;
}

// ---------------------------------------------------------------- helpers

const str = (v: string | true | undefined): string | undefined => (typeof v === 'string' ? v : undefined);

function requireModel(ctx: Ctx, kind: Kind): string {
  const model = str(ctx.parsed.flags.get('model'));
  if (model) return model;
  // Image, video and music prices differ a hundredfold between models; picking
  // one silently would pick the caller's bill.
  throw new CliError(`baze gen ${kind} needs --model.`, {
    hint: `Run \`baze models --type ${kind === 'music' ? 'audio' : kind}\` to see what this key can call.`,
  });
}

/** Speech and transcription have one engine each; the first row of it is the default. */
async function defaultAudioModel(ctx: Ctx, kind: 'speech' | 'transcribe'): Promise<string> {
  const asked = str(ctx.parsed.flags.get('model'));
  if (asked) return asked;
  const engine = kind === 'speech' ? 'google' : 'soniox';
  const row = byType(await fetchCatalog(ctx.apiKey), 'audio').find((r) => r.audioClient === engine);
  if (!row) {
    throw new CliError(`This key has no ${kind === 'speech' ? 'text-to-speech' : 'transcription'} model.`, {
      hint: 'Run `baze models --type audio` to check.',
    });
  }
  return row.id;
}

/** The model's declared parameters; undefined when the gateway does not publish them. */
async function paramSpecs(ctx: Ctx, model: string): Promise<ParamSpec[] | undefined> {
  try {
    const card = await gatewayFetch<{ parameters?: ParamSpec[] }>(`/models/${model}/`, {
      apiKey: ctx.apiKey,
      timeoutMs: QUICK_REQUEST_MS,
    });
    return Array.isArray(card?.parameters) ? card.parameters : undefined;
  } catch (error) {
    // An unknown model is the POST's to report, with the gateway's own list.
    if (error instanceof CliError && error.status === 404) return undefined;
    throw error;
  }
}

/** `-o` and `--output` are the same flag. */
const outputFlag = (ctx: Ctx): string | undefined =>
  str(ctx.parsed.flags.get('output')) ?? str(ctx.parsed.flags.get('o'));

/** `--estimate`: price the call the other flags describe, and make none. */
const estimating = (ctx: Ctx): boolean => ctx.parsed.flags.get('estimate') === true;

function prompt(ctx: Ctx, what: string): string {
  const text = ctx.parsed.positionals.slice(1).join(' ').trim();
  // The price never depends on the prompt, so a quote does not need one.
  if (!text && estimating(ctx)) return '';
  if (!text) throw new CliError(`No ${what} given.`, { hint: `baze gen ${ctx.parsed.positionals[0]} "<${what}>" --model ID` });
  return text;
}

/**
 * A status poll that could not be read, or a job still running at --timeout.
 * Neither says the job failed: it was accepted and paid for, so nothing may
 * record it as failed. The caller points at `baze gen wait` instead.
 */
class PollInterrupted extends CliError {}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * How long to wait before polling again after `error`, or undefined when
 * waiting cannot help. A 429 says when (Retry-After); a 5xx, a timeout or an
 * unreachable host is worth another try. A 401/403/404 is not.
 */
function retryDelayMs(error: CliError): number | undefined {
  if (error.status === 429) return (error.retryAfterS ?? pollTiming.retryMs / 1000) * 1000;
  if (error.status === undefined || error.status >= 500) return pollTiming.retryMs;
  return undefined;
}

async function pollUntilDone<T extends { status?: string }>(
  label: string,
  fetchStatus: () => Promise<T>,
  timeoutS: number,
): Promise<T> {
  const started = Date.now();
  const deadline = started + timeoutS * 1000;
  let lastNote = started;
  for (;;) {
    let status: T;
    try {
      status = await fetchStatus();
    } catch (error) {
      if (!(error instanceof CliError)) throw error;
      const waitMs = retryDelayMs(error);
      if (waitMs === undefined || Date.now() + waitMs > deadline) {
        throw new PollInterrupted(error.message, { hint: error.hint, status: error.status, requestId: error.requestId });
      }
      info(`  ${error.status === 429 ? 'rate limited' : 'no answer'}; polling again in ${Math.ceil(waitMs / 1000)}s`);
      await sleep(waitMs);
      continue;
    }
    if (status.status !== 'processing' && status.status !== 'pending' && status.status !== 'submitted') return status;
    if (Date.now() > deadline) {
      throw new PollInterrupted(`${label} is still running after ${timeoutS}s.`);
    }
    if (Date.now() - lastNote >= 15_000) {
      info(`  still ${status.status ?? 'running'} (${Math.round((Date.now() - started) / 1000)}s)`);
      lastNote = Date.now();
    }
    await sleep(pollTiming.pollMs);
  }
}

/** The job is alive and paid for: say how to pick it up, keep what the gateway said. */
function resumable(error: PollInterrupted, historyId: string): CliError {
  const resume = `The job is still running; resume with \`baze gen wait ${historyId}\`.`;
  return new CliError(error.message, {
    hint: error.hint ? `${error.hint} ${resume}` : resume,
    status: error.status,
    requestId: error.requestId,
  });
}

export function parseTimeoutS(raw: string | true | undefined): number {
  if (raw === undefined) return DEFAULT_TIMEOUT_S;
  const n = Number(raw);
  if (typeof raw !== 'string' || !Number.isFinite(n) || n <= 0) {
    throw new CliError('--timeout is in seconds and must be positive.');
  }
  return n;
}

/** Refuses an option this kind would ignore, before any request. */
export function checkKindFlags(kind: Kind | 'wait', parsed: Parsed): void {
  const own = new Set([...KIND_FLAGS[kind], ...SHARED_FLAGS]);
  const gen = new Set(Object.values(KIND_FLAGS).flat());
  for (const name of [...parsed.flags.keys(), ...parsed.lists.keys()]) {
    if (gen.has(name) && !own.has(name)) {
      const dash = name.length === 1 ? '-' : '--';
      throw new CliError(`${dash}${name} does not apply to baze gen ${kind}.`, {
        hint: 'Run `baze help gen` for what each kind takes.',
      });
    }
  }
}

const submitMs = (ctx: Ctx): number => ctx.timeoutS * 1000;

function finish(ctx: Ctx, result: Result): number {
  if (ctx.json) {
    out(JSON.stringify(
      {
        kind: result.kind,
        model: result.model,
        history_id: result.historyId,
        files: result.files,
        ...(result.operationId ? { operation_id: result.operationId } : {}),
        ...(result.text !== undefined ? { text: result.text } : {}),
        credits: result.credits ?? null,
        request_id: result.requestId ?? null,
      },
      null,
      2,
    ));
    return 0;
  }
  if (result.text !== undefined && result.files.length === 0) out(result.text);
  for (const file of result.files) out(file);
  const credits = result.credits != null ? `${formatCredits(result.credits)} credits · ` : '';
  info(c.dim(`${credits}history ${result.historyId}${result.requestId ? ` · request ${result.requestId}` : ''}`));
  return 0;
}

function recordFailure(base: HistoryEntry, error: unknown): never {
  const message = error instanceof Error ? error.message : String(error);
  recordHistory({ ...base, at: new Date().toISOString(), status: 'failed', error: message });
  throw error;
}

// ---------------------------------------------------------------- estimate

/** Where the charge lies against the quote; the server decides it. */
type EstimateBound = 'exact' | 'minimum' | 'maximum' | 'approximate';

interface EstimateLine {
  item: string;
  credits: number;
  exact: boolean;
  bound: EstimateBound;
  basis: string;
  note?: string;
}

interface EstimateReply {
  object: 'estimate';
  kind: string;
  model: string;
  credits: number;
  exact: boolean;
  bound: EstimateBound;
  lines: EstimateLine[];
}

const BOUND_WORDS: Record<EstimateBound, string> = {
  exact: '',
  minimum: 'at least ',
  maximum: 'at most ',
  approximate: 'about ',
};

/** "model: at least 8 credits". Read from `bound`, never from the note's words. */
export function estimateHeadline(reply: Pick<EstimateReply, 'model' | 'credits' | 'exact' | 'bound'>): string {
  const words = BOUND_WORDS[reply.bound] ?? (reply.exact ? '' : 'about ');
  return `${reply.model}: ${words}${formatCredits(reply.credits)} credits`;
}

/**
 * The server prices the body with the function it bills with, so the quote
 * and the charge cannot drift apart. Free: nothing is generated, reserved or
 * recorded in history.
 */
async function showEstimate(ctx: Ctx, kind: 'image' | 'video' | 'music', body: Record<string, unknown>): Promise<number> {
  // The price does not depend on the text; sending it would only cost bandwidth.
  const { prompt: _prompt, lyrics: _lyrics, ...priced } = body;
  let reply: EstimateReply;
  let requestId: string | undefined;
  try {
    ({ body: reply, requestId } = await gatewayFetchJson<EstimateReply>('/estimate/', {
      apiKey: ctx.apiKey,
      method: 'POST',
      body: { kind, ...priced },
      timeoutMs: QUICK_REQUEST_MS,
    }));
  } catch (error) {
    if (error instanceof CliError && error.status === 404 && error.message === 'Not Found') {
      throw new CliError(`${ctx.host} cannot quote prices yet.`, {
        hint: 'It runs an older Baze server; the price shows in `baze history` after the call.',
      });
    }
    throw error;
  }
  if (ctx.json) {
    out(JSON.stringify({ ...reply, request_id: requestId ?? null }, null, 2));
    return 0;
  }
  out(estimateHeadline(reply));
  if (reply.lines.length > 1) {
    for (const line of reply.lines) info(`  ${line.item}: ${formatCredits(line.credits)}`);
  }
  for (const line of reply.lines) if (line.note) info(c.dim(line.note));
  info(c.dim('Nothing was generated or charged.'));
  return 0;
}

// ---------------------------------------------------------------- image

/** What a submit says it deducted: `credits_charged` in every billing mode,
 * else the KRW-mode `billing` block (servers before `credits_charged`). */
interface ChargeReply {
  credits_charged?: number | null;
  billing?: { deducted_credit?: number } | null;
}

export function chargedCredits(reply: ChargeReply | undefined): number | null {
  const amount = reply?.credits_charged ?? reply?.billing?.deducted_credit;
  return typeof amount === 'number' && Number.isFinite(amount) ? amount : null;
}

interface ImageReply extends ChargeReply {
  operation_id?: string;
  status?: string;
  error?: string;
  data?: { url: string }[];
}

async function saveImages(urls: string[], output: string | undefined, timeoutMs: number): Promise<string[]> {
  const fetched = await Promise.all(
    urls.map(async (url) => (url.startsWith('data:') ? decodeDataUrl(url) : downloadPublic(url, fetch, timeoutMs))),
  );
  const ext = extensionFor(fetched[0]?.contentType ?? '', urls[0], 'png');
  const paths = outputPaths('image', urls.length, ext, output);
  fetched.forEach((f, i) => writeResult(paths[i]!, f.bytes));
  return paths;
}

async function genImage(ctx: Ctx): Promise<number> {
  const model = requireModel(ctx, 'image');
  const text = prompt(ctx, 'prompt');
  const specs = await paramSpecs(ctx, model);
  const params = checkParams(parseSets(ctx.parsed.lists.get('set') ?? []), specs, model);
  const count = checkCount(ctx.parsed.flags.get('n'), specs);
  const images = (ctx.parsed.lists.get('image') ?? []).map(imageInput);

  const body = {
    ...params,
    model,
    prompt: text,
    number_of_images: count,
    ...(images.length ? { input_images: images } : {}),
  };
  if (estimating(ctx)) return showEstimate(ctx, 'image', body);
  const base: HistoryEntry = {
    id: newHistoryId(), at: new Date().toISOString(), kind: 'image', model, status: 'submitted', host: ctx.host, prompt: text,
  };
  recordHistory(base);
  // What history knows so far; a failure is recorded on top of it, so a job
  // that was accepted keeps its operation id and charge.
  let current = base;
  try {
    const { body: reply, requestId } = await gatewayFetchJson<ImageReply>('/images/generate/', {
      apiKey: ctx.apiKey, method: 'POST', body, timeoutMs: submitMs(ctx),
    });
    // Charged at submit; a poll never charges again.
    const credits = chargedCredits(reply);
    let final = reply;
    if (reply.operation_id && !reply.data) {
      current = { ...base, at: new Date().toISOString(), status: 'processing', operationId: reply.operation_id, credits, requestId };
      recordHistory(current);
      info(`Submitted; waiting (history ${base.id}).`);
      final = await pollImage(ctx, model, reply.operation_id);
    }
    if (!final.data?.length) throw new CliError(final.error ?? 'The gateway returned no image.');
    const files = await saveImages(final.data.map((d) => d.url), outputFlag(ctx), submitMs(ctx));
    recordHistory({ ...base, at: new Date().toISOString(), status: 'completed', files, credits, requestId, operationId: reply.operation_id });
    return finish(ctx, { kind: 'image', model, historyId: base.id, files, credits, requestId, operationId: reply.operation_id });
  } catch (error) {
    if (error instanceof PollInterrupted) throw resumable(error, base.id);
    recordFailure(current, error);
  }
}

async function pollImage(ctx: Ctx, model: string, operationId: string): Promise<ImageReply> {
  const reply = await pollUntilDone(
    'The image',
    async () => {
      const r = await gatewayFetch<ImageReply>(`/images/generate/${operationId}/?model=${encodeURIComponent(model)}`, {
        apiKey: ctx.apiKey,
        timeoutMs: QUICK_REQUEST_MS,
      });
      // A completed image poll answers in the generate shape, with no status.
      return r.data ? { ...r, status: 'completed' } : r;
    },
    ctx.timeoutS,
  );
  if (reply.status === 'failed') throw new CliError(`The image failed: ${reply.error ?? 'no reason given'}.`);
  return reply;
}

// ---------------------------------------------------------------- video

interface VideoStatus {
  operation_id?: string;
  status?: string;
  video_uri?: string | null;
  error?: string;
}

async function downloadVideo(ctx: Ctx, uri: string, output: string | undefined): Promise<string> {
  const got = uri.startsWith('/v1/')
    ? await gatewayFetchBytes(uri, { apiKey: ctx.apiKey, timeoutMs: submitMs(ctx) })
    : await downloadPublic(uri, fetch, submitMs(ctx));
  const [path] = outputPaths('video', 1, extensionFor(got.contentType, uri, 'mp4'), output);
  writeResult(path!, got.bytes);
  return path!;
}

async function waitVideo(ctx: Ctx, base: HistoryEntry, operationId: string, requestId?: string): Promise<number> {
  // The server refunds a job that failed with nothing delivered, so history
  // must not keep its charge; a failed download keeps it.
  let refunded = false;
  try {
    const status = await pollUntilDone(
      'The video',
      () =>
        gatewayFetch<VideoStatus>(`/video/generation/${operationId}/?model=${encodeURIComponent(base.model)}`, {
          apiKey: ctx.apiKey,
          timeoutMs: QUICK_REQUEST_MS,
        }),
      ctx.timeoutS,
    );
    if (status.status !== 'completed' || !status.video_uri) {
      refunded = true;
      throw new CliError(`The video failed: ${status.error ?? status.status ?? 'no reason given'}.`, {
        hint: 'A job that fails after it was accepted is refunded automatically.',
      });
    }
    const file = await downloadVideo(ctx, status.video_uri, outputFlag(ctx));
    const credits = base.credits ?? null;
    recordHistory({ ...base, at: new Date().toISOString(), status: 'completed', files: [file], operationId, credits, requestId });
    return finish(ctx, { kind: 'video', model: base.model, historyId: base.id, files: [file], operationId, credits, requestId });
  } catch (error) {
    if (error instanceof PollInterrupted) throw resumable(error, base.id);
    recordFailure(refunded ? { ...base, credits: null } : base, error);
  }
}

async function genVideo(ctx: Ctx): Promise<number> {
  const model = requireModel(ctx, 'video');
  const text = prompt(ctx, 'prompt');
  const specs = await paramSpecs(ctx, model);
  const parameters = checkParams(parseSets(ctx.parsed.lists.get('set') ?? []), specs, model);
  const images = (ctx.parsed.lists.get('image') ?? []).map(imageInput);
  const body = { model, prompt: text, parameters, ...(images.length ? { input_urls: images } : {}) };
  if (estimating(ctx)) return showEstimate(ctx, 'video', body);

  const base: HistoryEntry = {
    id: newHistoryId(), at: new Date().toISOString(), kind: 'video', model, status: 'submitted', host: ctx.host, prompt: text,
  };
  recordHistory(base);
  let submitted: { operation_id?: string } & ChargeReply;
  let requestId: string | undefined;
  try {
    ({ body: submitted, requestId } = await gatewayFetchJson<{ operation_id?: string } & ChargeReply>('/video/generation/', {
      apiKey: ctx.apiKey,
      method: 'POST',
      body,
      timeoutMs: submitMs(ctx),
    }));
  } catch (error) {
    recordFailure(base, error);
  }
  const operationId = submitted.operation_id;
  if (!operationId) recordFailure(base, new CliError('The gateway accepted the video but returned no operation id.'));
  // Video is charged at submit.
  const credits = chargedCredits(submitted);
  const running: HistoryEntry = { ...base, at: new Date().toISOString(), status: 'processing', operationId, credits, requestId };
  recordHistory(running);

  if (ctx.parsed.flags.get('no-wait')) {
    if (ctx.json) {
      out(JSON.stringify({ kind: 'video', model, history_id: base.id, operation_id: operationId, status: 'processing', credits, request_id: requestId ?? null }, null, 2));
    } else {
      out(base.id);
      info(`Submitted. Collect it with \`baze gen wait ${base.id}\`.`);
    }
    return 0;
  }
  info(`Submitted (history ${base.id}); a video takes one to several minutes. Ctrl-C is safe: \`baze gen wait ${base.id}\` resumes.`);
  return waitVideo(ctx, running, operationId, requestId);
}

// ---------------------------------------------------------------- audio

async function genSpeech(ctx: Ctx): Promise<number> {
  const model = await defaultAudioModel(ctx, 'speech');
  const input = prompt(ctx, 'text');
  const voice = str(ctx.parsed.flags.get('voice'));
  const base: HistoryEntry = {
    id: newHistoryId(), at: new Date().toISOString(), kind: 'speech', model, status: 'submitted', host: ctx.host, prompt: input,
  };
  recordHistory(base);
  try {
    const got = await gatewayFetchBytes('/audio/speech/', {
      apiKey: ctx.apiKey, method: 'POST', body: { model, input, ...(voice ? { voice } : {}) }, timeoutMs: submitMs(ctx),
    });
    const pcm = got.contentType.startsWith('audio/pcm');
    const bytes = pcm ? pcmToWav(got.bytes) : got.bytes;
    const [path] = outputPaths('speech', 1, pcm ? 'wav' : extensionFor(got.contentType, undefined, 'wav'), outputFlag(ctx));
    writeResult(path!, bytes);
    recordHistory({ ...base, at: new Date().toISOString(), status: 'completed', files: [path!], requestId: got.requestId });
    return finish(ctx, { kind: 'speech', model, historyId: base.id, files: [path!], requestId: got.requestId });
  } catch (error) {
    recordFailure(base, error);
  }
}

async function genMusic(ctx: Ctx): Promise<number> {
  const model = requireModel(ctx, 'music');
  const text = prompt(ctx, 'prompt');
  const lyrics = str(ctx.parsed.flags.get('lyrics'));
  const seconds = str(ctx.parsed.flags.get('seconds'));
  if (seconds !== undefined && !(Number(seconds) > 0)) throw new CliError('--seconds must be a positive number.');
  const body = {
    model,
    prompt: text,
    ...(lyrics ? { lyrics } : {}),
    ...(seconds !== undefined ? { duration_seconds: Number(seconds) } : {}),
    ...(ctx.parsed.flags.get('instrumental') ? { instrumental: true } : {}),
  };
  if (estimating(ctx)) return showEstimate(ctx, 'music', body);
  const base: HistoryEntry = {
    id: newHistoryId(), at: new Date().toISOString(), kind: 'music', model, status: 'submitted', host: ctx.host, prompt: text,
  };
  recordHistory(base);
  try {
    const got = await gatewayFetchBytes('/audio/music/', {
      apiKey: ctx.apiKey, method: 'POST', body, timeoutMs: submitMs(ctx),
    });
    const [path] = outputPaths('music', 1, extensionFor(got.contentType, undefined, 'mp3'), outputFlag(ctx));
    writeResult(path!, got.bytes);
    const charged = got.headers.get('x-credits-charged');
    const credits = charged !== null && charged !== '' && Number.isFinite(Number(charged)) ? Number(charged) : null;
    recordHistory({ ...base, at: new Date().toISOString(), status: 'completed', files: [path!], credits, requestId: got.requestId });
    return finish(ctx, { kind: 'music', model, historyId: base.id, files: [path!], credits, requestId: got.requestId });
  } catch (error) {
    recordFailure(base, error);
  }
}

interface SttStatus {
  operation_id?: string;
  status?: string;
  text?: string;
  error?: string;
  credits_charged?: number;
  segments?: unknown[];
}

async function waitTranscript(ctx: Ctx, base: HistoryEntry, operationId: string, credits: number | null, requestId?: string): Promise<number> {
  try {
    const status = await pollUntilDone(
      'The transcription',
      () => gatewayFetch<SttStatus>(`/audio/transcriptions/${operationId}/`, { apiKey: ctx.apiKey, timeoutMs: QUICK_REQUEST_MS }),
      ctx.timeoutS,
    );
    if (status.status !== 'completed') throw new CliError(`The transcription failed: ${status.error ?? status.status ?? 'no reason given'}.`);
    const output = outputFlag(ctx);
    const files: string[] = [];
    if (output) {
      const [path] = outputPaths('transcribe', 1, 'txt', output);
      writeResult(path!, Buffer.from(`${status.text ?? ''}\n`, 'utf8'));
      files.push(path!);
    }
    recordHistory({ ...base, at: new Date().toISOString(), status: 'completed', files, operationId, credits, requestId });
    if (ctx.json) {
      out(JSON.stringify({ kind: 'transcribe', model: base.model, history_id: base.id, operation_id: operationId, files, text: status.text ?? '', segments: status.segments ?? [], credits, request_id: requestId ?? null }, null, 2));
      return 0;
    }
    return finish(ctx, { kind: 'transcribe', model: base.model, historyId: base.id, files, operationId, credits, requestId, text: status.text ?? '' });
  } catch (error) {
    if (error instanceof PollInterrupted) throw resumable(error, base.id);
    recordFailure(base, error);
  }
}

async function genTranscribe(ctx: Ctx): Promise<number> {
  const file = ctx.parsed.positionals[1];
  if (!file) throw new CliError('No audio file given.', { hint: 'baze gen transcribe <file> [--lang ko,en]' });
  if (!existsSync(file)) throw new CliError(`No such file: ${file}.`);
  const model = await defaultAudioModel(ctx, 'transcribe');
  const form = new FormData();
  form.append('file', new Blob([readFileSync(file)]), basename(file));
  form.append('model', model);
  for (const hint of (str(ctx.parsed.flags.get('lang')) ?? '').split(',').map((h) => h.trim()).filter(Boolean)) {
    form.append('language_hints', hint);
  }
  if (ctx.parsed.flags.get('no-diarize')) form.append('enable_speaker_diarization', 'false');

  const base: HistoryEntry = {
    id: newHistoryId(), at: new Date().toISOString(), kind: 'transcribe', model, status: 'submitted', host: ctx.host, prompt: basename(file),
  };
  recordHistory(base);
  let started: SttStatus;
  let requestId: string | undefined;
  try {
    ({ body: started, requestId } = await gatewayFetchJson<SttStatus>('/audio/transcriptions/', {
      apiKey: ctx.apiKey, method: 'POST', form, timeoutMs: submitMs(ctx),
    }));
  } catch (error) {
    recordFailure(base, error);
  }
  const operationId = started.operation_id;
  if (!operationId) recordFailure(base, new CliError('The gateway accepted the file but returned no operation id.'));
  const credits = typeof started.credits_charged === 'number' ? started.credits_charged : null;
  const running: HistoryEntry = { ...base, at: new Date().toISOString(), status: 'processing', operationId, credits, requestId };
  recordHistory(running);
  info(`Transcribing (history ${base.id}).`);
  return waitTranscript(ctx, running, operationId, credits, requestId);
}

// ---------------------------------------------------------------- wait

async function genWait(ctx: Ctx): Promise<number> {
  const ref = ctx.parsed.positionals[1];
  if (!ref) throw new CliError('Which job?', { hint: 'baze gen wait <history id>  (see `baze history`)' });
  const entry = findHistory(ref);
  if (!entry?.operationId) {
    throw new CliError(`No resumable job "${ref}" in this machine's history.`, { hint: 'Run `baze history` to list them.' });
  }
  if (entry.status === 'completed') {
    info(`Already collected (${entry.at}).`);
    return finish(ctx, {
      kind: entry.kind, model: entry.model, historyId: entry.id, files: entry.files ?? [],
      operationId: entry.operationId, credits: entry.credits, requestId: entry.requestId,
    });
  }
  if (entry.kind === 'video') return waitVideo(ctx, entry, entry.operationId, entry.requestId);
  if (entry.kind === 'transcribe') return waitTranscript(ctx, entry, entry.operationId, entry.credits ?? null, entry.requestId);
  if (entry.kind === 'image') {
    try {
      const final = await pollImage(ctx, entry.model, entry.operationId);
      const files = await saveImages((final.data ?? []).map((d) => d.url), outputFlag(ctx), submitMs(ctx));
      recordHistory({ ...entry, at: new Date().toISOString(), status: 'completed', files });
      return finish(ctx, { kind: 'image', model: entry.model, historyId: entry.id, files, operationId: entry.operationId, credits: entry.credits, requestId: entry.requestId });
    } catch (error) {
      if (error instanceof PollInterrupted) throw resumable(error, entry.id);
      recordFailure(entry, error);
    }
  }
  throw new CliError(`A ${entry.kind} job has nothing to wait for.`);
}

// ---------------------------------------------------------------- entry

export async function genCommand(parsed: Parsed): Promise<number> {
  const kind = parsed.positionals[0];
  const context = (): Ctx => ({
    apiKey: requireApiKey(),
    parsed,
    json: parsed.flags.get('json') === true,
    host: apiBase(),
    timeoutS: parseTimeoutS(parsed.flags.get('timeout')),
  });
  if (kind === 'wait') {
    checkKindFlags('wait', parsed);
    return genWait(context());
  }
  if (!KINDS.includes(kind as Kind)) {
    throw new CliError(kind ? `Unknown kind "${kind}".` : 'What should baze generate?', {
      hint: `baze gen ${KINDS.join('|')} ...   or   baze gen wait <id>`,
    });
  }
  checkKindFlags(kind as Kind, parsed);
  const ctx = context();

  if (parsed.flags.get('params')) {
    const model = requireModel(ctx, kind as Kind);
    const specs = await paramSpecs(ctx, model);
    if (ctx.json) {
      out(JSON.stringify(specs ?? null, null, 2));
      return 0;
    }
    if (!specs) {
      say(`The gateway does not publish parameters for ${model}.`);
      return 0;
    }
    say(specs.length ? `${model} takes:` : `${model} takes no parameters.`);
    for (const line of describeParams(specs)) out(line);
    return 0;
  }

  switch (kind as Kind) {
    case 'image':
      return genImage(ctx);
    case 'video':
      return genVideo(ctx);
    case 'speech':
      return genSpeech(ctx);
    case 'music':
      return genMusic(ctx);
    case 'transcribe':
      return genTranscribe(ctx);
  }
}

