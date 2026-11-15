// Traces the supplied brand artwork (brand/source/*.png: light shape on black) into clean SVGs in
// public/assets/brand/. The SVGs have no fill colour of their own: the site recolours them with CSS
// masks, so every approved pairing (blue on cream, cream on red, red on black…) uses the same artwork.
// usage: (cd scripts && node trace-logos.mjs)
import potrace from 'potrace';
import { promisify } from 'node:util';
import { readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const trace = promisify(potrace.trace);
const JOBS = [
  ['wordmark', 'wordmark.png'],
  ['andromeda-mark', 'andromeda-mark.png'],
];
for (const [name, file] of JOBS) {
  const svg = await trace(await readFile(join(ROOT, 'brand', 'source', file)), {
    threshold: 128, blackOnWhite: false, turdSize: 4, alphaMax: 1, optCurve: true, optTolerance: 0.2,
  });
  const out = svg
    .replace(/<\?xml[^>]*\?>\s*/, '')
    .replace(/ fill="[^"]*"/g, '')                 // colour comes from the page
    .replace('<svg ', '<svg role="img" ');
  await writeFile(join(ROOT, 'public', 'assets', 'brand', `${name}.svg`), out.trim() + '\n');
  console.log(name, `${(out.length / 1024).toFixed(1)} KB`, out.match(/viewBox="[^"]*"/)?.[0]);
}
