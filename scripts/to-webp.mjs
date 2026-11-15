// PNG directory -> WebP directory using sharp. Used by make-frames.sh when
// neither cwebp nor an ffmpeg build with libwebp is available.
// usage: node scripts/to-webp.mjs <inDir> <outDir> [quality]
import { readdir } from 'node:fs/promises';
import { join, basename } from 'node:path';
import sharp from 'sharp';

const [inDir, outDir, q = '70'] = process.argv.slice(2);
const files = (await readdir(inDir)).filter((f) => f.endsWith('.png')).sort();
const quality = Number(q);

let i = 0;
async function worker() {
  while (i < files.length) {
    const f = files[i++];
    await sharp(join(inDir, f)).webp({ quality, effort: 5, smartSubsample: true })
      .toFile(join(outDir, basename(f, '.png') + '.webp'));
  }
}
await Promise.all(Array.from({ length: 6 }, worker));
console.log(`   encoded ${files.length} frames (sharp, q${quality})`);
