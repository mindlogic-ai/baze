import { createInterface } from 'node:readline/promises';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Parsed } from '../args.js';
import { downloadPublic, gatewayFetchBytes, gatewayFetchJson } from '../api.js';
import { apiBase, configDir } from '../config.js';
import { newHistoryId, recordHistory } from '../history.js';
import { readStdin } from '../input.js';
import { writeResult } from '../media.js';
import { c, CliError, formatCredits, info, out, say } from '../ui.js';
import { requireApiKey } from './models.js';

export interface Message {
  role: 'user' | 'assistant';
  content: string;
}

interface BotFile {
  file_id: number;
  filename: string;
  mime_type: string;
  url: string;
  expires_in: number;
}

interface BotReply {
  choices?: { message?: { content?: string } }[];
  credits?: number | null;
  files?: BotFile[];
}

/**
 * The endpoint is stateless - every call carries the whole conversation - so
 * the conversation lives here. One file per bot, owner-only, so an agent can
 * keep a thread across separate `baze bot ask --continue` calls.
 */
export function conversationPath(botId: string): string {
  return join(configDir(), 'conversations', `bot-${botId}.json`);
}

function loadConversation(botId: string): Message[] {
  const path = conversationPath(botId);
  if (!existsSync(path)) return [];
  try {
    const value = JSON.parse(readFileSync(path, 'utf8')) as unknown;
    return Array.isArray(value) ? (value as Message[]) : [];
  } catch {
    return [];
  }
}

function saveConversation(botId: string, messages: Message[]): void {
  const dir = join(configDir(), 'conversations');
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    writeFileSync(conversationPath(botId), JSON.stringify(messages), { mode: 0o600 });
  } catch {
    // A read-only HOME only costs --continue.
  }
}

export function parseBotId(raw: string | undefined): string {
  if (!raw || !/^\d+$/.test(raw)) {
    throw new CliError('A chatbot is named by its number.', {
      hint: 'baze bot ask <chatbot id> "question"  - the id is in the chatbot\'s API settings.',
    });
  }
  return raw;
}

/** A file name that does not overwrite an earlier download. */
function freePath(name: string): string {
  const safe = name.replace(/[\\/]/g, '_') || 'file';
  let path = resolve(safe);
  for (let i = 1; existsSync(path); i++) {
    const dot = safe.lastIndexOf('.');
    path = resolve(dot > 0 ? `${safe.slice(0, dot)}-${i}${safe.slice(dot)}` : `${safe}-${i}`);
  }
  return path;
}

async function turn(
  apiKey: string,
  botId: string,
  messages: Message[],
): Promise<{ text: string; credits: number | null; files: BotFile[]; requestId?: string }> {
  const { body, requestId } = await gatewayFetchJson<BotReply>(`/chatbots/${botId}/chat/completions/`, {
    apiKey,
    method: 'POST',
    body: { messages, stream: false },
  });
  return {
    text: body?.choices?.[0]?.message?.content ?? '',
    credits: typeof body?.credits === 'number' ? body.credits : null,
    files: Array.isArray(body?.files) ? body.files : [],
    requestId,
  };
}

async function saveFiles(apiKey: string, files: BotFile[]): Promise<string[]> {
  const saved: string[] = [];
  for (const file of files) {
    // The link is signed (`/v1/public/f/{id}/{sig}/`): the signature is the
    // credential, so an absolute link is fetched without the key. A relative
    // one is on the gateway's own host.
    const got = file.url.startsWith('http')
      ? await downloadPublic(file.url)
      : await gatewayFetchBytes(file.url, { apiKey });
    const path = freePath(file.filename);
    writeResult(path, got.bytes);
    saved.push(path);
  }
  return saved;
}

