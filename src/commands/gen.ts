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

const POLL_MS = 5_000;
const DEFAULT_TIMEOUT_S = 900;

interface Ctx {
  apiKey: string;
  parsed: Parsed;
  json: boolean;
  host: string;
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
    const card = await gatewayFetch<{ parameters?: ParamSpec[] }>(`/models/${model}/`, { apiKey: ctx.apiKey });
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

function prompt(ctx: Ctx, what: string): string {
  const text = ctx.parsed.positionals.slice(1).join(' ').trim();
  if (!text) throw new CliError(`No ${what} given.`, { hint: `baze gen ${ctx.parsed.positionals[0]} "<${what}>" --model ID` });
  return text;
}

async function pollUntilDone<T extends { status?: string }>(
  label: string,
  fetchStatus: () => Promise<T>,
  timeoutS: number,
): Promise<T> {
  const started = Date.now();
  let lastNote = started;
  for (;;) {
    const status = await fetchStatus();
    if (status.status !== 'processing' && status.status !== 'pending' && status.status !== 'submitted') return status;
    if (Date.now() - started > timeoutS * 1000) {
      throw new CliError(`${label} is still running after ${timeoutS}s.`, { exitCode: 1 });
    }
    if (Date.now() - lastNote >= 15_000) {
      info(`  still ${status.status ?? 'running'} (${Math.round((Date.now() - started) / 1000)}s)`);
      lastNote = Date.now();
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

function timeoutS(ctx: Ctx): number {
  const raw = str(ctx.parsed.flags.get('timeout'));
  if (raw === undefined) return DEFAULT_TIMEOUT_S;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) throw new CliError('--timeout is in seconds and must be positive.');
  return n;
}

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

// ---------------------------------------------------------------- image

interface ImageReply {
  operation_id?: string;
  status?: string;
  error?: string;
  data?: { url: string }[];
}

async function saveImages(urls: string[], output: string | undefined): Promise<string[]> {
  const fetched = await Promise.all(
    urls.map(async (url) => (url.startsWith('data:') ? decodeDataUrl(url) : downloadPublic(url))),
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
  const base: HistoryEntry = {
    id: newHistoryId(), at: new Date().toISOString(), kind: 'image', model, status: 'submitted', host: ctx.host, prompt: text,
  };
  recordHistory(base);
  try {
    const { body: reply, requestId } = await gatewayFetchJson<ImageReply>('/images/generate/', {
      apiKey: ctx.apiKey, method: 'POST', body,
    });
    let final = reply;
    if (reply.operation_id && !reply.data) {
      recordHistory({ ...base, at: new Date().toISOString(), status: 'processing', operationId: reply.operation_id, requestId });
      info(`Submitted; waiting (history ${base.id}).`);
      final = await pollImage(ctx, model, reply.operation_id);
    }
    if (!final.data?.length) throw new CliError(final.error ?? 'The gateway returned no image.');
    const files = await saveImages(final.data.map((d) => d.url), outputFlag(ctx));
    recordHistory({ ...base, at: new Date().toISOString(), status: 'completed', files, requestId, operationId: reply.operation_id });
    return finish(ctx, { kind: 'image', model, historyId: base.id, files, requestId, operationId: reply.operation_id });
  } catch (error) {
    recordFailure(base, error);
  }
}

async function pollImage(ctx: Ctx, model: string, operationId: string): Promise<ImageReply> {
  const reply = await pollUntilDone(
    'The image',
    async () => {
      const r = await gatewayFetch<ImageReply>(`/images/generate/${operationId}/?model=${encodeURIComponent(model)}`, {
        apiKey: ctx.apiKey,
      });
      // A completed image poll answers in the generate shape, with no status.
      return r.data ? { ...r, status: 'completed' } : r;
    },
    timeoutS(ctx),
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
    ? await gatewayFetchBytes(uri, { apiKey: ctx.apiKey })
    : await downloadPublic(uri);
  const [path] = outputPaths('video', 1, extensionFor(got.contentType, uri, 'mp4'), output);
  writeResult(path!, got.bytes);
  return path!;
}

async function waitVideo(ctx: Ctx, base: HistoryEntry, operationId: string, requestId?: string): Promise<number> {
  try {
    const status = await pollUntilDone(
      'The video',
      () =>
        gatewayFetch<VideoStatus>(`/video/generation/${operationId}/?model=${encodeURIComponent(base.model)}`, {
          apiKey: ctx.apiKey,
        }),
      timeoutS(ctx),
    );
    if (status.status !== 'completed' || !status.video_uri) {
      throw new CliError(`The video failed: ${status.error ?? status.status ?? 'no reason given'}.`, {
        hint: 'A job that fails after it was accepted is refunded automatically.',
      });
    }
    const file = await downloadVideo(ctx, status.video_uri, outputFlag(ctx));
    recordHistory({ ...base, at: new Date().toISOString(), status: 'completed', files: [file], operationId, requestId });
    return finish(ctx, { kind: 'video', model: base.model, historyId: base.id, files: [file], operationId, requestId });
  } catch (error) {
    if (error instanceof CliError && /still running/.test(error.message)) {
      // Not a failure: the job is alive and already paid for.
      throw new CliError(error.message, { hint: `Resume with \`baze gen wait ${base.id}\`.` });
    }
    recordFailure(base, error);
  }
}

async function genVideo(ctx: Ctx): Promise<number> {
  const model = requireModel(ctx, 'video');
  const text = prompt(ctx, 'prompt');
  const specs = await paramSpecs(ctx, model);
  const parameters = checkParams(parseSets(ctx.parsed.lists.get('set') ?? []), specs, model);
  const images = (ctx.parsed.lists.get('image') ?? []).map(imageInput);

  const base: HistoryEntry = {
    id: newHistoryId(), at: new Date().toISOString(), kind: 'video', model, status: 'submitted', host: ctx.host, prompt: text,
  };
  recordHistory(base);
  let submitted: { operation_id?: string };
  let requestId: string | undefined;
  try {
    ({ body: submitted, requestId } = await gatewayFetchJson<{ operation_id?: string }>('/video/generation/', {
      apiKey: ctx.apiKey,
      method: 'POST',
      body: { model, prompt: text, parameters, ...(images.length ? { input_urls: images } : {}) },
    }));
  } catch (error) {
    recordFailure(base, error);
  }
  const operationId = submitted.operation_id;
  if (!operationId) recordFailure(base, new CliError('The gateway accepted the video but returned no operation id.'));
  const running: HistoryEntry = { ...base, at: new Date().toISOString(), status: 'processing', operationId, requestId };
  recordHistory(running);

  if (ctx.parsed.flags.get('no-wait')) {
    if (ctx.json) {
      out(JSON.stringify({ kind: 'video', model, history_id: base.id, operation_id: operationId, status: 'processing', request_id: requestId ?? null }, null, 2));
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
      apiKey: ctx.apiKey, method: 'POST', body: { model, input, ...(voice ? { voice } : {}) },
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
  const base: HistoryEntry = {
    id: newHistoryId(), at: new Date().toISOString(), kind: 'music', model, status: 'submitted', host: ctx.host, prompt: text,
  };
  recordHistory(base);
  try {
    const got = await gatewayFetchBytes('/audio/music/', { apiKey: ctx.apiKey, method: 'POST', body });
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
      () => gatewayFetch<SttStatus>(`/audio/transcriptions/${operationId}/`, { apiKey: ctx.apiKey }),
      timeoutS(ctx),
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
    if (error instanceof CliError && /still running/.test(error.message)) {
      throw new CliError(error.message, { hint: `Resume with \`baze gen wait ${base.id}\`.` });
    }
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
    ({ body: started, requestId } = await gatewayFetchJson<SttStatus>('/audio/transcriptions/', { apiKey: ctx.apiKey, method: 'POST', form }));
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
      const files = await saveImages((final.data ?? []).map((d) => d.url), outputFlag(ctx));
      recordHistory({ ...entry, at: new Date().toISOString(), status: 'completed', files });
      return finish(ctx, { kind: 'image', model: entry.model, historyId: entry.id, files, operationId: entry.operationId });
    } catch (error) {
      recordFailure(entry, error);
    }
  }
  throw new CliError(`A ${entry.kind} job has nothing to wait for.`);
}

// ---------------------------------------------------------------- entry

export async function genCommand(parsed: Parsed): Promise<number> {
  const kind = parsed.positionals[0];
  if (kind === 'wait') {
    return genWait({ apiKey: requireApiKey(), parsed, json: parsed.flags.get('json') === true, host: apiBase() });
  }
  if (!KINDS.includes(kind as Kind)) {
    throw new CliError(kind ? `Unknown kind "${kind}".` : 'What should baze generate?', {
      hint: `baze gen ${KINDS.join('|')} ...   or   baze gen wait <id>`,
    });
  }
  const ctx: Ctx = { apiKey: requireApiKey(), parsed, json: parsed.flags.get('json') === true, host: apiBase() };

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

