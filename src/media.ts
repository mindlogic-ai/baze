import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { extname, resolve } from 'node:path';
import { CliError } from './ui.js';

const IMAGE_MIME: Readonly<Record<string, string>> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

/**
 * The gateway caps a request body at 25 MB and a data URL is base64 (4/3 of
 * the file), so a file past this fails there anyway - after the upload.
 */
export const MAX_INLINE_BYTES = 18 * 1024 * 1024;

/**
 * An `--image` value as the gateway takes it: a URL passes through, a local
 * file becomes a `data:` URL. The file type is read off the extension; the
 * gateway checks the bytes.
 */
export function imageInput(ref: string): string {
  if (/^(https?:|data:)/.test(ref)) return ref;
  const path = resolve(ref);
  if (!existsSync(path)) throw new CliError(`No such file: ${ref}.`);
  const mime = IMAGE_MIME[extname(path).toLowerCase()];
  if (!mime) {
    throw new CliError(`${ref} is not an image baze can send.`, {
      hint: `Use ${Object.keys(IMAGE_MIME).join(', ')}, or pass an https URL.`,
    });
  }
  const size = statSync(path).size;
  if (size > MAX_INLINE_BYTES) {
    throw new CliError(`${ref} is ${Math.round(size / 1024 / 1024)} MB; the gateway takes up to 18 MB inline.`, {
      hint: 'Pass an https URL to the image instead.',
    });
  }
  return `data:${mime};base64,${readFileSync(path).toString('base64')}`;
}

const EXT_BY_TYPE: Readonly<Record<string, string>> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
};

/** Extension from the content type, then the URL path, then the kind's default. */
export function extensionFor(contentType: string, url: string | undefined, fallback: string): string {
  const byType = EXT_BY_TYPE[contentType.split(';')[0]!.trim().toLowerCase()];
  if (byType) return byType;
  if (url && !url.startsWith('data:')) {
    try {
      const ext = extname(new URL(url).pathname).slice(1).toLowerCase();
      if (/^[a-z0-9]{2,4}$/.test(ext)) return ext;
    } catch {
      // not a URL; fall through
    }
  }
  return fallback;
}

/** `data:<type>;base64,<payload>` to bytes and type. Structure only. */
export function decodeDataUrl(url: string): { bytes: Buffer; contentType: string } {
  const comma = url.indexOf(',');
  const header = url.slice(5, comma);
  if (comma === -1 || !header.endsWith(';base64')) throw new CliError('The gateway returned an unreadable image.');
  return { bytes: Buffer.from(url.slice(comma + 1), 'base64'), contentType: header.slice(0, -';base64'.length) };
}

const pad = (n: number): string => String(n).padStart(2, '0');

/** Local time, so the file name matches the clock the person is looking at. */
const stamp = (d: Date): string =>
  `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;

/**
 * Where each result goes. `-o name.ext` for one file; for several, the index
 * goes before the extension (`name-1.png`). Without `-o`, a timestamped name
 * in the current directory that cannot collide with an earlier run.
 */
export function outputPaths(kind: string, count: number, ext: string, output?: string, now = new Date()): string[] {
  if (output) {
    if (count === 1) return [resolve(output)];
    const dot = extname(output);
    const stem = dot ? output.slice(0, -dot.length) : output;
    return Array.from({ length: count }, (_, i) => resolve(`${stem}-${i + 1}${dot || `.${ext}`}`));
  }
  const base = `baze-${kind}-${stamp(now)}-${randomBytes(2).toString('hex')}`;
  if (count === 1) return [resolve(`${base}.${ext}`)];
  return Array.from({ length: count }, (_, i) => resolve(`${base}-${i + 1}.${ext}`));
}

export function writeResult(path: string, bytes: Buffer): void {
  try {
    writeFileSync(path, bytes);
  } catch (error) {
    throw new CliError(`Cannot write ${path}: ${(error as NodeJS.ErrnoException).code ?? 'error'}.`);
  }
}

/**
 * Gemini TTS answers raw 16-bit little-endian mono PCM at 24 kHz, and the
 * gateway relays those bytes as `audio/pcm` with no header. A 44-byte RIFF
 * header makes it a WAV any player opens.
 */
export function pcmToWav(pcm: Buffer, sampleRate = 24000, channels = 1, bitsPerSample = 16): Buffer {
  const blockAlign = (channels * bitsPerSample) / 8;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * blockAlign, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}
