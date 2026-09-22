import { HOSTS } from './keys.js';
import { CliError } from './ui.js';

export { HOSTS };

export function gatewayBase(host: string): string {
  return `${host.replace(/\/+$/, '')}/v1/gateway`;
}

/** The host this machine last logged in to goes first, so a returning NCP user never sends the key to AWS. */
export function hostOrder(preferred: string | undefined): string[] {
  const all: string[] = [HOSTS.aws, HOSTS.ncp];
  if (!preferred || !all.includes(preferred)) return all;
  return [preferred, ...all.filter((h) => h !== preferred)];
}

/**
 * Only for old untagged keys: a tagged key names its own deployment. A
 * FactChat key belongs to exactly one deployment, and NCP tenants have called
 * AWS by mistake (C13).
 *
 * The probe moves to the next host only when the answer proves the key is not
 * this host's (401/403), or when no connection was made, so no key was sent.
 * Any other answer (a 5xx during maintenance, a 429) means the key reached a
 * host that could not judge it: stop there rather than forward it, and do not
 * claim it was refused.
 *
 * `probe` is the real validating call (the catalog fetch), so the first
 * success is also the data the caller needed - no second request.
 */
export async function detectHost<T>(
  hosts: string[],
  probe: (host: string) => Promise<T>,
): Promise<{ host: string; value: T }> {
  const unreachable: string[] = [];
  for (const host of hosts) {
    try {
      return { host, value: await probe(host) };
    } catch (error) {
      const status = error instanceof CliError ? error.status : undefined;
      if (status === 401 || status === 403) continue;
      if (status === undefined) {
        unreachable.push(host);
        continue;
      }
      throw new CliError(`Could not check the key: ${host} answered HTTP ${status}.`, {
        hint: 'Try again shortly, or pass --host aws|ncp as shown on the API keys page.',
      });
    }
  }
  if (unreachable.length > 0) {
    throw new CliError(`Could not reach ${unreachable.join(' or ')}, and no other host accepted the key.`, {
      hint: 'Check the network, or pass --host aws|ncp as shown on the API keys page.',
    });
  }
  throw new CliError('That key was not accepted by any FactChat host.', {
    hint: `Checked ${hosts.join(' and ')}. Copy the key again from the API keys page, or pass --host <url> for your own deployment.`,
  });
}
