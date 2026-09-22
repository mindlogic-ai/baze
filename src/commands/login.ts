import type { Parsed } from '../args.js';
import { type Catalog, contentFilterWarning, fetchCatalogDetail, gatewayFetch } from '../api.js';
import {
  apiBase,
  clearCredentials,
  credentialsPath,
  ENV_BASE_NAME,
  ENV_KEY_NAME,
  loadStoredCredentials,
  resolveCredential,
  saveCredentials,
} from '../config.js';
import { detectHost, hostOrder, HOSTS } from '../hosts.js';
import { hostForKey, inspectKey } from '../keys.js';
import { readSecret, readSecretFrom } from '../prompt.js';
import { c, CliError, info, maskKey, ok, out, say, warn } from '../ui.js';

export async function loginCommand(parsed: Parsed): Promise<number> {
  const hostFlag = parsed.flags.get('host');
  const fromStdin = parsed.flags.get('with-key') === true;
  const noInput = parsed.flags.get('no-input') === true;

  // The key is never an argv value: `--with-key` reads it from stdin, like
  // `gh auth login --with-token`, so it stays out of `ps` and shell history.
  let key: string;
  if (fromStdin) {
    key = await readSecretFrom(process.stdin);
  } else if (noInput) {
    throw new CliError('No key given and --no-input is set.', {
      hint: 'Pipe the key in: `printf %s "$KEY" | baze login --with-key`.',
    });
  } else {
    say(c.bold('Log in to Baze.'));
    say('Create or copy a key on the API keys page of your Baze console, then paste it here.');
    say('');
    key = await readSecret('API key: ');
  }

  // Offline first: a mistyped tagged key fails here, before any request.
  const shape = inspectKey(key);

  // Then validate against the gateway before saving - a stored-but-wrong key
  // turns every later command into a confusing 401. The validating call is the
  // catalog fetch itself, so a login makes exactly one request for a tagged key.
  let host: string;
  let catalog: Catalog;
  const tagHost = hostForKey(key);
  // An explicit base (--host, --api-base or BAZE_API_BASE) always wins - that
  // is how a local or staging server is reached with a production-tagged key.
  const explicit = typeof hostFlag === 'string' ? hostFlag : process.env[ENV_BASE_NAME];
  if (explicit) {
    host = HOSTS[explicit as keyof typeof HOSTS] ?? explicit.replace(/\/+$/, '');
    catalog = await fetchCatalogDetail(key, { force: true, base: host });
  } else if (tagHost) {
    host = tagHost;
    catalog = await fetchCatalogDetail(key, { force: true, base: host });
  } else if (shape.kind === 'tagged') {
    throw new CliError('This key belongs to an on-premise Baze.', {
      hint: 'Pass that server: `baze login --host https://<your Baze server>`.',
    });
  } else {
    info('Checking which Baze host this key belongs to...');
    const found = await detectHost(hostOrder(loadStoredCredentials()?.host), (h) =>
      fetchCatalogDetail(key, { force: true, base: h }),
    );
    host = found.host;
    catalog = found.value;
  }

  const path = saveCredentials({ api_key: key, host });

  ok(`Key accepted (${maskKey(key)}) on ${host}.`);
  ok(`Saved to ${path}, mode 0600.`);
  ok(`${catalog.rows.filter((r) => r.type === 'llm').length} chat models are available to this key.`);
  const policy = contentFilterWarning(catalog.contentFilter);
  if (policy) warn(policy);
  info('');
  info('Next:');
  info('  baze claude     Claude Code through the gateway');
  info('  baze codex      Codex CLI');
  info('  baze opencode   OpenCode - the only one that reaches every model');
  info('  baze models     what this key can call');
  return 0;
}

export async function logoutCommand(parsed: Parsed): Promise<number> {
  const revoke = parsed.flags.get('revoke') === true;
  const stored = loadStoredCredentials();

  if (revoke) {
    if (!stored?.api_key) {
      throw new CliError('There is no stored key to revoke.', {
        hint: 'A key that only lives in BAZE_API_KEY: delete it on the API keys page.',
      });
    }
    // The same host every other command would use for this key - never the
    // tag's production host when login recorded a different one.
    const base = process.env[ENV_BASE_NAME] || stored.host || hostForKey(stored.api_key) || apiBase();
    // Revoke first, delete second: if the call fails, the file is still there to retry with.
    try {
      await gatewayFetch('/keys/revoke/', { apiKey: stored.api_key, base, method: 'POST' });
    } catch (error) {
      if (error instanceof CliError && error.status === 404) {
        throw new CliError(`${base} cannot revoke keys from the CLI yet; nothing was changed.`, {
          hint: 'Delete the key on the API keys page, then run `baze logout`.',
        });
      }
      throw error;
    }
    ok(`Disabled ${maskKey(stored.api_key)} on ${base}. Anything else using it now gets 401.`);
  }

  if (!clearCredentials()) {
    info('There were no stored credentials.');
    return 0;
  }
  ok('Removed the stored key.');
  if (!revoke) warn('The key itself is still valid. `baze logout --revoke` disables it; so does deleting it on the API keys page.');
  return 0;
}

export async function authCommand(): Promise<number> {
  const cred = resolveCredential();
  if (cred.source === 'none') {
    throw new CliError('Not logged in.', { hint: 'Run `baze login`, or set BAZE_API_KEY.' });
  }
  // Report the host that will actually be used, which is not always the stored one.
  say(`key    ${maskKey(cred.apiKey!)}  (${cred.source === 'env' ? `from ${ENV_KEY_NAME}` : credentialsPath()})`);
  say(`host   ${apiBase()}`);
  return 0;
}

export async function envCommand(): Promise<number> {
  const cred = resolveCredential();
  if (cred.source === 'none') {
    throw new CliError('Not logged in.', { hint: 'Run `baze login` first.' });
  }
  // stdout, because this is meant to be eval'd.
  out(`export ${ENV_KEY_NAME}=${JSON.stringify(cred.apiKey)}`);
  return 0;
}
