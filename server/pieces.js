// QR pieces: batch generation, the public "passport" lookup, and scan-to-assign at fulfilment.

import { randomInt } from 'node:crypto';
import QRCode from 'qrcode';
import { all, one, q, tx } from './db.js';
import { bad, notFound, HttpError } from './http.js';
import { displayOwner } from './settings.js';

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I/L
const CODE_LEN = 10;                                  // 31^10 ≈ 8×10^14: not guessable
export const BATCH_SIZE = 250;

const newCode = () => Array.from({ length: CODE_LEN }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
export const pieceUrl = (base, code) => `${base}/p/${code}`;
export const serial = (batchId, seq) => `B${String(batchId).padStart(3, '0')}-${String(seq).padStart(3, '0')}`;

/** Accepts a raw code or any URL ending in /p/<code> (what the QR actually contains). */
export function parseCode(input) {
  const s = String(input || '').trim();
  const m = s.match(/\/p\/([A-Za-z0-9]+)\/?(?:[?#].*)?$/) || s.match(/^([A-Za-z0-9]{6,20})$/);
  if (!m) throw bad('That is not an ARSH code');
  return m[1].toUpperCase();
}

export async function createBatch({ size = BATCH_SIZE, label = '', productId = null, admin }) {
  if (!Number.isInteger(size) || size < 1 || size > 1000) throw bad('Batch size must be 1–1000');
  if (productId) {
    const p = await one('SELECT id FROM products WHERE id = $1', [productId]);
    if (!p) throw bad('Unknown product');
  }
  return tx(async (t) => {
    const { rows } = await t.query(
      'INSERT INTO qr_batches (label, size, product_id, created_by) VALUES ($1, $2, $3, $4) RETURNING *',
      [label || '', size, productId || null, admin?.email || '']);
    const batch = rows[0];
    if (!label) await t.query('UPDATE qr_batches SET label = $2 WHERE id = $1', [batch.id, `Batch ${String(batch.id).padStart(3, '0')}`]);
    // Insert in chunks; regenerate on the (astronomically unlikely) collision.
    for (let start = 1; start <= size; start += 100) {
      const n = Math.min(100, size - start + 1);
      const values = [], params = [];
      for (let i = 0; i < n; i++) {
        params.push(newCode(), batch.id, start + i);
        values.push(`($${params.length - 2}, $${params.length - 1}, $${params.length})`);
      }
      await t.query(`INSERT INTO pieces (code, batch_id, seq) VALUES ${values.join(', ')}`, params);
    }
    return batch.id;
  });
}

export async function listBatches() {
  return all(`
    SELECT b.*, p.name AS product_name, p.article,
      count(x.id)::int AS total,
      count(x.id) FILTER (WHERE x.status = 'assigned')::int AS assigned,
      count(x.id) FILTER (WHERE x.status = 'void')::int AS void
    FROM qr_batches b
    LEFT JOIN products p ON p.id = b.product_id
    LEFT JOIN pieces x ON x.batch_id = b.id
    GROUP BY b.id, p.name, p.article
    ORDER BY b.id DESC`);
}

export async function batchPieces(batchId) {
  const batch = await one(`SELECT b.*, p.name AS product_name, p.article FROM qr_batches b LEFT JOIN products p ON p.id = b.product_id WHERE b.id = $1`, [batchId]);
  if (!batch) throw notFound('Batch not found');
  const pieces = await all(`
    SELECT x.code, x.seq, x.status, x.edition_number, x.owner_name, x.assigned_at, p.article, p.edition_size, o.number AS order_number, o.id AS order_id
    FROM pieces x
    LEFT JOIN products p ON p.id = x.product_id
    LEFT JOIN order_items oi ON oi.id = x.order_item_id
    LEFT JOIN orders o ON o.id = oi.order_id
    WHERE x.batch_id = $1 ORDER BY x.seq`, [batchId]);
  return { batch, pieces };
}

export async function qrSvg(text, { margin = 1 } = {}) {
  return QRCode.toString(text, { type: 'svg', errorCorrectionLevel: 'M', margin, color: { dark: '#14161A', light: '#0000' } });
}

/** Printable A4 label sheet: 5 × 8 = 40 labels a page, each with its QR and small serial. */
export async function batchSheet(batchId, base) {
  const { batch, pieces } = await batchPieces(batchId);
  const cells = await Promise.all(pieces.map(async (p) => `
    <div class="l"><div class="q">${await qrSvg(pieceUrl(base, p.code), { margin: 0 })}</div>
    <div class="s">${serial(batch.id, p.seq)}</div></div>`));
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${batch.label} — QR labels</title>
<style>
  @page { size: A4; margin: 10mm; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 7pt/1.2 "Helvetica Neue", Arial, sans-serif; color: #14161A; background: #fff; }
  header { display: flex; justify-content: space-between; padding: 0 0 4mm; font-size: 8pt; letter-spacing: .15em; text-transform: uppercase; }
  .g { display: grid; grid-template-columns: repeat(5, 1fr); gap: 4mm 3mm; }
  .l { border: .2mm dashed #bbb; padding: 2.5mm; text-align: center; break-inside: avoid; }
  .q svg { width: 22mm; height: 22mm; display: block; margin: 0 auto; }
  .s { margin-top: 1.5mm; letter-spacing: .12em; }
  @media screen { body { padding: 10mm; max-width: 210mm; margin: auto; } }
</style></head><body>
<header><span>ARSH BY HZK — ${batch.label}</span><span>${pieces.length} codes${batch.article ? ` · ${batch.article}` : ''}</span></header>
<div class="g">${cells.join('')}</div>
<script>addEventListener('load', () => setTimeout(() => print(), 300));</script>
</body></html>`;
}

export async function batchCsv(batchId, base) {
  const { batch, pieces } = await batchPieces(batchId);
  const rows = [['serial', 'code', 'url', 'status', 'article', 'edition_number', 'order']];
  for (const p of pieces) rows.push([serial(batch.id, p.seq), p.code, pieceUrl(base, p.code), p.status, p.article || '', p.edition_number ?? '', p.order_number || '']);
  return rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n') + '\n';
}

/** What anyone sees when they scan a piece. */
export async function publicPiece(code, settings) {
  const row = await one(`
    SELECT x.code, x.status, x.edition_number, x.owner_name, x.purchased_at,
      p.name, p.article, p.fit, p.wash, p.fabric, p.image, p.edition_size, p.slug
    FROM pieces x LEFT JOIN products p ON p.id = x.product_id WHERE x.code = $1`, [code]);
  if (!row) throw notFound('Unknown piece');
  q('UPDATE pieces SET scans = scans + 1 WHERE code = $1', [code]).catch(() => {});
  if (row.status !== 'assigned') return { code: row.code, status: row.status === 'void' ? 'void' : 'unregistered' };
  return {
    code: row.code, status: 'registered',
    article: row.article, name: row.name, slug: row.slug, image: row.image,
    meta: { fit: row.fit, wash: row.wash, fabric: row.fabric },
    edition: { number: row.edition_number, size: row.edition_size },
    owner: displayOwner(row.owner_name, settings.ownerDisplay),
    purchasedAt: row.purchased_at,
  };
}

export async function adminPiece(code) {
  const row = await one(`
    SELECT x.*, b.label AS batch_label, b.product_id AS batch_product_id, p.name AS product_name, p.article, p.edition_size,
      o.id AS order_id, o.number AS order_number, oi.size
    FROM pieces x
    JOIN qr_batches b ON b.id = x.batch_id
    LEFT JOIN products p ON p.id = x.product_id
    LEFT JOIN order_items oi ON oi.id = x.order_item_id
    LEFT JOIN orders o ON o.id = oi.order_id
    WHERE x.code = $1`, [code]);
  if (!row) throw notFound('Unknown code');
  return { ...row, serial: serial(row.batch_id, row.seq) };
}

/**
 * Scan-to-assign. Binds one physical piece (its QR code) to one unit of an order line:
 * sets article, owner, purchase date and the next free edition number ("No. 017 / 250").
 * If itemId is omitted and exactly one line still needs pieces, that line is used.
 */
export async function assignPiece({ code, orderId, itemId = null, admin }) {
  const attempt = () => tx(async (t) => {
    const piece = (await t.query(
      `SELECT x.*, b.product_id AS batch_product_id FROM pieces x JOIN qr_batches b ON b.id = x.batch_id WHERE x.code = $1 FOR UPDATE OF x`, [code])).rows[0];
    if (!piece) throw notFound(`Code ${code} is not in the system`);
    if (piece.status === 'void') throw bad(`Code ${serial(piece.batch_id, piece.seq)} has been voided`);

    const order = (await t.query('SELECT * FROM orders WHERE id = $1 FOR UPDATE', [orderId])).rows[0];
    if (!order) throw notFound('Order not found');
    if (order.status === 'cancelled') throw bad('This order is cancelled');

    const lines = (await t.query(`
      SELECT oi.*, p.edition_size, (SELECT count(*)::int FROM pieces x WHERE x.order_item_id = oi.id) AS assigned
      FROM order_items oi JOIN products p ON p.id = oi.product_id WHERE oi.order_id = $1 ORDER BY oi.id`, [orderId])).rows;

    if (piece.status === 'assigned') {
      const mine = lines.find((l) => l.id === piece.order_item_id);
      if (mine) return { already: true, code, edition: piece.edition_number, itemId: mine.id };
      const other = (await t.query('SELECT o.number FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE oi.id = $1', [piece.order_item_id])).rows[0];
      throw new HttpError(409, `This piece is already registered to order ${other?.number ?? '—'}`);
    }

    let line;
    if (itemId) {
      line = lines.find((l) => l.id === Number(itemId));
      if (!line) throw bad('That line is not part of this order');
    } else {
      let open = lines.filter((l) => l.assigned < l.quantity);
      if (piece.batch_product_id) open = open.filter((l) => l.product_id === piece.batch_product_id);
      if (open.length === 0) throw bad('Every piece in this order is already registered');
      if (open.length > 1) throw new HttpError(422, 'Choose which line this piece belongs to', { needsItem: true });
      line = open[0];
    }
    if (line.assigned >= line.quantity) throw bad(`All ${line.quantity} piece(s) for ${line.article} size ${line.size} are already registered`);
    if (piece.batch_product_id && piece.batch_product_id !== line.product_id) throw bad('This code belongs to a batch reserved for a different article');

    const next = (await t.query(`
      SELECT n FROM generate_series(1, $2::int) AS n
      WHERE NOT EXISTS (SELECT 1 FROM pieces WHERE product_id = $1 AND edition_number = n)
      ORDER BY n LIMIT 1`, [line.product_id, line.edition_size])).rows[0];
    if (!next) throw bad(`Edition for ${line.article} is complete (${line.edition_size} of ${line.edition_size})`);

    await t.query(`
      UPDATE pieces SET status = 'assigned', product_id = $2, order_item_id = $3, edition_number = $4,
        owner_name = $5, purchased_at = $6, assigned_at = now(), assigned_by = $7
      WHERE id = $1`, [piece.id, line.product_id, line.id, next.n, order.certificate_name, order.created_at, admin?.email || '']);
    const msg = `Registered ${serial(piece.batch_id, piece.seq)} → ${line.article} size ${line.size}, No. ${String(next.n).padStart(3, '0')} / ${line.edition_size}`;
    await t.query('INSERT INTO order_events (order_id, type, message, actor) VALUES ($1, $2, $3, $4)', [orderId, 'piece', msg, admin?.email || '']);
    return { code, edition: next.n, editionSize: line.edition_size, itemId: line.id, serial: serial(piece.batch_id, piece.seq), message: msg };
  });
  // Two staff assigning the same article at the same instant can collide on (product, edition_number): retry.
  for (let i = 0; ; i++) {
    try { return await attempt(); } catch (err) { if (err.code !== '23505' || i >= 3) throw err; }
  }
}

export async function unassignPiece(code, admin, t = null) {
  const run = async (tt) => {
    const piece = (await tt.query(`
      SELECT x.*, oi.order_id FROM pieces x LEFT JOIN order_items oi ON oi.id = x.order_item_id WHERE x.code = $1 FOR UPDATE OF x`, [code])).rows[0];
    if (!piece) throw notFound('Unknown code');
    if (piece.status !== 'assigned') return { ok: true };
    await tt.query(`UPDATE pieces SET status = 'unassigned', product_id = NULL, order_item_id = NULL, edition_number = NULL,
      owner_name = NULL, purchased_at = NULL, assigned_at = NULL, assigned_by = NULL WHERE id = $1`, [piece.id]);
    await tt.query('INSERT INTO order_events (order_id, type, message, actor) VALUES ($1, $2, $3, $4)',
      [piece.order_id, 'piece', `Released ${serial(piece.batch_id, piece.seq)} (was No. ${piece.edition_number})`, admin?.email || 'system']);
    return { ok: true };
  };
  return t ? run(t) : tx(run);
}

export async function voidPiece(code, admin) {
  const piece = await one('SELECT status FROM pieces WHERE code = $1', [code]);
  if (!piece) throw notFound('Unknown code');
  if (piece.status === 'assigned') throw bad('Release this code from its order before voiding it');
  await q("UPDATE pieces SET status = 'void', assigned_by = $2 WHERE code = $1", [code, admin?.email || '']);
  return { ok: true };
}
