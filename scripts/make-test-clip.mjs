// Generates a clearly labelled TEST clip for verifying scroll sync end to end.
// Dark gradient, big frame counter, progress value and the beat name for each range.
// The last beat eases to the studio colour (#EFE7D8) like the real whiteout.
// usage: node scripts/make-test-clip.mjs desktop|mobile <out.mp4>
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import sharp from 'sharp';

const [variant = 'desktop', out = 'test.mp4'] = process.argv.slice(2);
const [W, H] = variant === 'mobile' ? [720, 1280] : [1280, 720];
const FPS = 12, SECONDS = 18, N = FPS * SECONDS;
const BEATS = [
  [0.0, 0.12, 'BEAT 1 · GALAXY · SHIP DRIFTS'],
  [0.12, 0.4, 'BEAT 2 · SHIP GLIDES · EARTH RISES'],
  [0.4, 0.55, 'BEAT 3 · CARGO BAY · BOX RELEASED'],
  [0.55, 0.85, 'BEAT 4 · FALL · IGNITION · COMET'],
  [0.85, 1.0, 'BEAT 5 · IMPACT · WHITEOUT'],
];
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
const hex = (c) => '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');

const dir = await mkdtemp(join(tmpdir(), 'arsh-test-'));
for (let i = 0; i < N; i++) {
  const p = i / (N - 1);
  const beat = BEATS.find(([a, b]) => p >= a && p <= b) ?? BEATS.at(-1);
  const white = Math.max(0, (p - 0.88) / 0.12);
  const top = hex(mix([10, 12, 20], [239, 231, 216], white));
  const bot = hex(mix([27, 36, 56], [239, 231, 216], white));
  const ink = white > 0.5 ? '#14161A' : '#E7D6B4';
  const s = W / 1280;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${top}"/><stop offset="1" stop-color="${bot}"/></linearGradient></defs>
  <rect width="100%" height="100%" fill="url(#g)"/>
  <rect x="${40 * s}" y="${40 * s}" width="${W - 80 * s}" height="${H - 80 * s}" fill="none" stroke="${ink}" stroke-opacity="0.35"/>
  <text x="50%" y="${H * 0.18}" fill="${ink}" font-family="Helvetica" font-size="${20 * s}" letter-spacing="${6 * s}" text-anchor="middle">TEST CLIP — REPLACE WITH REAL FOOTAGE</text>
  <text x="50%" y="${H * 0.52}" fill="${ink}" font-family="Helvetica" font-size="${180 * s}" text-anchor="middle">${String(i + 1).padStart(4, '0')}</text>
  <text x="50%" y="${H * 0.64}" fill="${ink}" font-family="Helvetica" font-size="${34 * s}" text-anchor="middle">p = ${p.toFixed(3)}</text>
  <text x="50%" y="${H * 0.74}" fill="${ink}" font-family="Helvetica" font-size="${24 * s}" letter-spacing="${4 * s}" text-anchor="middle">${beat[2]}</text>
  <rect x="${80 * s}" y="${H - 90 * s}" width="${(W - 160 * s) * p}" height="${4 * s}" fill="${ink}"/>
</svg>`;
  await sharp(Buffer.from(svg)).png().toFile(join(dir, `${String(i + 1).padStart(4, '0')}.png`));
}
execFileSync('ffmpeg', ['-v', 'error', '-y', '-framerate', String(FPS), '-i', join(dir, '%04d.png'),
  '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', out], { stdio: 'inherit' });
await rm(dir, { recursive: true, force: true });
console.log(`   test clip written: ${out} (${W}x${H}, ${SECONDS}s)`);
