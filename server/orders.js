// Orders: checkout (server-priced, stock-checked), customer lookup, admin status changes.

import { createHmac, timingSafeEqual } from 'node:crypto';
import { all, one, tx } from './db.js';
import { bad, notFound, HttpError, str, int, EMAIL } from './http.js';
import { unassignPiece, serial, pieceUrl } from './pieces.js';

export const STATUSES = ['pending', 'confirmed', 'packed', 'shipped', 'delivered', 'cancelled'];
const MAX_QTY = 5;

const tokenSecret = () => process.env.SESSION_SECRET || 'dev-only-session-secret-change-me-0000000000';
export const orderToken = (number) => createHmac('sha256', tokenSecret()).update(`order:${number}`).digest('base64url').slice(0, 22);
const tokenOk = (number, t) => {
  const want = Buffer.from(orderToken(number));
  const got = Buffer.from(String(t || ''));
  return want.length === got.length && timingSafeEqual(want, got);
};

export async function createOrder(body, settings) {
  if (!settings.shopOpen) throw bad('The shop is not open yet');
  const c = body.customer || {};
  const name = str(c.name, { min: 2, max: 120, name: 'Name' });
  const email = str(c.email, { min: 3, max: 200, name: 'Email' }).toLowerCase();
  if (!EMAIL.test(email)) throw bad('Please enter a valid email address');
  const phone = str(c.phone, { min: 7, max: 30, name: 'Phone' });
  if (!/^[+\d][\d\s-]{6,}$/.test(phone)) throw bad('Please enter a valid phone number');
  const a = c.address || {};
  const address = {
    line1: str(a.line1, { min: 3, max: 200, name: 'Address' }),
    line2: str(a.line2 ?? '', { max: 200 }),
    city: str(a.city, { min: 2, max: 80, name: 'City' }),
    province: str(a.province ?? '', { max: 80 }),
    postal: str(a.postal ?? '', { max: 20 }),
    country: 'Pakistan',
  };
  const certificateName = str(c.certificateName || name, { min: 1, max: 80, name: 'Name for your pieces' });
  const notes = str(c.notes ?? '', { max: 1000 });
  const paymentMethod = body.paymentMethod;
  if (!settings.paymentMethods.includes(paymentMethod)) throw bad('Choose a payment method');

  // Merge duplicate lines, validate quantities.
  const wanted = new Map();
  for (const it of Array.isArray(body.items) ? body.items : []) {
    const id = int(it.variantId, { min: 1, name: 'Item' });
    wanted.set(id, (wanted.get(id) || 0) + int(it.quantity, { min: 1, max: MAX_QTY, name: 'Quantity' }));
  }
  if (!wanted.size) throw bad('Your bag is empty');
  if (wanted.size > 20) throw bad('Too many lines');

  return tx(async (t) => {
    const lines = [];
    for (const [variantId, qty] of wanted) {
      if (qty > MAX_QTY) throw bad(`At most ${MAX_QTY} of one size per order`);
      const row = (await t.query(`
        SELECT v.id AS variant_id, v.size, v.stock, p.id AS product_id, p.name, p.article, p.price
        FROM variants v JOIN products p ON p.id = v.product_id
        WHERE v.id = $1 AND p.status = 'active' FOR UPDATE OF v`, [variantId])).rows[0];
      if (!row) throw bad('An item in your bag is no longer available', { variantId });
      if (row.stock < qty) {
        throw new HttpError(409, row.stock === 0 ? `${row.name} in size ${row.size} has just sold out` : `Only ${row.stock} left of ${row.name} in size ${row.size}`, { variantId, available: row.stock });
      }
      await t.query('UPDATE variants SET stock = stock - $2 WHERE id = $1', [variantId, qty]);
      lines.push({ ...row, qty });
    }
    const subtotal = lines.reduce((s, l) => s + l.price * l.qty, 0);
    const shipping = settings.freeShippingOver > 0 && subtotal >= settings.freeShippingOver ? 0 : settings.shippingFlat;
    const seq = (await t.query("SELECT nextval('order_number_seq')::int AS n")).rows[0].n;
    const number = `ARSH-${seq}`;
    const order = (await t.query(`
      INSERT INTO orders (number, payment_method, name, email, phone, address, certificate_name, notes, subtotal, shipping, total, currency)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *`,
    [number, paymentMethod, name, email, phone, JSON.stringify(address), certificateName, notes, subtotal, shipping, subtotal + shipping, settings.currency])).rows[0];
    const items = [];
    for (const l of lines) {
      items.push((await t.query(`
        INSERT INTO order_items (order_id, product_id, variant_id, name, article, size, unit_price, quantity)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [order.id, l.product_id, l.variant_id, l.name, l.article, l.size, l.price, l.qty])).rows[0]);
    }
    await t.query('INSERT INTO order_events (order_id, type, message, actor) VALUES ($1, $2, $3, $4)',
      [order.id, 'created', `Order placed — ${paymentMethod === 'cod' ? 'cash on delivery' : 'bank transfer'}`, 'customer']);
    return { order, items };
  });
}

async function loadOrder(where, params) {
  const order = await one(`SELECT * FROM orders WHERE ${where}`, params);
  if (!order) return null;
  const items = await all('SELECT * FROM order_items WHERE order_id = $1 ORDER BY id', [order.id]);
  const pieces = await all(`
    SELECT x.code, x.batch_id, x.seq, x.edition_number, x.order_item_id, x.assigned_at, x.assigned_by, p.edition_size
    FROM pieces x JOIN order_items oi ON oi.id = x.order_item_id JOIN products p ON p.id = x.product_id
    WHERE oi.order_id = $1 ORDER BY x.edition_number`, [order.id]);
  for (const it of items) {
    it.pieces = pieces.filter((p) => p.order_item_id === it.id).map((p) => ({ ...p, serial: serial(p.batch_id, p.seq) }));
  }
  return { order, items };
}

/** Customer view: needs the order number plus either the email on the order or the link token. */
export async function lookupOrder({ number, email, token }, base) {
  const n = str(number, { min: 3, max: 30, name: 'Order number' }).toUpperCase();
  const data = await loadOrder('upper(number) = $1', [n]);
  const ok = data && ((email && data.order.email === String(email).trim().toLowerCase()) || (token && tokenOk(data.order.number, token)));
  if (!ok) throw notFound('We could not find that order. Check the number and email.');
  const { order, items } = data;
  return {
    number: order.number, status: order.status, paymentMethod: order.payment_method, paymentStatus: order.payment_status,
    createdAt: order.created_at, name: order.name, certificateName: order.certificate_name,
    address: order.address, subtotal: order.subtotal, shipping: order.shipping, total: order.total, currency: order.currency,
    courier: order.courier, tracking: order.tracking, token: orderToken(order.number),
    items: items.map((i) => ({
      name: i.name, article: i.article, size: i.size, quantity: i.quantity, unitPrice: i.unit_price,
      pieces: i.pieces.map((p) => ({ url: pieceUrl(base, p.code), edition: p.edition_number, editionSize: p.edition_size })),
    })),
  };
}

export async function adminOrder(id) {
  const data = await loadOrder('id = $1', [id]);
  if (!data) throw notFound('Order not found');
  data.events = await all('SELECT * FROM order_events WHERE order_id = $1 ORDER BY created_at, id', [id]);
  data.complete = data.items.every((i) => i.pieces.length >= i.quantity);
  return data;
}

export async function listOrders({ status, search, page = 1 }) {
  const where = [], params = [];
  if (status && STATUSES.includes(status)) { params.push(status); where.push(`o.status = $${params.length}`); }
  if (search) {
    params.push(`%${search.toLowerCase()}%`);
    where.push(`(lower(o.number) LIKE $${params.length} OR lower(o.name) LIKE $${params.length} OR lower(o.email) LIKE $${params.length} OR o.phone LIKE $${params.length})`);
  }
  const limit = 30, offset = (Math.max(1, page) - 1) * limit;
  const rows = await all(`
    SELECT o.id, o.number, o.status, o.payment_method, o.payment_status, o.name, o.email, o.total, o.currency, o.created_at,
      (SELECT coalesce(sum(quantity), 0)::int FROM order_items WHERE order_id = o.id) AS units,
      (SELECT count(*)::int FROM pieces x JOIN order_items oi ON oi.id = x.order_item_id WHERE oi.order_id = o.id) AS registered
    FROM orders o ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY o.created_at DESC, o.id DESC LIMIT ${limit + 1} OFFSET ${offset}`, params);
  return { orders: rows.slice(0, limit), more: rows.length > limit };
}

/** Admin edits. Moving to packed/shipped/delivered requires every unit to have its QR piece registered. */
export async function updateOrder(id, body, admin) {
  return tx(async (t) => {
    const order = (await t.query('SELECT * FROM orders WHERE id = $1 FOR UPDATE', [id])).rows[0];
    if (!order) throw notFound('Order not found');
    const events = [];
    const set = {};

    if (body.status && body.status !== order.status) {
      if (!STATUSES.includes(body.status)) throw bad('Invalid status');
      if (order.status === 'cancelled') throw bad('A cancelled order cannot be reopened');
      if (['packed', 'shipped', 'delivered'].includes(body.status) && !body.force) {
        const gap = (await t.query(`
          SELECT coalesce(sum(oi.quantity), 0)::int - (SELECT count(*)::int FROM pieces x JOIN order_items i ON i.id = x.order_item_id WHERE i.order_id = $1) AS missing
          FROM order_items oi WHERE oi.order_id = $1`, [id])).rows[0].missing;
        if (gap > 0) throw new HttpError(422, `Scan ${gap} more piece${gap > 1 ? 's' : ''} before marking this order ${body.status}`, { missing: gap });
      }
      if (body.status === 'cancelled') {
        const items = (await t.query('SELECT * FROM order_items WHERE order_id = $1', [id])).rows;
        for (const it of items) await t.query('UPDATE variants SET stock = stock + $2 WHERE id = $1', [it.variant_id, it.quantity]);
        const codes = (await t.query('SELECT x.code FROM pieces x JOIN order_items oi ON oi.id = x.order_item_id WHERE oi.order_id = $1', [id])).rows;
        for (const c of codes) await unassignPiece(c.code, admin, t);
        events.push(['status', 'Order cancelled — stock restored' + (codes.length ? `, ${codes.length} piece(s) released` : '')]);
      } else {
        events.push(['status', `Status: ${order.status} → ${body.status}`]);
      }
      set.status = body.status;
    }
    if (body.paymentStatus && body.paymentStatus !== order.payment_status) {
      if (!['unpaid', 'paid', 'refunded'].includes(body.paymentStatus)) throw bad('Invalid payment status');
      set.payment_status = body.paymentStatus;
      events.push(['payment', `Payment: ${order.payment_status} → ${body.paymentStatus}`]);
    }
    for (const k of ['tracking', 'courier']) {
      if (body[k] !== undefined && body[k] !== order[k]) {
        set[k] = str(body[k], { max: 120 });
        events.push(['shipping', `${k === 'tracking' ? 'Tracking' : 'Courier'}: ${set[k] || '—'}`]);
      }
    }
    if (body.certificateName !== undefined && body.certificateName !== order.certificate_name) {
      set.certificate_name = str(body.certificateName, { min: 1, max: 80, name: 'Certificate name' });
      await t.query(`UPDATE pieces SET owner_name = $2 WHERE order_item_id IN (SELECT id FROM order_items WHERE order_id = $1)`, [id, set.certificate_name]);
      events.push(['edit', `Name on pieces: ${set.certificate_name}`]);
    }
    if (body.note) events.push(['note', str(body.note, { max: 1000 })]);

    const keys = Object.keys(set);
    if (keys.length) {
      await t.query(`UPDATE orders SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')}, updated_at = now() WHERE id = $1`, [id, ...keys.map((k) => set[k])]);
    }
    for (const [type, message] of events) {
      await t.query('INSERT INTO order_events (order_id, type, message, actor) VALUES ($1, $2, $3, $4)', [id, type, message, admin.email]);
    }
    return { before: order, changed: set };
  });
}

export async function dashboard() {
  const byStatus = await all('SELECT status, count(*)::int AS n FROM orders GROUP BY status');
  const sales = await one(`
    SELECT coalesce(sum(total), 0)::int AS revenue, count(*)::int AS orders
    FROM orders WHERE status <> 'cancelled' AND created_at > now() - interval '30 days'`);
  const pieces = await one(`
    SELECT count(*) FILTER (WHERE status = 'assigned')::int AS assigned,
           count(*) FILTER (WHERE status = 'unassigned')::int AS blank FROM pieces`);
  const toScan = await one(`
    SELECT count(*)::int AS n FROM orders o WHERE o.status IN ('pending', 'confirmed') AND
      (SELECT coalesce(sum(quantity), 0) FROM order_items WHERE order_id = o.id) >
      (SELECT count(*) FROM pieces x JOIN order_items oi ON oi.id = x.order_item_id WHERE oi.order_id = o.id)`);
  const lowStock = await all(`
    SELECT p.name, p.article, v.size, v.stock FROM variants v JOIN products p ON p.id = v.product_id
    WHERE p.status = 'active' AND v.stock <= 2 ORDER BY v.stock, p.sort LIMIT 12`);
  const recent = (await listOrders({})).orders.slice(0, 8);
  const waitlist = await one("SELECT count(*) FILTER (WHERE status = 'waiting')::int AS waiting, count(*)::int AS total FROM waitlist");
  return { waitlist, byStatus: Object.fromEntries(byStatus.map((r) => [r.status, r.n])), sales, pieces, toScan: toScan.n, lowStock, recent };
}
