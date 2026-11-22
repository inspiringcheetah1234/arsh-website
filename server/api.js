// All API routes. One handler serves Vercel (api/index.js) and the local dev server (scripts/serve.mjs).

import { Router, HttpError, send, readBody, bad, str, int, EMAIL } from './http.js';
import { all, one, q } from './db.js';
import { requireAdmin, currentAdmin, verifyPassword, hashPassword, sessionCookie, clearCookie, throttle, clearThrottle } from './auth.js';
import { getSettings, saveSettings, siteUrl, DEFAULTS } from './settings.js';
import { PREVIEW_COOKIE } from './gate.js';
import { timingSafeEqual } from 'node:crypto';
import { runReminders } from './reminders.js';
import { listProducts, publicProduct, createProduct, updateProduct } from './products.js';
import { createOrder, lookupOrder, adminOrder, listOrders, updateOrder, dashboard, orderToken } from './orders.js';
import {
  createBatch, listBatches, batchPieces, batchSheet, batchCsv, publicPiece, adminPiece,
  assignPiece, unassignPiece, voidPiece, parseCode, qrSvg, pieceUrl, BATCH_SIZE,
} from './pieces.js';
import { readRaw, uploadImage, updateImage, reorderImages, deleteImage, listImages } from './images.js';
import { storageKind } from './storage.js';
import { sendEmail, orderConfirmation, orderShipped, newOrderAlert, waitlistWelcome, waitlistInvite, waitlistAlert, waitlistDataBank, waitlistDataBankExport, waitlistBroadcast } from './email.js';
import { joinWaitlist, listWaitlist, updateEntry, deleteEntry, inviteEntries, waitlistCsv, resetWaitlist, sendBroadcast } from './waitlist.js';

const r = new Router();
const raw = (body, type, headers = {}) => ({ __raw: true, body, type, headers });

// ------------------------------------------------------------------ public
r.get('/api/shop', async () => {
  const s = await getSettings();
  const products = (await listProducts()).map(publicProduct);
  return {
    shopOpen: s.shopOpen, currency: s.currency, shippingFlat: s.shippingFlat, freeShippingOver: s.freeShippingOver,
    paymentMethods: s.paymentMethods, products,
  };
});

r.post('/api/orders', async (req) => {
  const settings = await getSettings();
  const base = siteUrl(settings, req);
  const { order, items } = await createOrder(await readBody(req), settings);
  await sendEmail(orderConfirmation(order, items, settings, base));
  if (settings.notifyEmail) await sendEmail(newOrderAlert(order, settings.notifyEmail, base));
  return { number: order.number, token: orderToken(order.number), total: order.total, paymentMethod: order.payment_method,
    bankDetails: order.payment_method === 'bank' ? settings.bankDetails : null };
});

r.get('/api/orders/lookup', async (req, { query }) => {
  const settings = await getSettings();
  const o = await lookupOrder({ number: query.get('n'), email: query.get('email'), token: query.get('t') }, siteUrl(settings, req));
  if (o.paymentMethod === 'bank') o.bankDetails = settings.bankDetails;
  return o;
});

r.get('/api/pieces/:code', async (req, { params }) => publicPiece(parseCode(params.code), await getSettings()));

// Waitlist. /api/access is the old name for the same thing, kept so older pages keep working.
const joinHandler = async (req) => {
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || '';
  throttle(`waitlist|${ip}`, 20);
  const result = await joinWaitlist(await readBody(req));
  if (result.honeypot) return { ok: true, status: 'joined' };
  if (!result.created) return { ok: true, status: 'already' };
  const settings = await getSettings();
  const base = siteUrl(settings, req);
  await sendEmail(waitlistWelcome(result.entry, { launchAt: settings.launchAt, base }));
  if (settings.notifyEmail) await sendEmail(waitlistAlert(result.entry, settings.notifyEmail, base));
  if (settings.dataBankEmail && settings.dataBankAuto) await sendEmail(waitlistDataBank(result.entry, settings.dataBankEmail));
  return { ok: true, status: 'joined', number: result.entry.number, name: result.entry.name };
};
r.post('/api/waitlist', joinHandler);
r.post('/api/access', joinHandler);

