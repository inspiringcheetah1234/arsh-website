// Waitlist end to end: landing quick form, the /waitlist page (validation, duplicate, honeypot, ticket),
// API abuse cases, and the admin (list, search, filter, notes, status, invite, CSV export, delete).
//   npm run dev   then   node scripts/test-waitlist.mjs        (screenshots → scripts/screenshots/waitlist-*.png)
import '../server/env.js';
import { chromium } from 'playwright-core';
import { existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'screenshots');
mkdirSync(OUT, { recursive: true });
const BASE = process.env.URL || 'http://localhost:4173';
const CHROME = process.env.CHROMIUM_PATH || ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/chromium', '/usr/bin/google-chrome'].find(existsSync);
const results = [], errors = [];
const ok = (name, pass, detail = '') => results.push({ name, pass: !!pass, detail });
const stamp = Date.now();
const mail = (n) => `wl-${n}-${stamp}@example.com`;

const post = (path, body) => fetch(BASE + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

const browser = await chromium.launch({ executablePath: CHROME });
const watch = (page, tag) => {
  page.on('console', (m) => { if (m.type() === 'error' && !/status of (400|401|409|422|429)/.test(m.text())) errors.push(`${tag}: ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`${tag}: ${e.message}`));
};

// ------------------------------------------------------------------ 1. API rules
{
  let r = await post('/api/waitlist', { email: 'not-an-email', source: 'waitlist', name: 'X Y', consent: true });
  ok('API rejects a bad email', r.status === 400);
  r = await post('/api/waitlist', { email: mail('noname'), source: 'waitlist', consent: true });
  ok('full form requires a name', r.status === 400);
  r = await post('/api/waitlist', { email: mail('noconsent'), source: 'waitlist', name: 'No Consent' });
  ok('full form requires consent', r.status === 400);
  r = await post('/api/waitlist', { email: mail('badphone'), source: 'waitlist', name: 'Bad Phone', consent: true, phone: 'call me' });
  ok('bad phone rejected', r.status === 400);
  r = await post('/api/waitlist', { email: mail('badpiece'), source: 'waitlist', name: 'Bad Piece', consent: true, productId: 99999 });
  ok('unknown piece rejected', r.status === 400);
  r = await post('/api/waitlist', { email: mail('bot'), source: 'waitlist', name: 'Bot', consent: true, company: 'Acme' });
  const bot = await r.json();
  const botRows = await (await fetch(BASE + '/api/waitlist', { method: 'GET' })).status; // GET is not allowed
  ok('honeypot: looks like success, stores nothing (checked in admin below)', r.status === 200 && bot.status === 'joined' && !bot.number && botRows === 405);
  r = await post('/api/access', { email: mail('legacy') });
  ok('old /api/access still works', r.status === 200 && (await r.json()).number > 0);
}

// ------------------------------------------------------------------ 2. landing quick form
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
let page = await ctx.newPage();
watch(page, 'landing');
await page.goto(BASE + '/');
await page.waitForFunction(() => document.querySelector('#preloader.is-done'), null, { timeout: 30000 });
await page.evaluate(() => window.__arsh.scroll.to(document.getElementById('access').offsetTop, { immediate: true }));
await page.waitForTimeout(1400);
await page.fill('#access-email', 'nope');
await page.click('.access__submit');
ok('landing: invalid email message', /valid email/i.test(await page.textContent('#access-status')));
await page.fill('#access-email', mail('landing'));
await page.click('.access__submit');
await page.waitForFunction(() => document.querySelector('#access-status').dataset.state === 'success');
const landingMsg = await page.textContent('#access-status');
ok('landing: success shows the waitlist number', /No\. \d{4}/.test(landingMsg), landingMsg);
ok('landing: link to the full form, email prefilled', (await page.getAttribute('#access-more', 'href')).includes(encodeURIComponent(mail('landing'))));
await page.screenshot({ path: join(OUT, 'waitlist-landing-success.png') });
await page.fill('#access-email', mail('landing'));
await page.click('.access__submit');
await page.waitForFunction(() => /already/i.test(document.querySelector('#access-status').textContent));
ok('landing: same email again says already on the list', true);
await ctx.close();

// ------------------------------------------------------------------ 3. the /waitlist page, desktop + mobile
for (const [vp, name] of [[{ width: 1440, height: 900 }, 'desktop'], [{ width: 390, height: 844 }, 'mobile']]) {
  const c = await browser.newContext({ viewport: vp, deviceScaleFactor: name === 'mobile' ? 2 : 1, isMobile: name === 'mobile', hasTouch: name === 'mobile', reducedMotion: 'reduce' });
  const p = await c.newPage();
  watch(p, `waitlist-${name}`);
  await p.goto(BASE + '/waitlist?interest=placeholder-03');
  await p.waitForSelector('#wl-interest option:nth-child(2)', { state: 'attached' });
  await p.waitForTimeout(600);
  ok(`${name}: reduced motion skips the envelope and shows the letter`, !(await p.isVisible('#envelope')) && !(await p.evaluate(() => document.getElementById('wl-form').inert)));
  ok(`${name}: ?interest= preselects the piece`, (await p.$eval('#wl-interest', (s) => s.selectedOptions[0].textContent)).includes('Placeholder 03'));
  await p.screenshot({ path: join(OUT, `waitlist-${name}-form.png`), fullPage: name === 'mobile' });

  await p.click('#wl-submit');
  ok(`${name}: empty submit is blocked with a message`, /highlighted|complete/i.test(await p.textContent('#wl-status')) && (await p.getAttribute('#wl-name', 'aria-invalid')) === 'true');
  await p.fill('#wl-name', `Sara Ahmed <img src=x onerror=window.__xss=1>`);
  await p.fill('#wl-email', mail(name));
  await p.fill('#wl-phone', '+92 321 5550101');
  await p.fill('#wl-city', 'Lahore');
  await p.selectOption('#wl-size', '32');
  await p.selectOption('#wl-heard', 'Instagram');
  await p.click('#wl-submit');
  ok(`${name}: consent is required`, /tick the box/i.test(await p.textContent('#wl-status')));
  await p.check('#wl-consent');
  await p.click('#wl-submit');
  await p.waitForSelector('#wl-done .ticket__number');
  const number = await p.textContent('#wl-done .ticket__number');
  ok(`${name}: boarding pass with a number`, /^No\. \d{4}/.test(number.trim()), number);
  const xss = await p.evaluate(() => ({ flag: window.__xss === 1, imgs: document.querySelectorAll('#wl-done img').length }));
  ok(`${name}: a name with HTML is shown as text`, !xss.flag && xss.imgs === 0);
  await p.waitForTimeout(700);
  await p.screenshot({ path: join(OUT, `waitlist-${name}-ticket.png`), fullPage: name === 'mobile' });
  await c.close();
}

// duplicate on the full form: no overwrite, no number
{
  const c = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  const p = await c.newPage();
  watch(p, 'dup');
  await p.goto(BASE + '/waitlist');
  await p.waitForSelector('#wl-interest option:nth-child(2)', { state: 'attached' });
  await p.fill('#wl-name', 'Someone Else');
  await p.fill('#wl-email', mail('desktop').toUpperCase());
  await p.check('#wl-consent');
  await p.click('#wl-submit');
  await p.waitForFunction(() => /already/i.test(document.querySelector('#wl-status').textContent));
  ok('duplicate email (any case): already on the list, no second ticket', (await p.locator('#wl-done .ticket').count()) === 0);
  await c.close();
}

// ------------------------------------------------------------------ 3b. the envelope, with motion on
{
  const c = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const p = await c.newPage();
  watch(p, 'envelope');
  await p.goto(BASE + '/waitlist');
  await p.waitForSelector('#seal');
  await p.waitForTimeout(800);
  ok('envelope: sealed, the letter is hidden, inert and out of the accessibility tree', await p.evaluate(() => {
    const f = document.getElementById('wl-form');
    return f.inert && f.getAttribute('aria-hidden') === 'true' && getComputedStyle(f).visibility === 'hidden' && getComputedStyle(document.getElementById('envelope')).display !== 'none';
  }));
  ok('envelope: the seal is a labelled button', /seal/i.test(await p.getAttribute('#seal', 'aria-label')) && (await p.$eval('#seal', (b) => b.tagName)) === 'BUTTON');
  ok('envelope: both halves of the wax seal are there', (await p.locator('.seal__half').count()) === 2);
  await p.screenshot({ path: join(OUT, 'waitlist-envelope-sealed.png') });

  await p.keyboard.press('Tab');   // the home mark
  await p.keyboard.press('Tab');   // nothing inside the hidden letter can take focus, so the seal is next
  ok('envelope: Tab reaches the seal (the hidden form is skipped)', (await p.evaluate(() => document.activeElement?.id)) === 'seal');
  await p.keyboard.press('Enter');
  await p.waitForTimeout(1250);
  await p.screenshot({ path: join(OUT, 'waitlist-envelope-opening.png') });
  ok('envelope: breaking the seal plays the sequence (halves part, flap lifts)', await p.evaluate(() => {
    const e = document.getElementById('envelope');
    return e.classList.contains('s1') && e.classList.contains('s2') && document.getElementById('seal').disabled;
  }));
  await p.waitForFunction(() => document.getElementById('wl-stage').dataset.state === 'open', null, { timeout: 9000 });
  ok('envelope: opened, the letter is live and holds focus', await p.evaluate(() => {
    const f = document.getElementById('wl-form');
    return !f.inert && !f.hasAttribute('aria-hidden') && getComputedStyle(f).visibility === 'visible' && document.activeElement === f && document.getElementById('envelope').hidden;
  }));
  await p.fill('#wl-name', 'Typed After Opening');
  ok('envelope: the form takes input after it opens', (await p.inputValue('#wl-name')) === 'Typed After Opening');
  await p.screenshot({ path: join(OUT, 'waitlist-envelope-open.png') });

  // arriving with a piece chosen: the envelope opens itself
  const p2 = await c.newPage();
  watch(p2, 'envelope-auto');
  await p2.goto(BASE + '/waitlist?interest=placeholder-03');
  await p2.waitForFunction(() => document.getElementById('wl-stage').dataset.state === 'open', null, { timeout: 12000 });
  ok('envelope: a link with a piece chosen opens it by itself', (await p2.$eval('#wl-interest', (s) => s.selectedOptions[0].textContent)).includes('Placeholder 03'));
  await c.close();
}

// ------------------------------------------------------------------ 4. admin
const adm = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
page = await adm.newPage();
watch(page, 'admin');
page.on('dialog', (d) => d.accept());
await page.goto(BASE + '/admin');
await page.waitForSelector('.login form');
await page.fill('input[name=email]', process.env.ADMIN_EMAIL);
await page.fill('input[name=password]', process.env.ADMIN_PASSWORD);
await page.click('.login .btn');
await page.waitForSelector('.kpis');
ok('dashboard shows a waitlist card', /Waitlist/.test(await page.textContent('.view')));
await page.click('.side__nav a[data-nav="waitlist"]');
await page.waitForSelector('.wl-table');
await page.screenshot({ path: join(OUT, 'waitlist-admin.png') });
const rows = await page.$$eval('.wl-table tbody tr', (trs) => trs.map((t) => t.textContent));
ok('admin lists signups', rows.some((r) => r.includes(mail('desktop'))) && rows.some((r) => r.includes(mail('landing'))));
ok('honeypot signup was not stored', !rows.some((r) => r.includes(mail('bot'))));
ok('HTML in a name is text in the admin too', (await page.locator('.wl-table img').count()) === 0 && rows.some((r) => r.includes('<img src=x')));

// search + filter
await page.fill('#wq', mail('mobile'));
await page.press('#wq', 'Enter');
await page.waitForFunction((m) => document.querySelectorAll('.wl-table tbody tr').length === 1 && document.querySelector('.wl-table tbody').textContent.includes(m), mail('mobile'));
ok('search finds one person', true);

// detail dialog: note + status
await page.click('.wl-table tbody tr');
await page.waitForSelector('dialog.dlg[open]');
await page.screenshot({ path: join(OUT, 'waitlist-admin-detail.png') });
await page.fill('#wl-note', 'Asked about a size 32 in the second drop');
await page.click('dialog.dlg .btn:has-text("Save")');
await page.waitForSelector('dialog.dlg', { state: 'detached' });
await page.click('.wl-table tbody tr');
await page.waitForSelector('dialog.dlg[open]');
ok('note saved', (await page.inputValue('#wl-note')).includes('size 32'));
await page.keyboard.press('Escape');
await page.waitForSelector('dialog.dlg', { state: 'detached' });

// bulk invite two people, then re-inviting skips them
await page.goto(BASE + '/admin#/waitlist?status=waiting&q=' + stamp);
await page.waitForSelector('.wl-table');
await page.waitForFunction(() => document.querySelectorAll('.wl-table tbody tr').length >= 2);
await page.check('.wl-table thead input[type=checkbox]');
const label = await page.textContent('.view header .btn:not(.btn--ghost)');
ok('select all enables invite with a count', /Invite selected \(\d+\)/.test(label), label);
await page.click('.view header .btn:not(.btn--ghost)');
await page.waitForFunction(() => /invited/i.test(document.querySelector('#toast').textContent));
const inv = await page.evaluate(async () => (await (await fetch('/api/admin/waitlist?status=invited')).json()).entries);
ok('invited people are marked invited, with a date', inv.length >= 2 && inv.every((e) => e.status === 'invited' && e.invited_at));
ok('the waiting filter no longer lists them', await page.evaluate(() => /Nobody matches/.test(document.querySelector('.view').textContent)));
const emails = await page.evaluate(async () => (await (await fetch('/api/admin/emails')).json()).emails.map((e) => e.subject));
ok('invitation emails were sent (logged)', emails.some((s) => /first collection is open/.test(s)));
ok('welcome emails were sent (logged)', emails.some((s) => /^An invitation to the unchosen/.test(s)));
const re = await page.evaluate(async (ids) => (await fetch('/api/admin/waitlist/invite', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Arsh-Admin': '1' }, body: JSON.stringify({ ids }) })).json(), await page.evaluate(async () => (await (await fetch('/api/admin/waitlist?status=invited')).json()).entries.map((e) => e.id)));
ok('inviting someone twice is skipped, not repeated', re.invited === 0 && re.skipped > 0);

// CSV export: header, a row, formulas neutralised
await page.evaluate(async (e) => fetch('/api/waitlist', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: e, source: 'waitlist', name: '=HYPERLINK("http://evil.example","click")', consent: true }) }), mail('formula'));
const csv = await page.evaluate(async () => (await fetch('/api/admin/waitlist/export')).text());
const lines = csv.trim().split('\n');
ok('CSV has a header and rows', lines[0].startsWith('"number","name","email"') && lines.length > 3);
ok('CSV neutralises spreadsheet formulas', csv.includes(`"'=HYPERLINK(`) && !/(^|,)"=HYPERLINK/.test(csv));

// delete
await page.goto(BASE + '/admin#/waitlist?q=' + encodeURIComponent(mail('formula')));
await page.waitForSelector('.wl-table tbody tr');
await page.click('.wl-table tbody tr');
await page.waitForSelector('dialog.dlg[open]');
await page.click('dialog.dlg .btn--danger');
await page.waitForFunction(() => /Nobody matches/.test(document.querySelector('.view').textContent));
ok('delete removes the entry for good', true);

// admin-only: the public cannot read or change the list
const anon = await browser.newContext();
const ar = await anon.request.get(BASE + '/api/admin/waitlist');
const ae = await anon.request.get(BASE + '/api/admin/waitlist/export');
const ap = await anon.request.post(BASE + '/api/admin/waitlist/invite', { data: { ids: [1] }, headers: { 'X-Arsh-Admin': '1' } });
ok('anonymous users cannot read, export or invite', ar.status() === 401 && ae.status() === 401 && ap.status() === 401);

// mobile admin
const mob = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const mp = await mob.newPage();
watch(mp, 'admin-mobile');
await mp.goto(BASE + '/admin');
await mp.fill('input[name=email]', process.env.ADMIN_EMAIL);
await mp.fill('input[name=password]', process.env.ADMIN_PASSWORD);
await mp.click('.login .btn');
await mp.waitForSelector('.kpis');
await mp.goto(BASE + '/admin#/waitlist');
await mp.waitForSelector('.wl-table');
await mp.screenshot({ path: join(OUT, 'waitlist-admin-mobile.png') });
ok('mobile admin: no horizontal page scroll', !(await mp.evaluate(() => document.documentElement.scrollWidth > innerWidth)));

await browser.close();
console.log(JSON.stringify({ results, errors }, null, 2));
process.exitCode = results.every((r) => r.pass) && !errors.length ? 0 : 1;
