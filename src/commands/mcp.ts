import type { Parsed } from '../args.js';
import { gatewayFetch, gatewayFetchRaw } from '../api.js';
import { readStdin } from '../input.js';
import { c, CliError, fit, info, out, say, termWidth } from '../ui.js';
import { requireApiKey } from './models.js';

export const PROTOCOL_VERSION = '2025-06-18';

export interface Suite {
  slug: string;
  name: string;
  display_name: string;
  description: string;
  url: string;
  transport: string;
}

export interface RpcResponse {
  jsonrpc: '2.0';
  id?: number | string | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

interface Tool {
  name: string;
  description?: string;
  inputSchema?: {
    properties?: Record<string, { type?: string; description?: string }>;
    required?: string[];
  };
}

interface CallResult {
  content?: Array<{ type: string; text?: string }>;
  isError?: boolean;
}

/**
 * The upstream is streamable-HTTP and answers a plain JSON-RPC POST as
 * `text/event-stream` regardless of Accept, so the reply is `data:` lines; the
 * last one that is a response (has `result` or `error`) is ours. Plain JSON is
 * accepted too. Structure only: the two JSON-RPC keys, never the text.
 */
export function parseRpcResponse(contentType: string, text: string): RpcResponse {
  const bodies = contentType.includes('text/event-stream')
    ? text
        .split(/\r?\n/)
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trim())
    : [text.trim()];
  let last: RpcResponse | undefined;
  for (const body of bodies) {
    if (!body) continue;
    let value: unknown;
    try {
      value = JSON.parse(body);
    } catch {
      continue; // a keep-alive comment or a partial line
    }
    if (value && typeof value === 'object' && ('result' in value || 'error' in value)) {
      last = value as RpcResponse;
    }
  }
  if (!last) {
    throw new CliError('The suite answered without a JSON-RPC response.', {
      hint: 'Try again; if it repeats, the suite is failing upstream of the gateway.',
    });
  }
  return last;
}

/** Tool arguments: the fourth positional as JSON, or stdin when piped. Must be an object. */
export async function readArguments(parsed: Parsed): Promise<Record<string, unknown>> {
  const positional = parsed.positionals[3];
  const text = positional ?? (process.stdin.isTTY ? '' : await readStdin());
  if (text.trim() === '') return {};
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new CliError('Tool arguments must be a JSON object.', {
      hint: `Example: baze mcp call dart search_company '{"query": "삼성전자"}'`,
    });
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new CliError('Tool arguments must be a JSON object, not a list or a scalar.');
  }
  return value as Record<string, unknown>;
}

let nextId = 1;

/** A tool call runs the connector (a search, a document fetch) and can take minutes. */
const TOOL_CALL_TIMEOUT_MS = 600_000;

async function rpc(apiKey: string, suite: string, method: string, params?: unknown): Promise<RpcResponse> {
  const reply = await gatewayFetchRaw(`/mcp/${encodeURIComponent(suite)}/`, {
    apiKey,
    method: 'POST',
    ...(method === 'tools/call' ? { timeoutMs: TOOL_CALL_TIMEOUT_MS } : {}),
    body: { jsonrpc: '2.0', id: nextId++, method, ...(params === undefined ? {} : { params }) },
    headers: { accept: 'application/json, text/event-stream', 'mcp-protocol-version': PROTOCOL_VERSION },
  });
  const response = parseRpcResponse(reply.contentType, reply.text);
  if (response.error) {
    throw new CliError(`${suite}: ${response.error.message}`, {
      hint: `JSON-RPC error ${response.error.code} from the suite itself, not from the gateway.`,
    });
  }
  return response;
}

async function initialize(apiKey: string, suite: string): Promise<void> {
  // Free, and the upstream is stateless, so this is protocol form rather than
  // a session: a suite that rejects initialize would reject everything after it.
  await rpc(apiKey, suite, 'initialize', {
    protocolVersion: PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: { name: 'baze', version: 'cli' },
  });
}

function firstLine(s: string | undefined): string {
  return (s ?? '').split('\n')[0] ?? '';
}

export async function mcpCommand(parsed: Parsed): Promise<number> {
  const apiKey = requireApiKey();
  const [sub = 'list', suite, tool] = parsed.positionals;
  const json = parsed.flags.get('json') === true;

  if (sub === 'list') {
    const res = await gatewayFetch<{ data: Suite[] }>('/mcp/', { apiKey });
    if (json) {
      out(JSON.stringify(res.data, null, 2));
      return 0;
    }
    if (res.data.length === 0) {
      say('No MCP suites are available to this key.');
      return 0;
    }
    const width = Math.max(...res.data.map((s) => s.slug.length));
    say(c.dim(`${'suite'.padEnd(width)}  description`));
    // One line per suite, cut to the terminal: a description ran past 150 characters.
    for (const s of res.data) out(`${s.slug.padEnd(width)}  ${fit(firstLine(s.description) || s.display_name, termWidth() - width - 2)}`);
    info('');
    info(`${res.data.length} suites. Tools of one: baze mcp tools <suite>. Listing is free; each tools/call is billed.`);
    return 0;
  }

  if (!suite) {
    throw new CliError(`baze mcp ${sub} needs a suite.`, { hint: 'Run `baze mcp` for the list.' });
  }

  if (sub === 'tools') {
    await initialize(apiKey, suite);
    const reply = await rpc(apiKey, suite, 'tools/list');
    const tools = (reply.result as { tools?: Tool[] } | undefined)?.tools ?? [];
    if (json) {
      out(JSON.stringify(tools, null, 2));
      return 0;
    }
    for (const t of tools) {
      out(t.name);
      if (t.description) say(`  ${fit(firstLine(t.description), termWidth() - 2)}`);
      const required = new Set(t.inputSchema?.required ?? []);
      for (const [name, schema] of Object.entries(t.inputSchema?.properties ?? {})) {
        const desc = schema.description ? ` - ${firstLine(schema.description)}` : '';
        say(c.dim(fit(`    ${name}${required.has(name) ? '' : '?'}: ${schema.type ?? 'any'}${desc}`, termWidth())));
      }
    }
    info('');
    info(`${tools.length} tools. Call one: baze mcp call ${suite} <tool> '{"arg": "value"}'`);
    return 0;
  }

  if (sub === 'call') {
    if (!tool) {
      throw new CliError('baze mcp call needs a suite and a tool.', { hint: `Run \`baze mcp tools ${suite}\`.` });
    }
    const args = await readArguments(parsed);
    await initialize(apiKey, suite);
    const reply = await rpc(apiKey, suite, 'tools/call', { name: tool, arguments: args });
    const result = reply.result as CallResult | undefined;
    if (json) {
      out(JSON.stringify(reply.result, null, 2));
    } else {
      for (const part of result?.content ?? []) {
        if (part.type === 'text' && typeof part.text === 'string') out(part.text);
        else say(c.dim(`[${part.type} content omitted - use --json]`));
      }
    }
    info('');
    // A tool that reports isError still answered 200, so the call was billed.
    info('Billed as one tool call; it shows in `baze usage`.');
    return result?.isError ? 1 : 0;
  }

  throw new CliError(`Unknown subcommand: mcp ${sub}`, {
    hint: 'One of: baze mcp | baze mcp tools <suite> | baze mcp call <suite> <tool> [json].',
  });
}