// Launch time for the live countdown on /waitlist (server time included so a wrong clock on the visitor's device does not matter).
r.get('/api/launch', async () => ({ launchAt: (await getSettings()).launchAt || null, now: Date.now() }));

// Pre-launch preview: /api/preview?key=<PREVIEW_KEY> lets the owner past the waitlist gate (see server/gate.js).
r.get('/api/preview', async (req, { query }) => {
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || '';
  throttle(`preview|${ip}`, 10);
  const want = Buffer.from(process.env.PREVIEW_KEY || '');
  const got = Buffer.from(query.get('key') || '');
  if (want.length < 8 || got.length !== want.length || !timingSafeEqual(want, got)) throw new HttpError(404, 'Not found');
  const secure = process.env.VERCEL || process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return { __redirect: '/', __headers: { 'Set-Cookie': `${PREVIEW_COOKIE}=1; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000${secure}` } };
});

// Daily countdown reminders (Vercel Cron sends "Authorization: Bearer $CRON_SECRET").
r.get('/api/cron/reminders', async (req) => {
  const secret = process.env.CRON_SECRET;
  const want = Buffer.from(`Bearer ${secret || ''}`), got = Buffer.from(req.headers.authorization || '');
  if (!secret || got.length !== want.length || !timingSafeEqual(want, got)) throw new HttpError(401, 'Unauthorized');
  const settings = await getSettings();
  return runReminders({ launchAt: settings.launchAt, base: siteUrl(settings, req) });
});

// ------------------------------------------------------------------ admin auth
r.post('/api/admin/login', async (req) => {
  const b = await readBody(req);
  const email = String(b.email || '').trim().toLowerCase();
  const ip = req.headers['x-forwarded-for']?.split(',')[0] || req.socket?.remoteAddress || '';
  throttle(`${ip}|${email}`);
  const admin = await one('SELECT * FROM admins WHERE lower(email) = $1', [email]);
  if (!admin || !(await verifyPassword(String(b.password || ''), admin.password_hash))) throw new HttpError(401, 'Email or password is incorrect');
  clearThrottle(`${ip}|${email}`);
  return { __headers: { 'Set-Cookie': sessionCookie(admin) }, admin: { id: admin.id, email: admin.email, name: admin.name, role: admin.role } };
});
r.post('/api/admin/logout', async () => ({ __headers: { 'Set-Cookie': clearCookie() }, ok: true }));
r.get('/api/admin/me', async (req) => {
  const admin = await currentAdmin(req);
  if (!admin) throw new HttpError(401, 'Sign in required');
  return { admin };
});

// ------------------------------------------------------------------ admin
const admin = (fn) => async (req, ctx) => fn(req, { ...ctx, admin: await requireAdmin(req) });

r.get('/api/admin/dashboard', admin(async () => dashboard()));

r.get('/api/admin/orders', admin(async (req, { query }) =>
  listOrders({ status: query.get('status'), search: query.get('q')?.trim(), page: Number(query.get('page')) || 1 })));
r.get('/api/admin/orders/:id', admin(async (req, { params }) => adminOrder(int(params.id, { min: 1 }))));
r.patch('/api/admin/orders/:id', admin(async (req, { params, admin: a }) => {
  const id = int(params.id, { min: 1 });
  const { before, changed } = await updateOrder(id, await readBody(req), a);
  if (changed.status === 'shipped' && before.status !== 'shipped') {
    const settings = await getSettings();
    await sendEmail(orderShipped({ ...before, ...changed }, siteUrl(settings, req)));
  }
  return adminOrder(id);
}));
r.post('/api/admin/orders/:id/assign', admin(async (req, { params, admin: a }) => {
  const b = await readBody(req);
  const result = await assignPiece({ code: parseCode(b.code), orderId: int(params.id, { min: 1 }), itemId: b.itemId || null, admin: a });
  return { result, order: await adminOrder(int(params.id, { min: 1 })) };
}));

