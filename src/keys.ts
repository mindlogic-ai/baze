import { CliError } from './ui.js';

export const HOSTS = {
  aws: 'https://factchat-cloud.mindlogic.ai',
  ncp: 'https://factchat.mindlogic-kr-api.com',
} as const;

const HOST_FOR_TAG: Record<string, string | undefined> = { aws: HOSTS.aws, ncp: HOSTS.ncp };

// Key format: see Global Constraints. The server side is factchat/utils/auth.py.
const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const TAGGED = /^(baze_[0-9A-Za-z]{32})([0-9A-Za-z]{6})$/;
const DEPLOYMENTS = ['aws', 'ncp', 'opm'] as const;
const LEGACY = /^[0-9A-Za-z]{32}$/;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

// zlib.crc32 only exists from Node 20.15, and the floor is 20.10.
function crc32(text: string): number {
  let c = 0xffffffff;
  for (const byte of Buffer.from(text, 'utf8')) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function base62(value: number, width: number): string {
  let out = '';
  for (let i = 0; i < width; i++) {
    out = BASE62[value % 62]! + out;
    value = Math.floor(value / 62);
  }
  return out;
}

export type KeyInfo = { kind: 'tagged'; deployment: 'aws' | 'ncp' | 'opm' } | { kind: 'legacy' };

/** Structural check of our own key format - it never guesses what a string means. */
export function inspectKey(key: string): KeyInfo {
  const tagged = TAGGED.exec(key);
  if (tagged) {
    // The deployment is folded into the checksum, so the key never displays it.
    const deployment = DEPLOYMENTS.find((d) => base62(crc32(`${d}:${tagged[1]}`), 6) === tagged[2]);
    if (!deployment) {
      throw new CliError('That key looks mistyped - its checksum does not match.', {
        hint: 'Copy it again from the API keys page; nothing was sent anywhere.',
      });
    }
    return { kind: 'tagged', deployment };
  }
  if (LEGACY.test(key)) return { kind: 'legacy' };
  throw new CliError('That is not a Baze key.', {
    hint: key.startsWith('baze_')
      ? 'It is the wrong length - copy it again from the API keys page.'
      : 'Baze keys start with `baze_` (older keys are 32 letters and digits).',
  });
}

/** The host a key belongs to, or undefined for an old untagged, on-premise or malformed key. */
export function hostForKey(key: string): string | undefined {
  try {
    const info = inspectKey(key);
    return info.kind === 'tagged' ? HOST_FOR_TAG[info.deployment] : undefined;
  } catch {
    return undefined;
  }
}
