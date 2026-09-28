import type { Parsed } from '../args.js';
import { fetchCatalog } from '../api.js';
import { byType } from '../catalog.js';
import { resolveCredential } from '../config.js';
import type { ModelRow, ModelType } from '../types.js';
import { c, CliError, info, out, say } from '../ui.js';

const LANE_LABEL = {
  anthropic: 'Claude native',
  responses: 'Responses',
  gemini: 'Gemini native',
  compat: 'OpenAI-compat',
} as const;

/** Every type `/v1/gateway/models/` can send, in the order it sends them. */
export const KNOWN_TYPES: readonly ModelType[] = [
  'llm',
  'audio',
  'image',
  'video',
  'embedding',
  'rerank',
  'decisions',
  'realtime',
];

/** What an audio row is for; `audio_client` is the only field that tells them apart. */
const AUDIO_USE: Record<string, string> = {
  google: 'speech',
  google_lyria3: 'music',
  elevenlabs: 'music',
  soniox: 'transcribe',
};

/** The command that runs each type, for the footer. */
const HOW_TO_RUN: Record<Exclude<ModelType, 'llm'>, string> = {
  audio: 'Run them with `baze gen speech`, `baze gen music` or `baze gen transcribe`.',
  image: 'Run them with `baze gen image`; add --estimate to price a call first.',
  video: 'Run them with `baze gen video`; add --estimate to price a call first.',
  embedding: 'Run them with `baze embed`.',
  rerank: 'Run them with `baze rerank`.',
  decisions: 'baze has no command for these yet; call POST /v1/gateway/decisions/.',
  // Live voice is a WebSocket session with a microphone on the other end;
  // baze has no command for it (a native audio module would break the
  // zero-dependency rule), so the row is listed and nothing more.
  realtime: 'Realtime models are WebSocket voice sessions; no baze command runs them.',
};

/** Two decimals, or as many as the price has up to four: jev-latest's $0.042 is not $0.04. */
export const usd = (n: number | null | undefined): string => {
  if (n == null) return '-';
  const two = n.toFixed(2);
  return Number(two) === n ? two : n.toFixed(4).replace(/0+$/, '');
};
const contextK = (n: number | null): string => (n ? `${Math.round(n / 1000)}k` : '-');

interface Layout {
  header: string[];
  cells: (r: ModelRow) => string[];
  /** Columns aligned right (numbers). */
  right: number[];
}

/**
 * The columns that mean something for a type. Media rows carry no token price
 * and no lane - a row of dashes told the reader nothing (dev QA, 2026-09-28) -
 * and their price depends on the call's settings, which is what --estimate is for.
 */
function layoutFor(type: ModelType): Layout {
  switch (type) {
    case 'llm':
      return {
        header: ['model', 'lane', 'context', '$/1M in', '$/1M out'],
        cells: (r) => [r.id, LANE_LABEL[r.lane], contextK(r.contextLimit), usd(r.pricing?.inputPer1mUsd), usd(r.pricing?.outputPer1mUsd)],
        right: [2, 3, 4],
      };
    case 'embedding':
    case 'rerank':
    case 'decisions':
      return {
        header: ['model', 'context', '$/1M in'],
        cells: (r) => [r.id, contextK(r.contextLimit), usd(r.pricing?.inputPer1mUsd)],
        right: [1, 2],
      };
    case 'audio':
      return {
        header: ['model', 'use'],
        cells: (r) => [r.id, AUDIO_USE[r.audioClient ?? ''] ?? '-'],
        right: [],
      };
    default:
      return { header: ['model'], cells: (r) => [r.id], right: [] };
  }
}

function renderTable(layout: Layout, rows: ModelRow[]): string[] {
  const body = rows.map(layout.cells);
  const widths = layout.header.map((h, i) => Math.max(h.length, ...body.map((cells) => cells[i]!.length)));
  const line = (cells: string[]) =>
    cells
      .map((cell, i) => (layout.right.includes(i) ? cell.padStart(widths[i]!) : cell.padEnd(widths[i]!)))
      .join('  ')
      .trimEnd();
  return [line(layout.header), ...body.map(line)];
}

export function requireApiKey(): string {
  const cred = resolveCredential();
  if (!cred.apiKey) {
    throw new CliError('No API key.', { hint: 'Run `baze login`, or set BAZE_API_KEY.' });
  }
  return cred.apiKey;
}

export async function modelsCommand(parsed: Parsed): Promise<number> {
  const apiKey = requireApiKey();
  const asked = parsed.flags.get('type');
  const type = typeof asked === 'string' ? asked : 'llm';
  // "No such type" and "no models of that type" are different answers, and a
  // typo must not read as an empty catalog.
  if (!KNOWN_TYPES.includes(type as ModelType)) {
    throw new CliError(`Unknown --type ${type}.`, { hint: `Try one of: ${KNOWN_TYPES.join(', ')}.` });
  }
  const query = parsed.positionals[0]?.toLowerCase();
  const rows = byType(await fetchCatalog(apiKey), type as ModelType).filter(
    (r) => !query || r.id.toLowerCase().includes(query),
  );

  if (parsed.flags.get('json')) {
    out(JSON.stringify(rows, null, 2));
    return 0;
  }

  if (rows.length === 0) {
    say(query ? `No ${type} model matches "${query}".` : `This key has no ${type} models.`);
    return 0;
  }

  const [header, ...lines] = renderTable(layoutFor(type as ModelType), rows);
  say(c.dim(header!));
  for (const line of lines) out(line);
  info('');
  if (type === 'llm') {
    info('Prices are provider list USD per 1M tokens.');
    info('Claude Code runs Claude-native models only; Codex runs Responses models; OpenCode runs all four lanes.');
  } else {
    if (type === 'embedding' || type === 'rerank' || type === 'decisions') info('Prices are provider list USD per 1M input tokens.');
    info(HOW_TO_RUN[type as Exclude<ModelType, 'llm'>]);
  }
  return 0;
}
