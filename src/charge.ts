import { formatCredits } from './ui.js';

/**
 * What a call was charged, read from whatever the gateway sent with it.
 *
 * Image, video and transcription results carry `credits_charged` in every
 * mode; music carries an `X-Credits-Charged` header. Everything else carries
 * the charge only inside the KRW-mode `billing` block (`X-Billing` on binary
 * audio), so a legacy-mode tenant sees nothing there and null comes back.
 */

export interface ChargeReply {
  credits_charged?: number | null;
  billing?: { deducted_credit?: number } | null;
}

const finite = (n: unknown): number | null => (typeof n === 'number' && Number.isFinite(n) ? n : null);

export function chargedCredits(reply: ChargeReply | undefined): number | null {
  return finite(reply?.credits_charged ?? reply?.billing?.deducted_credit);
}

/** A binary reply: `X-Credits-Charged`, else the `X-Billing` block. */
export function chargedFromHeaders(headers: Headers): number | null {
  const charged = headers.get('x-credits-charged');
  if (charged !== null && charged !== '') return finite(Number(charged));
  const billing = headers.get('x-billing');
  if (!billing) return null;
  try {
    return chargedCredits({ billing: JSON.parse(billing) as ChargeReply['billing'] });
  } catch {
    return null;
  }
}

/** "12 tokens billed, 0.0015 credits" - the credits only when the gateway said. */
export function billedLine(what: string, credits: number | null): string {
  return credits === null ? `${what} billed` : `${what} billed, ${formatCredits(credits)} credits`;
}
