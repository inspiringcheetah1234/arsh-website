// Generates neutral placeholder figures for the catalogue so the lineup is testable
// before real photography exists. Transparent WebP, 600x1500, feet on the same baseline (y=1462),
// identical crop and scale — the same spec real cutouts must follow (see scripts/cutout.md).
// usage: (cd scripts && node make-silhouettes.mjs)
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import sharp from 'sharp';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'assets', 'catalogue');
const W = 600, H = 1500, CX = 300, BASE = 1462;

const WASH = { rinse: '#1E2840', indigo: '#2A3858', mid: '#4B5E80', light: '#8494AE', black: '#222326', ecru: '#CFC3AC' };
// Placeholder tops use the brand palette (Orbit Red, Andromeda Blue, Wax Red, Deep Space) plus a cream-dark that reads on the Ticket Cream studio.
const TOP = { bone: '#E2D3BF', ink: '#0D0D0D', kraft: '#F23B35', forest: '#2B3DB0', midnight: '#A51D1E' };
const SKIN = '#9B958C';

// Legs: [hipHalf, kneeHalf, hemHalf] widths per leg, measured from leg centre.
const FIT = {
  slim: [62, 44, 36], straight: [66, 54, 50], wide: [74, 78, 86], flare: [64, 46, 84],
  baggy: [80, 82, 82], tapered: [74, 56, 40],
};

function figure({ fit, wash, top, sleeve = 'long', hem = 650 }) {
  const [hip, knee, hemW] = FIT[fit];
  const denim = WASH[wash], topC = TOP[top];
  const waist = 640, crotch = 805, kneeY = 1110, hemY = 1418;
  const L = CX - 64, R = CX + 64; // leg centres
  const leg = (c, s) =>
    `M ${c - s * hip} ${waist + 2} C ${c - s * hip} ${crotch - 60}, ${c - s * (knee + 6)} ${kneeY - 120}, ${c - s * knee} ${kneeY}
     L ${c - s * hemW} ${hemY} L ${c + s * hemW * 0.92} ${hemY} L ${c + s * knee * 0.86} ${kneeY}
     C ${c + s * 30} ${crotch + 40}, ${CX + s * 4} ${crotch}, ${CX} ${crotch} L ${CX} ${waist + 2} Z`;
  const sleeves = sleeve === 'long'
    ? `<path d="M 196 215 C 170 260 160 420 150 560 L 140 712 L 178 716 L 196 560 C 204 450 214 330 222 270 Z" fill="${topC}"/>
       <path d="M 404 215 C 430 260 440 420 450 560 L 460 712 L 422 716 L 404 560 C 396 450 386 330 378 270 Z" fill="${topC}"/>`
    : `<path d="M 196 215 C 176 250 168 300 164 360 L 210 372 L 222 270 Z" fill="${topC}"/>
       <path d="M 404 215 C 424 250 432 300 436 360 L 390 372 L 378 270 Z" fill="${topC}"/>
       <path d="M 166 362 C 158 460 150 600 146 712 L 178 716 L 188 600 C 194 500 202 430 208 372 Z" fill="${SKIN}"/>
       <path d="M 434 362 C 442 460 450 600 454 712 L 422 716 L 412 600 C 406 500 398 430 392 372 Z" fill="${SKIN}"/>`;
  const thread = 'stroke="#E7D6B4" stroke-opacity="0.35" stroke-width="2" fill="none"';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <ellipse cx="${CX}" cy="118" rx="40" ry="50" fill="${SKIN}"/>
  <rect x="284" y="160" width="32" height="48" rx="10" fill="${SKIN}"/>
  <ellipse cx="160" cy="728" rx="17" ry="26" fill="${SKIN}"/>
  <ellipse cx="440" cy="728" rx="17" ry="26" fill="${SKIN}"/>
  <path d="${leg(L, 1)}" fill="${denim}"/>
  <path d="${leg(R, -1)}" fill="${denim}"/>
  <path d="M ${CX - 4} ${waist + 6} L ${CX - 4} ${crotch - 30}" ${thread}/>
  <path d="M ${CX - 70} ${waist + 10} C ${CX - 66} ${waist + 60}, ${CX - 40} ${waist + 70}, ${CX - 20} ${waist + 72}" ${thread}/>
  <path d="M ${CX + 70} ${waist + 10} C ${CX + 66} ${waist + 60}, ${CX + 40} ${waist + 70}, ${CX + 20} ${waist + 72}" ${thread}/>
  <rect x="${CX - 82}" y="${waist - 6}" width="164" height="22" fill="${denim}"/>
  <path d="M ${CX - 82} ${waist + 16} L ${CX + 82} ${waist + 16}" ${thread}/>
  <path d="M 196 212 C 230 196 262 196 300 204 C 338 196 370 196 404 212 L 392 ${hem} L 208 ${hem} Z" fill="${topC}"/>
  ${sleeves}
  <ellipse cx="${L - 6}" cy="${BASE - 20}" rx="${Math.max(48, hemW + 6)}" ry="20" fill="#1A1B1E"/>
  <ellipse cx="${R + 6}" cy="${BASE - 20}" rx="${Math.max(48, hemW + 6)}" ry="20" fill="#1A1B1E"/>
</svg>`;
}

const LOOKS = [
  { fit: 'straight', wash: 'rinse', top: 'bone', sleeve: 'short', hem: 600 },
  { fit: 'wide', wash: 'indigo', top: 'ink', hem: 690 },
  { fit: 'slim', wash: 'black', top: 'kraft', sleeve: 'short', hem: 610 },
  { fit: 'flare', wash: 'mid', top: 'midnight', hem: 640 },
  { fit: 'baggy', wash: 'light', top: 'ink', sleeve: 'short', hem: 620 },
  { fit: 'straight', wash: 'ecru', top: 'forest', hem: 700 },
  { fit: 'tapered', wash: 'indigo', top: 'bone', hem: 660 },
  { fit: 'wide', wash: 'rinse', top: 'kraft', hem: 720 },
  { fit: 'slim', wash: 'mid', top: 'ink', sleeve: 'short', hem: 600 },
  { fit: 'flare', wash: 'black', top: 'bone', hem: 650 },
];

await mkdir(OUT, { recursive: true });
await Promise.all(LOOKS.map((look, i) =>
  sharp(Buffer.from(figure(look))).webp({ quality: 82, alphaQuality: 90 })
    .toFile(join(OUT, `placeholder-${String(i + 1).padStart(2, '0')}.webp`))));
console.log(`wrote ${LOOKS.length} placeholder figures to assets/catalogue/`);
