# Catalogue cutouts — how to prepare a new piece

The lineup only works if every image has the **same canvas, the same scale and the same baseline**.
Get that right and the figures stand on one floor; get it wrong and they float.

## The spec

| | |
|---|---|
| Format | Transparent WebP (preferred) or PNG |
| Canvas | **600 × 1500 px** (2:5). Larger is fine if every image uses the same size and ratio, e.g. 1200 × 3000 |
| Subject | Full body, head to shoes, facing camera |
| Baseline | Soles of the shoes touch **y = 1462 px** (≈ 97.5% down). Same for every image |
| Scale | Same model height in px across all images (about 1400 px head-to-sole at 600 × 1500) |
| Centre | Body centred horizontally |
| Background | Fully transparent, no shadow baked in |
| Size | 60–200 KB each after WebP compression |

## 1. Shoot

- Same camera height (waist level), same focal length (50–85 mm), same distance, every look.
- Plain, evenly lit background that contrasts with the denim, so background removal is clean.
- Tripod with a floor mark for the model's feet. Consistency here saves hours later.

## 2. Remove the background (rembg)

```bash
pipx install "rembg[cli]"          # or: pip install "rembg[cli]"
mkdir -p cut
rembg p -m birefnet-general raw/ cut/     # folder in, folder out; PNG with alpha
```

`birefnet-general` handles hair and fabric edges well. `isnet-general-use` and `u2net` are faster.
Check every edge by eye, especially between the legs and around hands. Fix any leftovers in Photoshop or Photopea.

## 3. Normalise canvas, scale and baseline

`normalise.mjs` below trims each cutout to its visible pixels, scales it to a fixed height, centres it and
puts the soles on the baseline. Run it from `scripts/`, where sharp is already installed:

```js
// scripts/normalise.mjs — usage: node normalise.mjs ../cut ../assets/catalogue
import sharp from 'sharp';
import { readdir } from 'node:fs/promises';
import { join, parse } from 'node:path';

const [inDir, outDir] = process.argv.slice(2);
const W = 600, H = 1500, BASE = 1462, FIGURE_H = 1400;

for (const f of (await readdir(inDir)).filter((n) => /\.(png|webp)$/i.test(n))) {
  const trimmed = await sharp(join(inDir, f)).trim({ threshold: 1 }).toBuffer();
  const fig = await sharp(trimmed).resize({ height: FIGURE_H }).toBuffer();
  const { width } = await sharp(fig).metadata();
  await sharp({ create: { width: W, height: H, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: fig, left: Math.round((W - width) / 2), top: BASE - FIGURE_H }])
    .webp({ quality: 85, alphaQuality: 90 })
    .toFile(join(outDir, parse(f).name + '.webp'));
  console.log('ok', f);
}
```

If a model is genuinely taller or shorter and you want to keep that, change `FIGURE_H` per image.
Keep the baseline fixed either way.

## 4. Register the piece

Add or replace an entry in `data/catalogue.json`:

```json
{ "name": "Look 01", "slug": "look-01", "image": "assets/catalogue/look-01.webp",
  "meta": { "fit": "Straight", "wash": "Rinse", "fabric": "…" }, "price": null }
```

Prices only appear when `"showPrices": true` is set at the top of the file.

## 5. Check

Reload the site, scroll to the lineup and look at the overview row: every pair of shoes should sit on one line.
`(cd scripts && node test.mjs)` re-captures the catalogue screenshots.