async function ask(parsed: Parsed): Promise<number> {
  const apiKey = requireApiKey();
  const botId = parseBotId(parsed.positionals[1]);
  let question = parsed.positionals.slice(2).join(' ').trim();
  if (!question && !process.stdin.isTTY) question = (await readStdin()).trim();
  if (!question) throw new CliError('No question given.', { hint: `baze bot ask ${botId} "question"` });

  const history = parsed.flags.get('continue') ? loadConversation(botId) : [];
  const messages: Message[] = [...history, { role: 'user', content: question }];
  const id = newHistoryId();
  recordHistory({ id, at: new Date().toISOString(), kind: 'bot', model: `bot:${botId}`, status: 'submitted', host: apiBase(), prompt: question });
  let reply: Awaited<ReturnType<typeof turn>>;
  try {
    reply = await turn(apiKey, botId, messages);
  } catch (error) {
    recordHistory({ id, at: new Date().toISOString(), kind: 'bot', model: `bot:${botId}`, status: 'failed', host: apiBase(), error: String((error as Error).message) });
    throw error;
  }
  saveConversation(botId, [...messages, { role: 'assistant', content: reply.text }]);
  const saved = parsed.flags.get('save') ? await saveFiles(apiKey, reply.files) : [];
  recordHistory({
    id, at: new Date().toISOString(), kind: 'bot', model: `bot:${botId}`, status: 'completed', host: apiBase(),
    credits: reply.credits, requestId: reply.requestId, files: saved,
  });

  if (parsed.flags.get('json')) {
    out(JSON.stringify(
      {
        bot: Number(botId),
        text: reply.text,
        files: reply.files.map((f) => ({ filename: f.filename, mime_type: f.mime_type, url: f.url, expires_in: f.expires_in })),
        saved,
        credits: reply.credits,
        request_id: reply.requestId ?? null,
        history_id: id,
        turns: messages.length,
      },
      null,
      2,
    ));
    return 0;
  }
  out(reply.text);
  for (const f of reply.files) say(`${c.cyan('file')} ${f.filename}  ${f.url}`);
  for (const p of saved) say(`${c.green('saved')} ${p}`);
  info(c.dim(`${reply.credits != null ? `${formatCredits(reply.credits)} credits · ` : ''}history ${id}${reply.requestId ? ` · request ${reply.requestId}` : ''}`));
  return 0;
}

async function chat(parsed: Parsed): Promise<number> {
  const apiKey = requireApiKey();
  const botId = parseBotId(parsed.positionals[1]);
  if (!process.stdin.isTTY || parsed.flags.get('no-input')) {
    throw new CliError('baze bot chat is interactive.', { hint: `For scripts and agents use \`baze bot ask ${botId} "..." [--continue]\`.` });
  }
  const messages: Message[] = parsed.flags.get('continue') ? loadConversation(botId) : [];
  say(c.dim(`Chatbot ${botId}. Empty line or /exit to leave, /reset to start over.${messages.length ? ` Continuing ${messages.length} messages.` : ''}`));
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  let total = 0;
  try {
    for (;;) {
      const line = (await rl.question(c.bold('> '))).trim();
      if (!line || line === '/exit') break;
      if (line === '/reset') {
        messages.length = 0;
        say(c.dim('Started over.'));
        continue;
      }
      messages.push({ role: 'user', content: line });
      try {
        const reply = await turn(apiKey, botId, messages);
        messages.push({ role: 'assistant', content: reply.text });
        saveConversation(botId, messages);
        out(reply.text);
        for (const f of reply.files) say(`${c.cyan('file')} ${f.filename}  ${f.url}`);
        if (reply.credits != null) total += reply.credits;
      } catch (error) {
        // One failed turn is not the end of the conversation; drop it and go on.
        messages.pop();
        say(`${c.red('XX')} ${(error as Error).message}`);
        if (error instanceof CliError && error.requestId) say(`request id: ${error.requestId}`);
      }
    }
  } finally {
    rl.close();
  }
  if (total) info(c.dim(`${formatCredits(total)} credits this session.`));
  return 0;
}

export async function botCommand(parsed: Parsed): Promise<number> {
  const sub = parsed.positionals[0];
  if (sub === 'ask') return ask(parsed);
  if (sub === 'chat') return chat(parsed);
  throw new CliError(sub ? `Unknown bot command "${sub}".` : 'baze bot ask|chat <chatbot id>', {
    hint: 'baze bot ask <id> "question" [--continue] [--save] [--json]   ·   baze bot chat <id>',
  });
}
