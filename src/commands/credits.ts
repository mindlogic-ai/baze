import type { Parsed } from '../args.js';
import { gatewayFetch } from '../api.js';
import { info, out } from '../ui.js';
import { requireApiKey } from './models.js';

export interface Bucket {
  quota: number;
  used: number;
  remaining: number;
}

export interface CreditBalance {
  object: string;
  monthly_allocated: Bucket & { renewal_date: string | null };
  purchased: Bucket;
  org_granted: Bucket;
  total: Bucket;
}

const n = (v: number): string => v.toLocaleString('en-US', { maximumFractionDigits: 2 });

export function formatCredits(body: CreditBalance): string[] {
  const lines: string[] = [];
  const row = (label: string, b: Bucket, suffix = ''): void => {
    lines.push(`${label.padEnd(16)} ${n(b.remaining).padStart(12)} remaining   ${n(b.used)} of ${n(b.quota)} used${suffix}`);
  };

  const renewal = body.monthly_allocated.renewal_date
    ? `   renews ${body.monthly_allocated.renewal_date.slice(0, 10)}`
    : '';
  row('monthly', body.monthly_allocated, renewal);
  row('purchased', body.purchased);
  // An all-zero bucket is noise for the many tenants that never use it.
  if (body.org_granted.quota > 0 || body.org_granted.used > 0) row('org granted', body.org_granted);
  lines.push('');
  row('total', body.total);
  return lines;
}

export async function creditsCommand(parsed: Parsed): Promise<number> {
  const apiKey = requireApiKey();
  const body = await gatewayFetch<CreditBalance>('/credits/', { apiKey });

  if (parsed.flags.get('json')) {
    out(JSON.stringify(body, null, 2));
    return 0;
  }
  for (const line of formatCredits(body)) out(line);
  // No pricing claims here: the rate is server policy (S4's gateway_rate_factor)
  // and a sentence compiled into a binary cannot follow it.
  info('Where it went: `baze usage`.');
  return 0;
}
