import type { Parsed } from '../args.js';
import { gatewayFetch } from '../api.js';
import { info, out } from '../ui.js';
import { requireApiKey } from './models.js';

export interface UsageRow {
  key: string;
  call_count: number;
  credits: number;
}

export interface UsageSummary {
  object: string;
  start_date: string;
  end_date: string;
  timezone: string;
  group_by: string;
  scope: string;
  total: { call_count: number; credits: number };
  rows: UsageRow[];
}

const n = (v: number): string => v.toLocaleString('en-US', { maximumFractionDigits: 2 });

export function formatUsage(body: UsageSummary): string[] {
  const header = `${body.start_date} to ${body.end_date} (${body.timezone})  ·  by ${body.group_by}  ·  scope ${body.scope}`;
  if (body.rows.length === 0) return [header, '', 'No gateway calls in this window.'];

  const width = Math.max(6, ...body.rows.map((r) => r.key.length));
  const lines = [header, '', `${''.padEnd(width)}  ${'calls'.padStart(9)}  ${'credits'.padStart(12)}`];
  for (const r of body.rows) {
    lines.push(`${r.key.padEnd(width)}  ${n(r.call_count).padStart(9)}  ${n(r.credits).padStart(12)}`);
  }
  lines.push('');
  lines.push(`${'total'.padEnd(width)}  ${n(body.total.call_count).padStart(9)}  ${n(body.total.credits).padStart(12)}`);
  return lines;
}

export function usageQuery(flags: Map<string, string | true>): URLSearchParams {
  const params = new URLSearchParams();
  const value = (name: string): string | undefined => {
    const v = flags.get(name);
    return typeof v === 'string' ? v : undefined;
  };
  const by = value('by') ?? 'model';
  const from = value('from');
  const to = value('to');
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  params.set('by', by);
  // Grouping by key only means something across keys, so --by key widens the
  // scope to the member unless the user said otherwise.
  params.set('scope', value('scope') ?? (by === 'key' ? 'member' : 'key'));
  return params;
}

export async function usageCommand(parsed: Parsed): Promise<number> {
  const apiKey = requireApiKey();
  const params = usageQuery(parsed.flags);
  const body = await gatewayFetch<UsageSummary>(`/usage/?${params.toString()}`, { apiKey });

  if (parsed.flags.get('json')) {
    out(JSON.stringify(body, null, 2));
    return 0;
  }
  for (const line of formatUsage(body)) out(line);
  info(
    body.scope === 'member'
      ? 'Every key you own; dates are Korea time. Add --json to pipe it.'
      : 'This key only; dates are Korea time. `--by key` or `--scope member` covers all your keys.',
  );
  return 0;
}
