import { readFileSync, writeFileSync } from 'node:fs';

// The runtime must not read package.json: it is not reliably next to the
// bundle under npx or inside the sandbox image.
const { version } = JSON.parse(readFileSync('package.json', 'utf8'));
const path = 'dist/index.js';
const source = readFileSync(path, 'utf8');
if (!source.includes('__VERSION__')) {
  console.error('stamp-version: __VERSION__ placeholder not found in dist/index.js');
  process.exit(1);
}
writeFileSync(path, source.replaceAll('__VERSION__', version));
console.log(`stamped ${version}`);
