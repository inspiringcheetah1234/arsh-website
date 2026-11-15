// Neutral head-and-shoulders placeholder for team portraits (4:5, greyscale, uniform collar).
// Real photos: any colour photo works; the page renders every portrait in black and white.
// usage: (cd scripts && node make-team-placeholder.mjs)
import sharp from 'sharp';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'assets', 'team', 'placeholder.webp');
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1000" viewBox="0 0 800 1000">
  <rect width="800" height="1000" fill="#E6E3DF"/>
  <path d="M60 1000 C70 800 190 730 330 710 L470 710 C610 730 730 800 740 1000 Z" fill="#1A1A1A"/>
  <path d="M330 710 L400 790 L470 710 Z" fill="#2C2C2C"/>
  <rect x="352" y="600" width="96" height="125" rx="40" fill="#8C8C8C"/>
  <ellipse cx="400" cy="440" rx="132" ry="168" fill="#9A9A9A"/>
  <path d="M262 430 C250 270 330 235 400 235 C470 235 552 270 538 430 C520 350 470 320 400 320 C330 320 280 350 262 430Z" fill="#3A3A3A"/>
  <rect x="520" y="800" width="86" height="34" rx="14" fill="#E6E3DF" opacity=".75"/>
</svg>`;
await sharp(Buffer.from(svg)).webp({ quality: 82 }).toFile(OUT);
console.log('wrote', OUT);
