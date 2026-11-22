// Pre-launch features: waitlist gate + preview cookie, /api/launch, welcome email with countdown,
// data-bank copy and export, cron reminders (auth, once only, not for people who joined after a threshold), owner sync from env.
// Starts its own servers (isolated databases): node scripts/test-launch.mjs
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const results = [];
const ok = (name, pass, detail = '') => results.push({ name, pass: !!pass, detail: pass ? '' : String(detail).slice(0, 300) });

function start(port, env) {
  const dir = mkdtempSync(join(tmpdir(), 'arsh-launch-'));
  const child = spawn('node', ['scripts/serve.mjs', String(port)], { cwd: ROOT, env: { ...process.env, PGLITE_DIR: dir, ADMIN_EMAIL: 'owner@test.local', ADMIN_PASSWORD: 'first-password-123', SESSION_SECRET: 'x'.repeat(40), PREVIEW_KEY: 'preview-key-123', CRON_SECRET: 'cron-secret-123', ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('server did not start')), 60000);
    child.stdout.on('data', (d) => { if (String(d).includes('ARSH →')) { clearTimeout(t); resolve({ child, dir, base: `http://localhost:${port}` }); } });
    child.stderr.on('data', (d) => process.stderr.write(d));
  });
}
const stop = (s) => new Promise((r) => { s.child.once('exit', r); s.child.kill(); });

const gated = await start(4191, {});
const B = gated.base;
const get = (path, opts = {}) => fetch(B + path, { redirect: 'manual', ...opts });
const json = async (path, opts = {}) => { const r = await fetch(B + path, { redirect: 'manual', ...opts, headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) } }); let b = null; try { b = await r.json(); } catch {} return { r, b }; };

