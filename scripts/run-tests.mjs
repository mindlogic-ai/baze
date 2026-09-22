import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

const files = readdirSync('.build', { recursive: true })
  .map(String)
  .filter((f) => f.endsWith('.test.js'))
  .map((f) => join('.build', f))
  .sort();
if (files.length === 0) {
  console.error('run-tests: no compiled tests under .build/');
  process.exit(1);
}
const result = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' });
process.exit(result.status ?? 1);
