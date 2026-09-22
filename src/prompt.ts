import { createInterface } from 'node:readline';
import { CliError } from './ui.js';

/** Testable core: read one line from any stream. */
export async function readSecretFrom(input: NodeJS.ReadStream): Promise<string> {
  const rl = createInterface({ input, terminal: false });
  for await (const line of rl) {
    rl.close();
    const value = line.trim();
    if (!value) throw new CliError('No key was entered.', { hint: 'Run `baze login` again and paste the key.' });
    return value;
  }
  throw new CliError('No key was entered.', { hint: 'Run `baze login` again and paste the key.' });
}

/**
 * Interactive read with the echo off. The key never reaches argv, so it cannot
 * appear in `ps` output or in shell history.
 */
export async function readSecret(promptText: string): Promise<string> {
  process.stderr.write(promptText);
  const tty = process.stdin.isTTY === true;
  if (!tty) return readSecretFrom(process.stdin);

  process.stdin.setRawMode?.(true);
  let buffer = '';
  try {
    return await new Promise<string>((resolve, reject) => {
      const cleanup = (): void => {
        process.stdin.off('data', onData);
        process.stdin.setRawMode?.(false);
        process.stdin.pause();
      };
      const onData = (chunk: Buffer): void => {
        for (const byte of chunk) {
          if (byte === 3) {
            cleanup();
            reject(new CliError('Cancelled.'));
            return;
          }
          if (byte === 13 || byte === 10) {
            cleanup();
            process.stderr.write('\n');
            const value = buffer.trim();
            if (!value) reject(new CliError('No key was entered.', { hint: 'Run `baze login` again and paste the key.' }));
            else resolve(value);
            return;
          }
          if (byte === 127) buffer = buffer.slice(0, -1);
          else buffer += String.fromCharCode(byte);
        }
      };
      process.stdin.on('data', onData);
    });
  } finally {
    process.stdin.setRawMode?.(false);
  }
}