r.get('/api/admin/pieces/:code', admin(async (req, { params }) => adminPiece(parseCode(params.code))));
r.post('/api/admin/pieces/:code/unassign', admin(async (req, { params, admin: a }) => unassignPiece(parseCode(params.code), a)));
r.post('/api/admin/pieces/:code/void', admin(async (req, { params, admin: a }) => voidPiece(parseCode(params.code), a)));
r.get('/api/admin/qr/:code', admin(async (req, { params }) => {
  const code = parseCode(params.code.replace(/\.svg$/i, ''));
  const base = siteUrl(await getSettings(), req);
  return raw(await qrSvg(pieceUrl(base, code)), 'image/svg+xml');
}));

r.get('/api/admin/products', admin(async () => ({ products: await listProducts({ includeAll: true }) })));
r.post('/api/admin/products', admin(async (req) => ({ id: await createProduct(await readBody(req)) })));
r.patch('/api/admin/products/:id', admin(async (req, { params }) => ({ id: await updateProduct(int(params.id, { min: 1 }), await readBody(req)) })));

r.post('/api/admin/products/:id/images', admin(async (req, { params, query }) => {
  const id = int(params.id, { min: 1 });
  const kind = query.get('kind') === 'cutout' ? 'cutout' : 'gallery';
  const ct = String(req.headers['content-type'] || '');
  if (!/^(image\/|application\/octet-stream)/.test(ct)) throw bad('Send the image as the request body');
  const result = await uploadImage(id, await readRaw(req), { kind, normalise: query.get('normalise') !== '0' });
  return { ...result, images: await listImages(id) };
}));
r.patch('/api/admin/products/:id/images/:imageId', admin(async (req, { params }) =>
  updateImage(int(params.id, { min: 1 }), int(params.imageId, { min: 1 }), await readBody(req))));
r.post('/api/admin/products/:id/images/order', admin(async (req, { params }) =>
  ({ images: await reorderImages(int(params.id, { min: 1 }), (await readBody(req)).ids) })));
r.delete('/api/admin/products/:id/images/:imageId', admin(async (req, { params }) =>
  deleteImage(int(params.id, { min: 1 }), int(params.imageId, { min: 1 }))));
r.get('/api/admin/storage', admin(async () => ({ kind: storageKind() })));

r.get('/api/admin/batches', admin(async () => ({ batches: await listBatches(), defaultSize: BATCH_SIZE })));
r.post('/api/admin/batches', admin(async (req, { admin: a }) => {
  const b = await readBody(req);
  const size = b.size === undefined ? BATCH_SIZE : int(b.size, { min: 1, max: 1000, name: 'Batch size' });
  return { id: await createBatch({ size, label: str(b.label ?? '', { max: 80 }), productId: b.productId ? int(b.productId, { min: 1 }) : null, admin: a }) };
}));
r.get('/api/admin/batches/:id', admin(async (req, { params }) => batchPieces(int(params.id, { min: 1 }))));
r.get('/api/admin/batches/:id/sheet', admin(async (req, { params }) =>
  raw(await batchSheet(int(params.id, { min: 1 }), siteUrl(await getSettings(), req)), 'text/html; charset=utf-8')));
r.get('/api/admin/batches/:id/csv', admin(async (req, { params }) => {
  const id = int(params.id, { min: 1 });
  return raw(await batchCsv(id, siteUrl(await getSettings(), req)), 'text/csv; charset=utf-8',
    { 'Content-Disposition': `attachment; filename="arsh-batch-${String(id).padStart(3, '0')}.csv"` });
}));

