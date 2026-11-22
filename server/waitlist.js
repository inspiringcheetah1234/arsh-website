// Waitlist: public signup (landing quick form + the full /waitlist page) and the admin side
// (list, notes, status, bulk invite, CSV export).

import { all, one, q } from './db.js';
import { bad, notFound, str, int, EMAIL } from './http.js';

const PHONE = /^[+\d][\d\s-]{6,}$/;
export const INTERESTS = ['The brand', 'The product', 'Events', 'Something else'];
const SOURCES = ['landing', 'waitlist', 'product'];
export const STATUSES = ['waiting', 'invited', 'removed'];
export const pad = (n) => String(n).padStart(4, '0');

/**
 * Adds someone to the list. The landing form sends just an email; the /waitlist page (source "waitlist")
 * also requires a name and explicit consent. An email that is already on the list is never overwritten:
 * only blank fields are filled in, and a removed entry is reactivated (they asked again).
 */
export async function joinWaitlist(body) {
  if (body.company) return { honeypot: true }; // bots fill the hidden field
  const source = SOURCES.includes(body.source) ? body.source : 'landing';
  const strict = source === 'waitlist';

  const email = str(body.email, { min: 3, max: 200, name: 'Email' }).toLowerCase();
  if (!EMAIL.test(email)) throw bad('Please enter a valid email address');
  const name = strict ? str(body.name, { min: 2, max: 120, name: 'Name' }) : str(body.name ?? '', { max: 120 });
  const phone = str(body.phone ?? '', { max: 30 });
  if (strict && !phone) throw bad('Please enter your WhatsApp or phone number');
  if (phone && !PHONE.test(phone)) throw bad('Please enter a valid phone number');
  const interest = str(body.interest ?? '', { max: 40 });
  if (interest && !INTERESTS.includes(interest)) throw bad('Please choose what you are interested in');
  const city = str(body.city ?? '', { max: 80 });
  const size = str(body.size ?? '', { max: 10 });
  const heardFrom = str(body.heardFrom ?? '', { max: 120 });
  if (strict && body.consent !== true) throw bad('Please tick the box so we know we may write to you');

  let productId = null;
  if (body.productId) {
    productId = int(body.productId, { min: 1, name: 'Piece' });
    if (!(await one("SELECT id FROM products WHERE id = $1 AND status = 'active'", [productId]))) throw bad('That piece is not available');
  }

  const refresh = async (entry) => {
    await q(`UPDATE waitlist SET
        name = CASE WHEN name = '' THEN $2 ELSE name END,
        phone = CASE WHEN phone = '' THEN $3 ELSE phone END,
        city = CASE WHEN city = '' THEN $4 ELSE city END,
        product_id = coalesce(product_id, $5),
        size = CASE WHEN size = '' THEN $6 ELSE size END,
        heard_from = CASE WHEN heard_from = '' THEN $7 ELSE heard_from END,
        interest = CASE WHEN interest = '' THEN $8 ELSE interest END,
        status = CASE WHEN status = 'removed' THEN 'waiting' ELSE status END,
        updated_at = now()
      WHERE id = $1`, [entry.id, name, phone, city, productId, size, heardFrom, interest]);
    return { created: false };
  };

  const existing = await one('SELECT * FROM waitlist WHERE lower(email) = $1', [email]);
  if (existing) return refresh(existing);
  try {
    const entry = await one(`INSERT INTO waitlist (email, name, phone, city, product_id, size, heard_from, source, interest)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`, [email, name, phone, city, productId, size, heardFrom, source, interest]);
    const product = productId ? await one('SELECT article, name FROM products WHERE id = $1', [productId]) : null;
    return { created: true, entry: { ...entry, article: product?.article, product_name: product?.name } };
  } catch (err) {
    if (err.code !== '23505') throw err;
    return refresh(await one('SELECT * FROM waitlist WHERE lower(email) = $1', [email])); // lost a race with the same email
  }
}

// ---------------------------------------------------------------- admin
const BASE = `
  SELECT w.*, p.article, p.name AS product_name,
    EXISTS (SELECT 1 FROM orders o WHERE lower(o.email) = lower(w.email) AND o.status <> 'cancelled') AS has_order
  FROM waitlist w LEFT JOIN products p ON p.id = w.product_id`;

function filters({ status, search }) {
  const where = [], params = [];
  if (status && STATUSES.includes(status)) { params.push(status); where.push(`w.status = $${params.length}`); }
  if (search) {
    params.push(`%${search.toLowerCase()}%`);
    where.push(`(lower(w.email) LIKE $${params.length} OR lower(w.name) LIKE $${params.length} OR w.phone LIKE $${params.length} OR lower(w.city) LIKE $${params.length})`);
  }
  return { sql: where.length ? ' WHERE ' + where.join(' AND ') : '', params };
}

