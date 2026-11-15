// Product images: the lineup cutout (products.image) and a gallery (product_images).
// Every upload is re-encoded with sharp: orientation fixed, metadata stripped, sized, WebP.

import sharp from 'sharp';
import { all, one, q, tx } from './db.js';
import { bad, notFound, HttpError } from './http.js';
import { putFile, removeFile } from './storage.js';

export const MAX_UPLOAD = 4 * 1024 * 1024; // Vercel's request body limit is 4.5 MB

// Lineup canvas, 2× the CSS spec in scripts/cutout.md: 1200 × 3000, soles on y = 2924.
const CUT = { W: 1200, H: 3000, BASE: 2924, FIGURE_H: 2800 };

export async function readRaw(req) {
  if (Buffer.isBuffer(req.body)) return req.body;
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > MAX_UPLOAD) throw new HttpError(413, 'Image is larger than 4 MB. It is resized in the browser first; try a smaller original.');
    chunks.push(c);
  }
  return Buffer.concat(chunks);
}

async function decode(buf) {
  try {
    const img = sharp(buf, { failOn: 'error' }).rotate();
    const meta = await img.metadata();
    if (!meta.width || !meta.height) throw new Error('no size');
    if (meta.width * meta.height > 60e6) throw bad('Image is too large');
    return { img, meta };
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw bad('That file is not an image we can read (use JPG, PNG or WebP)');
  }
}

/**
 * Lineup cutout. Needs a transparent background. With normalise on, it trims to the figure,
 * scales it to the standard height and puts the soles on the shared baseline.
 */
export async function processCutout(buf, { normalise = true } = {}) {
  const { img, meta } = await decode(buf);
  const warnings = [];
  const opaque = !meta.hasAlpha || (await sharp(buf).rotate().stats()).isOpaque;
  if (opaque) warnings.push('This image has no transparent background, so it will show as a box in the lineup. Remove the background first (see the cutout guide).');
  let out;
  if (normalise && !opaque) {
    const trimmed = await img.clone().ensureAlpha().trim({ threshold: 1 }).toBuffer({ resolveWithObject: true });
    const fig = await sharp(trimmed.data).resize({ height: CUT.FIGURE_H, width: CUT.W, fit: 'inside' }).toBuffer({ resolveWithObject: true });
    out = await sharp({ create: { width: CUT.W, height: CUT.H, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite([{ input: fig.data, left: Math.round((CUT.W - fig.info.width) / 2), top: CUT.BASE - fig.info.height }])
      .webp({ quality: 86, alphaQuality: 92, effort: 5 }).toBuffer({ resolveWithObject: true });
  } else {
    out = await img.resize({ width: CUT.W, height: CUT.H, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 86, alphaQuality: 92, effort: 5 }).toBuffer({ resolveWithObject: true });
  }
  return { buffer: out.data, width: out.info.width, height: out.info.height, warnings };
}

export async function processGallery(buf) {
  const { img } = await decode(buf);
  const out = await img.resize({ width: 2000, height: 2000, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 82, effort: 5 }).toBuffer({ resolveWithObject: true });
  return { buffer: out.data, width: out.info.width, height: out.info.height, warnings: [] };
}

const productOr404 = async (id) => {
  const p = await one('SELECT id, slug, image FROM products WHERE id = $1', [id]);
  if (!p) throw notFound('Product not found');
  return p;
};

export async function uploadImage(productId, buf, { kind, normalise }) {
  const p = await productOr404(productId);
  if (!buf.length) throw bad('No image received');
  if (kind === 'cutout') {
    const r = await processCutout(buf, { normalise });
    const url = await putFile(`${p.slug}-cutout`, r.buffer, 'image/webp');
    await q('UPDATE products SET image = $2, updated_at = now() WHERE id = $1', [p.id, url]);
    // Old uploaded cutouts are kept: past orders and piece pages may still point at them.
    return { url, warnings: r.warnings };
  }
  if (kind === 'gallery') {
    const count = await one('SELECT count(*)::int AS n FROM product_images WHERE product_id = $1', [p.id]);
    if (count.n >= 12) throw bad('A product can have up to 12 gallery images');
    const r = await processGallery(buf);
    const url = await putFile(`${p.slug}`, r.buffer, 'image/webp');
    const row = await one(`INSERT INTO product_images (product_id, url, width, height, sort)
      VALUES ($1, $2, $3, $4, (SELECT coalesce(max(sort), 0) + 1 FROM product_images WHERE product_id = $1)) RETURNING *`,
    [p.id, url, r.width, r.height]);
    return { image: row, warnings: [] };
  }
  throw bad('Unknown image kind');
}

export async function updateImage(productId, imageId, { alt }) {
  const row = await one('UPDATE product_images SET alt = $3 WHERE id = $2 AND product_id = $1 RETURNING *',
    [productId, imageId, String(alt ?? '').trim().slice(0, 200)]);
  if (!row) throw notFound('Image not found');
  return row;
}

export async function reorderImages(productId, ids) {
  if (!Array.isArray(ids)) throw bad('ids must be a list');
  await tx(async (t) => {
    for (const [i, id] of ids.entries()) {
      await t.query('UPDATE product_images SET sort = $3 WHERE id = $2 AND product_id = $1', [productId, Number(id), i + 1]);
    }
  });
  return listImages(productId);
}

export async function deleteImage(productId, imageId) {
  const row = await one('DELETE FROM product_images WHERE id = $2 AND product_id = $1 RETURNING url', [productId, imageId]);
  if (!row) throw notFound('Image not found');
  await removeFile(row.url);
  return { ok: true };
}

export const listImages = (productId) => all('SELECT * FROM product_images WHERE product_id = $1 ORDER BY sort, id', [productId]);
