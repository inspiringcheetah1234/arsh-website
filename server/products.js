import { all, one, tx } from './db.js';
import { bad, notFound, str, int } from './http.js';

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export async function listProducts({ includeAll = false } = {}) {
  const products = await all(
    `SELECT * FROM products ${includeAll ? '' : "WHERE status = 'active'"} ORDER BY sort, id`);
  const variants = await all('SELECT * FROM variants ORDER BY product_id, sort, id');
  const images = await all('SELECT * FROM product_images ORDER BY product_id, sort, id');
  const sold = includeAll ? await all(
    `SELECT product_id, count(*)::int AS registered FROM pieces WHERE status = 'assigned' GROUP BY product_id`) : [];
  return products.map((p) => ({
    ...p,
    registered: sold.find((s) => s.product_id === p.id)?.registered ?? 0,
    variants: variants.filter((v) => v.product_id === p.id),
    images: images.filter((i) => i.product_id === p.id),
  }));
}

/** Public shape: no raw stock numbers, just availability. */
export function publicProduct(p) {
  return {
    id: p.id, slug: p.slug, article: p.article, name: p.name, description: p.description,
    meta: { fit: p.fit, wash: p.wash, fabric: p.fabric }, image: p.image, price: p.price,
    editionSize: p.edition_size,
    gallery: p.images.map((i) => ({ url: i.url, alt: i.alt, width: i.width, height: i.height })),
    variants: p.variants.map((v) => ({ id: v.id, size: v.size, available: v.stock > 0, low: v.stock > 0 && v.stock <= 2 })),
  };
}

function productFields(body, partial) {
  const f = {};
  const want = (k) => !partial || body[k] !== undefined;
  if (want('name')) f.name = str(body.name, { min: 1, max: 120, name: 'Name' });
  if (want('slug')) {
    f.slug = str(body.slug, { min: 1, max: 80, name: 'Slug' }).toLowerCase();
    if (!SLUG.test(f.slug)) throw bad('Slug may only use a–z, 0–9 and hyphens');
  }
  if (want('article')) f.article = str(body.article, { min: 1, max: 20, name: 'Article code' }).toUpperCase();
  if (want('description')) f.description = str(body.description ?? '', { max: 4000 });
  for (const k of ['fit', 'wash', 'fabric']) if (want(k)) f[k] = str(body[k] ?? '', { max: 120 });
  if (want('price')) f.price = int(body.price, { min: 0, max: 10_000_000, name: 'Price' });
  if (want('edition_size')) f.edition_size = int(body.edition_size, { min: 1, max: 100_000, name: 'Edition size' });
  if (want('image')) f.image = str(body.image ?? '', { max: 300 });
  if (want('status')) {
    if (!['active', 'draft', 'archived'].includes(body.status)) throw bad('Invalid status');
    f.status = body.status;
  }
  if (want('sort')) f.sort = int(body.sort ?? 0, { name: 'Sort' });
  return f;
}

async function saveVariants(t, productId, variants) {
  if (!Array.isArray(variants)) return;
  const seen = new Set();
  for (const [i, v] of variants.entries()) {
    const size = str(v.size, { min: 1, max: 20, name: 'Size' });
    if (seen.has(size)) throw bad(`Size ${size} is listed twice`);
    seen.add(size);
    const stock = int(v.stock ?? 0, { min: 0, max: 100_000, name: `Stock for ${size}` });
    await t.query(
      `INSERT INTO variants (product_id, size, stock, sort) VALUES ($1, $2, $3, $4)
       ON CONFLICT (product_id, size) DO UPDATE SET stock = EXCLUDED.stock, sort = EXCLUDED.sort`,
      [productId, size, stock, i]);
  }
  // Remove sizes no longer listed, unless they were ever ordered.
  const keep = [...seen];
  await t.query(
    `DELETE FROM variants WHERE product_id = $1 AND NOT (size = ANY($2::text[]))
       AND id NOT IN (SELECT variant_id FROM order_items)`, [productId, keep]);
}

const uniqueMessage = (err) => {
  if (err.code !== '23505') return null;
  if (/slug/.test(err.detail || err.message)) return 'That slug is already used';
  if (/article/.test(err.detail || err.message)) return 'That article code is already used';
  return 'Duplicate value';
};

export async function createProduct(body) {
  const f = productFields(body, false);
  try {
    return await tx(async (t) => {
      const keys = Object.keys(f);
      const { rows } = await t.query(
        `INSERT INTO products (${keys.join(', ')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`,
        keys.map((k) => f[k]));
      await saveVariants(t, rows[0].id, body.variants);
      return rows[0].id;
    });
  } catch (err) {
    const m = uniqueMessage(err);
    throw m ? bad(m) : err;
  }
}

export async function updateProduct(id, body) {
  const f = productFields(body, true);
  const existing = await one('SELECT id, edition_size FROM products WHERE id = $1', [id]);
  if (!existing) throw notFound('Product not found');
  if (f.edition_size !== undefined) {
    const top = await one('SELECT coalesce(max(edition_number), 0)::int AS n FROM pieces WHERE product_id = $1', [id]);
    if (f.edition_size < top.n) throw bad(`Edition size cannot be below ${top.n}: that number is already registered`);
  }
  try {
    await tx(async (t) => {
      const keys = Object.keys(f);
      if (keys.length) {
        await t.query(
          `UPDATE products SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')}, updated_at = now() WHERE id = $1`,
          [id, ...keys.map((k) => f[k])]);
      }
      await saveVariants(t, id, body.variants);
    });
  } catch (err) {
    const m = uniqueMessage(err);
    throw m ? bad(m) : err;
  }
  return id;
}