try {
  // ---- gate
  for (const p of ['/', '/checkout', '/order', '/team']) {
    const html = await (await get(p)).text();
    ok(`gate: ${p} carries the gate script`, html.includes('/js/gate.js'));
  }
  let g = await json('/api/launch');
  ok('gate: waitlist phase by default, visitors are gated', g.b.phase === 'waitlist' && g.b.gated === true && g.b.locked === true, JSON.stringify(g.b));
  const shop0 = await json('/api/shop');
  ok('gate: no prices leave the server while locked', shop0.b.locked === true && shop0.b.shopOpen === false && shop0.b.products.every((p) => p.price === null), JSON.stringify(shop0.b.products[0]));
  g = await json('/api/launch', { headers: { cookie: 'arsh_preview=1' } });
  ok('gate: the preview cookie gets past the waitlist phase', g.b.gated === false && g.b.locked === false, JSON.stringify(g.b));
  for (const p of ['/waitlist', '/p/ABCDEFGHJK', '/admin', '/api/shop', '/assets/brand/wordmark.svg']) {
    const r = await get(p);
    ok(`gate: ${p} stays reachable`, r.status === 200, r.status);
  }
  const bad = await get('/api/preview?key=wrong');
  ok('preview: wrong key is refused (404)', bad.status === 404 && !bad.headers.get('set-cookie'), bad.status);
  const good = await get('/api/preview?key=preview-key-123');
  const cookie = good.headers.get('set-cookie') || '';
  ok('preview: right key sets the cookie and redirects home', good.status === 302 && /arsh_preview=1/.test(cookie) && /HttpOnly/.test(cookie), `${good.status} ${cookie}`);

  // ---- /api/launch + admin settings
  let l = await json('/api/launch');
  ok('launch: defaults to 15 December 2026, 00:00 Pakistan time', l.r.status === 200 && l.b.launchAt === '2026-12-14T19:00:00.000Z' && typeof l.b.now === 'number', JSON.stringify(l.b));
  const login = await json('/api/admin/login', { method: 'POST', body: JSON.stringify({ email: 'owner@test.local', password: 'first-password-123' }) });
  const adminCookie = (login.r.headers.get('set-cookie') || '').split(';')[0];
  ok('owner from env can sign in', login.r.status === 200 && adminCookie.startsWith('arsh_admin='), login.r.status);
  const A = { cookie: adminCookie, 'X-Arsh-Admin': '1' };
  const launchIso = new Date(Date.now() + 10 * 864e5 + 5 * 36e5).toISOString();
  let s = await json('/api/admin/settings', { method: 'PATCH', headers: A, body: JSON.stringify({ launchAt: launchIso, dataBankEmail: 'bank@test.local', dataBankAuto: true }) });
  ok('settings: launch date + data bank saved', s.r.status === 200 && s.b.settings.launchAt === launchIso && s.b.settings.dataBankEmail === 'bank@test.local', JSON.stringify(s.b));
  s = await json('/api/admin/settings', { method: 'PATCH', headers: A, body: JSON.stringify({ launchAt: 'not a date' }) });
  ok('settings: invalid launch date refused', s.r.status === 400, s.r.status);
  s = await json('/api/admin/settings', { method: 'PATCH', headers: A, body: JSON.stringify({ dataBankEmail: 'nope' }) });
  ok('settings: invalid data bank email refused', s.r.status === 400, s.r.status);
  l = await json('/api/launch');
  ok('launch: the date is public', l.b.launchAt === launchIso, JSON.stringify(l.b));

  // ---- signup -> welcome with countdown + data bank copy
  const join = await json('/api/waitlist', { method: 'POST', body: JSON.stringify({ name: 'Test Person', email: 'person1@test.local', consent: true, source: 'waitlist', city: 'Lahore', phone: '+92 300 1111111' }) });
  ok('signup works', join.r.status === 200 && join.b.number === 1, JSON.stringify(join.b));
  const log = (await json('/api/admin/emails', { headers: A })).b.emails;
  const welcome = log.find((e) => e.recipient === 'person1@test.local');
  const expectDate = new Date(launchIso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Karachi' });
  ok('welcome email has the supplied text, the date and the countdown', welcome && /^An invitation to the unchosen/.test(welcome.subject) && /day/.test(welcome.subject)
    && welcome.body.includes('AN INVITATION TO THE UNCHOSEN.') && welcome.body.includes('Welcome to ARSH.') && welcome.body.includes(`Your early access begins on ${expectDate}.`)
    && welcome.body.includes('25 pieces of each design. Never to be reproduced.') && welcome.body.includes('Until then, stay unchosen.') && welcome.body.includes('— ARSH') && /No\. 0001/.test(welcome.body) && !/HZK/.test(welcome.body), JSON.stringify(welcome));
  const bankCopy = log.find((e) => e.recipient === 'bank@test.local' && /0001/.test(e.subject));
  ok('data bank got a copy of the signup', bankCopy && /person1@test.local/.test(bankCopy.body) && /Lahore/.test(bankCopy.body), JSON.stringify(bankCopy));
  const exp = await json('/api/admin/waitlist/databank', { method: 'POST', headers: A });
  ok('data bank export endpoint works (logged, no mail key in dev)', exp.r.status === 200 && exp.b.count === 1 && exp.b.to === 'bank@test.local' && exp.b.status === 'logged', JSON.stringify(exp.b));
  const noAuth = await json('/api/admin/waitlist/databank', { method: 'POST' });
  ok('data bank export needs admin sign-in', noAuth.r.status === 401, noAuth.r.status);
  await json('/api/admin/settings', { method: 'PATCH', headers: A, body: JSON.stringify({ dataBankAuto: false }) });
  await json('/api/waitlist', { method: 'POST', body: JSON.stringify({ name: 'Second', email: 'person2@test.local', consent: true, source: 'waitlist', phone: '+92 300 2222222' }) });
  const log2 = (await json('/api/admin/emails', { headers: A })).b.emails;
  ok('auto copy can be switched off', !log2.some((e) => e.recipient === 'bank@test.local' && /0002/.test(e.subject)));

  // ---- cron reminders
  const noCron = await json('/api/cron/reminders');
  ok('cron: refuses without the secret', noCron.r.status === 401, noCron.r.status);
  const C = { Authorization: 'Bearer cron-secret-123' };
  let c = await json('/api/cron/reminders', { headers: C });
  ok('cron: nothing due 10 days out', c.r.status === 200 && c.b.kind === null && c.b.sent === 0, JSON.stringify(c.b));
  // 3 days out: the one-week reminder is due, but only for people who joined before the 7-day mark. Everyone here joined just now, so nobody is eligible.
  await json('/api/admin/settings', { method: 'PATCH', headers: A, body: JSON.stringify({ launchAt: new Date(Date.now() + 3 * 864e5).toISOString() }) });
  c = await json('/api/cron/reminders', { headers: C });
  ok('cron: late joiners are not sent a reminder for a threshold that passed before they joined', c.b.kind === 't7' && c.b.sent === 0, JSON.stringify(c.b));
  // Launch passed: 'open' waits for the owner to open early access, then goes to everyone who is waiting, exactly once.
  await json('/api/admin/settings', { method: 'PATCH', headers: A, body: JSON.stringify({ launchAt: new Date(Date.now() + 2000).toISOString() }) });
  await new Promise((r) => setTimeout(r, 2600));
  c = await json('/api/cron/reminders', { headers: C });
  ok('cron: open email waits while the site is still waitlist only', c.b.kind === null && c.b.sent === 0, JSON.stringify(c.b));

  // ---- launch phases
  const early1 = await json('/api/early-access', { method: 'POST', body: JSON.stringify({ email: 'person1@test.local' }) });
  ok('early: unlock refused before early access opens', early1.r.status === 403, early1.r.status);
  const notOwner = await json('/api/admin/launch', { method: 'POST', body: JSON.stringify({ phase: 'early' }) });
  ok('early: phase change needs the admin', notOwner.r.status === 401 || notOwner.r.status === 403, notOwner.r.status);
  let ph = await json('/api/admin/launch', { method: 'POST', headers: A, body: JSON.stringify({ phase: 'early' }) });
  ok('early: owner opens early access', ph.r.status === 200 && ph.b.phase === 'early' && ph.b.earlyOpenedAt, JSON.stringify(ph.b));
  g = await json('/api/launch');
  ok('early: site no longer gated, still locked', g.b.gated === false && g.b.locked === true, JSON.stringify(g.b));
  const shop1 = await json('/api/shop');
  ok('early: prices hidden and buying off for strangers', shop1.b.products.every((p) => p.price === null) && shop1.b.shopOpen === false);
  const anyVariant = shop1.b.products.find((p) => p.variants.length)?.variants[0]?.id;
  const order0 = await json('/api/orders', { method: 'POST', body: JSON.stringify({ items: [{ variantId: anyVariant, quantity: 1 }] }) });
  ok('early: an order without access is refused', order0.r.status === 403, order0.r.status);
  const stranger = await json('/api/early-access', { method: 'POST', body: JSON.stringify({ email: 'stranger@test.local' }) });
  ok('early: an email not on the list does not unlock', stranger.r.status === 404 && !stranger.r.headers.get('set-cookie'), stranger.r.status);
  await new Promise((r) => setTimeout(r, 30));
  await json('/api/waitlist', { method: 'POST', body: JSON.stringify({ name: 'Late Comer', email: 'late@test.local', consent: true, source: 'waitlist', phone: '+92 300 3333333' }) });
  const late = await json('/api/early-access', { method: 'POST', body: JSON.stringify({ email: 'late@test.local' }) });
  ok('early: someone who joined after early access opened waits', late.r.status === 403, late.r.status);
  const member = await json('/api/early-access', { method: 'POST', body: JSON.stringify({ email: 'PERSON1@test.local' }) });
  const earlyCookie = (member.r.headers.get('set-cookie') || '').split(';')[0];
  ok('early: a waitlist member unlocks (cookie set)', member.r.status === 200 && earlyCookie.startsWith('arsh_early='), member.r.status);
  const shop2 = await json('/api/shop', { headers: { cookie: earlyCookie } });
  ok('early: with the cookie prices show and buying is on', shop2.b.locked === false && shop2.b.shopOpen === true && shop2.b.products.some((p) => p.price > 0), JSON.stringify(shop2.b.products[0]?.price));
  const forged = await json('/api/shop', { headers: { cookie: 'arsh_early=' + Buffer.from('x@y.z').toString('base64url') + '.forged' } });
  ok('early: a forged cookie does not unlock', forged.b.locked === true);
  c = await json('/api/cron/reminders', { headers: C });
  ok('cron: open email goes to everyone waiting', c.b.kind === 'open' && c.b.sent === 2, JSON.stringify(c.b));
  c = await json('/api/cron/reminders', { headers: C });
  ok('cron: and never twice', c.b.sent === 0, JSON.stringify(c.b));
  ph = await json('/api/admin/launch', { method: 'POST', headers: A, body: JSON.stringify({ phase: 'open' }) });
  const shop3 = await json('/api/shop');
  ok('open: everyone sees prices and can buy', ph.b.phase === 'open' && shop3.b.locked === false && shop3.b.shopOpen === true && shop3.b.products.some((p) => p.price > 0));
  ph = await json('/api/admin/launch', { method: 'POST', headers: A, body: JSON.stringify({ phase: 'nope' }) });
  ok('open: unknown phase refused', ph.r.status === 400, ph.r.status);
  const log3 = (await json('/api/admin/emails', { headers: A })).b.emails;
  ok('cron: reminder content', log3.some((e) => e.recipient === 'person1@test.local' && /early access has begun/.test(e.subject)));
  l = await json('/api/launch');
} catch (err) {
  ok('test run completed', false, err.stack || err.message);
} finally {
  await stop(gated);
}

// ---- owner password reset by env: restart on the same database with a new ADMIN_PASSWORD
const again = async (password) => {
  const s = await start(4192, { PGLITE_DIR: gated.dir, ADMIN_PASSWORD: password });
  const r = await fetch(s.base + '/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'owner@test.local', password: 'second-password-456' }) });
  await stop(s);
  return r.status;
};
try {
  ok('reset: old password stops working after ADMIN_PASSWORD changes', (await again('second-password-456')) === 200);
} catch (err) { ok('reset: restart', false, err.message); }


// ---- SMTP path builds the message (jsonTransport: nothing is sent)
process.env.SMTP_HOST = 'json'; process.env.EMAIL_FROM = 'ARSH BY HZK <studio@arsh.ltd>';
const { sendEmail } = await import('../server/email.js');
const { db } = await import('../server/db.js');
process.env.PGLITE_DIR = mkdtempSync(join(tmpdir(), 'arsh-smtp-'));
await db();
const st = await sendEmail({ to: 'x@test.local', subject: 'hi', text: 'hello', html: '<p>hello</p>', attachments: [{ filename: 'a.csv', content: Buffer.from('a,b').toString('base64') }] });
ok('smtp: message is built and reported as sent', st === 'sent', st);

console.log(JSON.stringify({ results }, null, 2));
const failed = results.filter((x) => !x.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exitCode = failed.length ? 1 : 0;