export async function listWaitlist({ status, search, page = 1 }) {
  const { sql, params } = filters({ status, search });
  const limit = 30, offset = (Math.max(1, page) - 1) * limit;
  const rows = await all(`${BASE}${sql} ORDER BY w.number DESC LIMIT ${limit + 1} OFFSET ${offset}`, params);
  const counts = await one(`SELECT count(*) FILTER (WHERE status = 'waiting')::int AS waiting,
      count(*) FILTER (WHERE status = 'invited')::int AS invited,
      count(*) FILTER (WHERE status = 'removed')::int AS removed,
      count(*) FILTER (WHERE created_at > now() - interval '7 days')::int AS last7,
      count(*)::int AS total FROM waitlist`);
  return { entries: rows.slice(0, limit), more: rows.length > limit, counts };
}

export async function updateEntry(id, body) {
  const sets = [], params = [id];
  if (body.status !== undefined) {
    if (!STATUSES.includes(body.status)) throw bad('Invalid status');
    params.push(body.status); sets.push(`status = $${params.length}`);
  }
  if (body.note !== undefined) { params.push(str(body.note, { max: 1000 })); sets.push(`note = $${params.length}`); }
  if (!sets.length) throw bad('Nothing to change');
  const row = await one(`UPDATE waitlist SET ${sets.join(', ')}, updated_at = now() WHERE id = $1 RETURNING id`, params);
  if (!row) throw notFound('Entry not found');
  return one(`${BASE} WHERE w.id = $1`, [id]);
}

/** Wipes the whole list and restarts numbering at 0001 (admin only; the route demands a typed confirmation). */
export async function resetWaitlist() {
  const { n } = await one('SELECT count(*)::int AS n FROM waitlist');
  await q('DELETE FROM waitlist');
  await q('ALTER SEQUENCE waitlist_number_seq RESTART WITH 1');
  return { deleted: n };
}

/**
 * Sends a message to the list in batches (a serverless call has a time limit, so the admin page calls this repeatedly with the same
 * broadcast id until `remaining` is 0). Each person is recorded in email_events as 'bc-<id>', so nobody is emailed twice.
 */
export async function sendBroadcast({ id, subject, message, audience, base, limit = 40, dryRun = false }, send, build) {
  const statuses = audience === 'all' ? ['waiting', 'invited'] : ['waiting'];
  const kind = `bc-${id}`;
  const rows = await all(`SELECT w.* FROM waitlist w
    WHERE w.status = ANY($1::text[]) AND NOT EXISTS (SELECT 1 FROM email_events e WHERE e.waitlist_id = w.id AND e.kind = $2)
    ORDER BY w.number LIMIT ${dryRun ? 100000 : limit + 1}`, [statuses, kind]);
  if (dryRun) return { count: rows.length };
  const batch = rows.slice(0, limit);
  let sent = 0, failed = 0;
  for (const entry of batch) {
    const status = await send(build(entry, { subject, message, base }));
    if (status === 'sent' || status === 'logged') {
      await q('INSERT INTO email_events (waitlist_id, kind) VALUES ($1, $2) ON CONFLICT DO NOTHING', [entry.id, kind]);
      sent++;
    } else failed++;
  }
  return { sent, failed, remaining: rows.length > limit ? 1 : (failed ? failed : 0) };
}

/** Hard delete: for "please remove me" requests. */
export async function deleteEntry(id) {
  const row = await one('DELETE FROM waitlist WHERE id = $1 RETURNING id', [id]);
  if (!row) throw notFound('Entry not found');
  return { ok: true };
}

/** Marks waiting entries as invited and returns them (the caller sends the emails). Removed entries are never invited. */
export async function inviteEntries(ids) {
  if (!Array.isArray(ids) || !ids.length) throw bad('Choose who to invite');
  if (ids.length > 200) throw bad('Invite at most 200 people at a time');
  const clean = ids.map((i) => int(i, { min: 1, name: 'Entry' }));
  const rows = await all(`UPDATE waitlist SET status = 'invited', invited_at = now(), updated_at = now()
    WHERE id = ANY($1::int[]) AND status = 'waiting' RETURNING *`, [clean]);
  return { invited: rows, skipped: clean.length - rows.length };
}

const cell = (v) => {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // spreadsheets would run these as formulas
  return `"${s.replace(/"/g, '""')}"`;
};

export async function waitlistCsv(status) {
  const { sql, params } = filters({ status });
  const rows = await all(`${BASE}${sql} ORDER BY w.number`, params);
  const head = ['number', 'name', 'email', 'phone', 'city', 'interest', 'article', 'size', 'heard_from', 'source', 'status', 'customer', 'note', 'joined', 'invited'];
  const lines = rows.map((r) => [pad(r.number), r.name, r.email, r.phone, r.city, r.interest, r.article || '', r.size, r.heard_from, r.source, r.status,
    r.has_order ? 'yes' : '', r.note, new Date(r.created_at).toISOString(), r.invited_at ? new Date(r.invited_at).toISOString() : '']);
  return [head, ...lines].map((l) => l.map(cell).join(',')).join('\n') + '\n';
}