r.get('/api/admin/settings', admin(async () => ({ settings: await getSettings(), defaults: DEFAULTS })));
r.patch('/api/admin/settings', admin(async (req, { admin: a }) => {
  if (a.role !== 'owner') throw new HttpError(403, 'Only the owner can change settings');
  const b = await readBody(req);
  const patch = {};
  if (b.shopOpen !== undefined) patch.shopOpen = !!b.shopOpen;
  if (b.shippingFlat !== undefined) patch.shippingFlat = int(b.shippingFlat, { min: 0, name: 'Shipping' });
  if (b.freeShippingOver !== undefined) patch.freeShippingOver = int(b.freeShippingOver, { min: 0, name: 'Free shipping threshold' });
  if (b.paymentMethods !== undefined) {
    const pm = (Array.isArray(b.paymentMethods) ? b.paymentMethods : []).filter((m) => ['cod', 'bank'].includes(m));
    if (!pm.length) throw bad('Keep at least one payment method');
    patch.paymentMethods = pm;
  }
  if (b.bankDetails !== undefined) patch.bankDetails = str(b.bankDetails, { max: 1000 });
  if (b.siteUrl !== undefined) {
    patch.siteUrl = str(b.siteUrl, { max: 200 }).replace(/\/$/, '');
    if (patch.siteUrl && !/^https?:\/\/[^\s/]+$/.test(patch.siteUrl)) throw bad('Site URL should look like https://arsh.pk');
  }
  if (b.ownerDisplay !== undefined) {
    if (!['full', 'first-initial', 'first'].includes(b.ownerDisplay)) throw bad('Invalid owner display');
    patch.ownerDisplay = b.ownerDisplay;
  }
  if (b.notifyEmail !== undefined) {
    patch.notifyEmail = str(b.notifyEmail, { max: 200 });
    if (patch.notifyEmail && !EMAIL.test(patch.notifyEmail)) throw bad('Notification email is not valid');
  }
  if (b.launchAt !== undefined) {
    const v = str(b.launchAt, { max: 40 });
    if (v && !Number.isFinite(Date.parse(v))) throw bad('Launch date is not valid');
    patch.launchAt = v ? new Date(v).toISOString() : '';
  }
  if (b.dataBankEmail !== undefined) {
    patch.dataBankEmail = str(b.dataBankEmail, { max: 200 });
    if (patch.dataBankEmail && !EMAIL.test(patch.dataBankEmail)) throw bad('Data bank email is not valid');
  }
  if (b.dataBankAuto !== undefined) patch.dataBankAuto = !!b.dataBankAuto;
  return { settings: await saveSettings(patch) };
}));
r.get('/api/admin/emails', admin(async () => ({ emails: await all('SELECT * FROM email_log ORDER BY id DESC LIMIT 100') })));
r.get('/api/admin/waitlist', admin(async (req, { query }) =>
  listWaitlist({ status: query.get('status'), search: query.get('q')?.trim(), page: Number(query.get('page')) || 1 })));
r.get('/api/admin/waitlist/export', admin(async (req, { query }) =>
  raw(await waitlistCsv(query.get('status')), 'text/csv; charset=utf-8', { 'Content-Disposition': 'attachment; filename="arsh-waitlist.csv"' })));
r.post('/api/admin/waitlist/databank', admin(async () => {
  const { dataBankEmail } = await getSettings();
  if (!dataBankEmail) throw bad('Set the data bank email in Settings first');
  const csv = await waitlistCsv('');
  const count = Math.max(0, csv.trim().split('\n').length - 1);
  const status = await sendEmail(waitlistDataBankExport(csv, count, dataBankEmail));
  return { to: dataBankEmail, count, status };
}));
r.post('/api/admin/waitlist/reset', admin(async (req) => {
  const b = await readBody(req);
  if (b.password !== (process.env.WAITLIST_RESET_PASSWORD || '223344')) throw bad('Wrong password');
  return resetWaitlist();
}));
r.post('/api/admin/waitlist/broadcast', admin(async (req) => {
  const b = await readBody(req);
  const subject = str(b.subject, { min: 3, max: 150, name: 'Subject' });
  const message = str(b.message, { min: 10, max: 8000, name: 'Message' });
  const base = siteUrl(await getSettings(), req);
  if (b.test) { // one copy to the address typed in, with sample name
    const to = str(b.to, { min: 3, max: 200, name: 'Test address' }).toLowerCase();
    if (!EMAIL.test(to)) throw bad('Please enter a valid test address');
    const status = await sendEmail(waitlistBroadcast({ email: to, name: 'Test' }, { subject: `[Test] ${subject}`, message, base }));
    return { status, to };
  }
  const id = str(b.id, { min: 6, max: 40, name: 'Broadcast id' }).replace(/[^\w-]/g, '');
  const audience = b.audience === 'all' ? 'all' : 'waiting';
  return sendBroadcast({ id, subject, message, audience, base, dryRun: Boolean(b.dryRun) }, sendEmail, waitlistBroadcast);
}));
r.post('/api/admin/waitlist/invite', admin(async (req) => {
  const { invited, skipped } = await inviteEntries((await readBody(req)).ids);
  const base = siteUrl(await getSettings(), req);
  for (const entry of invited) await sendEmail(waitlistInvite(entry, base));
  return { invited: invited.length, skipped };
}));
r.patch('/api/admin/waitlist/:id', admin(async (req, { params }) => updateEntry(int(params.id, { min: 1 }), await readBody(req))));
r.delete('/api/admin/waitlist/:id', admin(async (req, { params }) => deleteEntry(int(params.id, { min: 1 }))));
r.get('/api/admin/admins', admin(async () => ({ admins: await all('SELECT id, email, name, role, created_at FROM admins ORDER BY id') })));
r.post('/api/admin/admins', admin(async (req, { admin: a }) => {
  if (a.role !== 'owner') throw new HttpError(403, 'Only the owner can add staff');
  const b = await readBody(req);
  const email = str(b.email, { min: 3, max: 200, name: 'Email' }).toLowerCase();
  if (!EMAIL.test(email)) throw bad('Email is not valid');
  const password = str(b.password, { min: 10, max: 200, name: 'Password (10+ characters)' });
  try {
    await q('INSERT INTO admins (email, name, password_hash, role) VALUES ($1, $2, $3, $4)',
      [email, str(b.name ?? '', { max: 80 }), await hashPassword(password), b.role === 'owner' ? 'owner' : 'staff']);
  } catch (err) {
    if (err.code === '23505') throw bad('That email already has an account');
    throw err;
  }
  return { ok: true };
}));

// ------------------------------------------------------------------ dispatcher
export async function handle(req, res) {
  const url = new URL(req.url, 'http://local');
  let path = url.pathname;
  if (path === '/api' || path === '/api/index') path = '/api/' + (url.searchParams.get('__path') || '');
  const m = r.match(req.method, path.replace(/\/+$/, '') || '/');
  try {
    if (!m) throw new HttpError(404, 'Not found');
    if (m === 'method') throw new HttpError(405, 'Method not allowed');
    const out = await m.handler(req, { params: m.params, query: url.searchParams });
    if (out?.__raw) {
      res.statusCode = 200;
      res.setHeader('Content-Type', out.type);
      res.setHeader('Cache-Control', 'no-store');
      for (const [k, v] of Object.entries(out.headers)) res.setHeader(k, v);
      res.end(out.body);
      return;
    }
    if (out?.__redirect) {
      res.statusCode = 302;
      res.setHeader('Location', out.__redirect);
      res.setHeader('Cache-Control', 'no-store');
      for (const [k, v] of Object.entries(out.__headers || {})) res.setHeader(k, v);
      res.end();
      return;
    }
    const headers = out?.__headers || {};
    if (out) delete out.__headers;
    send(res, 200, out ?? { ok: true }, headers);
  } catch (err) {
    if (err instanceof HttpError) return send(res, err.status, { error: err.message, ...err.extra });
    console.error('[api]', req.method, path, err);
    send(res, 500, { error: 'Something went wrong on our side.' });
  }
}
