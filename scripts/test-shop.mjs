// End-to-end: customer buys → admin generates QR batch → admin scans pieces (real camera path via Chrome's
// fake video device showing a generated QR, plus the hand-scanner/typed path) → public piece page.
//   npm run dev     (in another terminal; uses .env for the admin login)
//   node scripts/test-shop.mjs        -> screenshots in scripts/screenshots/shop-*.png
import '../server/env.js';
import { chromium } from 'playwright-core';
import QRCode from 'qrcode';
import { execFileSync } from 'node:child_process';
import { mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'screenshots');
const BASE = process.env.URL || 'http://localhost:4173';
mkdirSync(OUT, { recursive: true });
const CHROME = process.env.CHROMIUM_PATH || ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/chromium', '/usr/bin/google-chrome'].find(existsSync);
const results = [];
const errors = [];
const ok = (name, pass, detail = '') => { results.push({ name, pass: !!pass, detail }); };

function watch(page, tag) {
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${tag} console: ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`${tag} pageerror: ${e.message}`));
  page.on('response', (r) => { if (r.status() >= 500) errors.push(`${tag} HTTP ${r.status()} ${r.url()}`); });
}

const browser = await chromium.launch({ executablePath: CHROME });

// ------------------------------------------------------------------ 1. customer checkout (desktop)
const cust = await browser.newContext({ viewport: { width: 1440, height: 900 } });
let page = await cust.newPage();
watch(page, 'customer');
await page.goto(BASE + '/');
await page.waitForFunction(() => document.querySelector('#preloader.is-done'), null, { timeout: 30000 });
await page.evaluate(() => window.__arsh.scroll.to(window.__arsh.cat.yForS(3), { immediate: true }));
await page.waitForTimeout(700);
await page.evaluate(() => { const c = window.__arsh.cat; c.looks[c.activeIndex()].btn.click(); });
await page.waitForTimeout(600);
ok('detail shows sizes', await page.isVisible('#detail-sizes .size'));
await page.screenshot({ path: join(OUT, 'shop-detail.png') });
await page.click('#detail-add');
ok('add without size asks for size', /size/i.test(await page.textContent('#detail-status')));
await page.click('#detail-sizes .size:nth-child(3)');
await page.click('#detail-add');
await page.waitForSelector('dialog.bag[open]');
await page.click('dialog.bag .bag__qty button[aria-label="One more"]');
await page.waitForTimeout(500);
await page.screenshot({ path: join(OUT, 'shop-bag.png') });
ok('bag count 2', (await page.textContent('#bag-toggle .count')).includes('2'));
await page.click('dialog.bag .bag__checkout');
await page.waitForSelector('#checkout:not([hidden])');
await page.click('#place');
ok('checkout validates', /highlighted/.test(await page.textContent('#checkout-status')));
await page.fill('#f-name', 'Ayesha Khan');
await page.fill('#f-email', 'ayesha@example.com');
await page.fill('#f-phone', '+92 300 1234567');
await page.fill('#f-line1', '12 Main Boulevard, Gulberg');
await page.fill('#f-city', 'Lahore');
await page.selectOption('#f-province', 'Punjab');
await page.screenshot({ path: join(OUT, 'shop-checkout.png'), fullPage: true });
await page.click('#place');
await page.waitForURL(/\/order\?/, { timeout: 15000 });
await page.waitForSelector('#order-view:not([hidden])');
const orderNumber = (await page.textContent('.order-head .ui')).trim();
ok('order placed', /^ARSH-\d+$/.test(orderNumber), orderNumber);
await page.screenshot({ path: join(OUT, 'shop-order-confirmation.png'), fullPage: true });

// ------------------------------------------------------------------ 2. admin: login, batch, order (desktop)
const adm = await browser.newContext({ viewport: { width: 1440, height: 900 } });
page = await adm.newPage();
watch(page, 'admin');
await page.goto(BASE + '/admin');
await page.waitForSelector('.login form');
await page.fill('input[name=email]', process.env.ADMIN_EMAIL);
await page.fill('input[name=password]', 'wrong-password-123');
await page.click('.login .btn');
await page.waitForFunction(() => document.querySelector('.login .err').textContent.length > 0);
ok('wrong password rejected', true);
await page.fill('input[name=password]', process.env.ADMIN_PASSWORD);
await page.click('.login .btn');
await page.waitForSelector('.kpis');
await page.screenshot({ path: join(OUT, 'shop-admin-overview.png') });

await page.goto(BASE + '/admin#/qr');
await page.waitForSelector('#bs');
await page.click('form.card button[type=submit]');
await page.waitForSelector('.codes .code');
const codeCount = await page.locator('.codes .code').count();
ok('batch of 250 generated', codeCount === 250, String(codeCount));
await page.screenshot({ path: join(OUT, 'shop-admin-batch.png') });
const codes = await page.$$eval('.codes .code .mono.muted', (els) => els.slice(0, 3).map((e) => e.textContent.trim()));
const sheet = await adm.newPage();
await sheet.addInitScript(() => { window.print = () => {}; });
await sheet.goto(page.url().replace(/#.*$/, '').replace('/admin', '') + `/api/admin/batches/${page.url().split('/').pop()}/sheet`);
await sheet.screenshot({ path: join(OUT, 'shop-qr-sheet.png') });
ok('print sheet has 250 QR', (await sheet.locator('.l svg').count()) === 250);
await sheet.close();

const orderId = await page.evaluate(async (n) => (await (await fetch(`/api/admin/orders?q=${n}`)).json()).orders[0].id, orderNumber);
await page.goto(`${BASE}/admin#/orders/${orderId}`);
await page.waitForSelector('.banner');
await page.screenshot({ path: join(OUT, 'shop-admin-order-before.png') });
// Try to mark packed before scanning: blocked
page.once('dialog', (d) => d.dismiss());
await page.selectOption('#st', 'packed');
await page.click('.card.stack .btn');
await page.waitForTimeout(600);
ok('cannot pack before scanning', (await page.textContent('.pill')).includes('pending'));
await adm.close();

// ------------------------------------------------------------------ 3. camera scan (fake camera shows codes[0]'s QR)
const qrPng = join(tmpdir(), 'arsh-qr.png'), qrY4m = join(tmpdir(), 'arsh-qr.y4m');
await QRCode.toFile(qrPng, `${BASE}/p/${codes[0]}`, { width: 360, margin: 4 });
execFileSync('ffmpeg', ['-v', 'error', '-y', '-loop', '1', '-i', qrPng, '-vf', 'scale=360:360,pad=640:480:140:60:white,format=yuv420p', '-t', '3', '-r', '15', qrY4m]);
const camBrowser = await chromium.launch({
  executablePath: CHROME,
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${qrY4m}`],
});
const mob = await camBrowser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, permissions: ['camera'] });
page = await mob.newPage();
watch(page, 'scanner');
await page.goto(BASE + '/admin');
await page.waitForSelector('.login form');
await page.fill('input[name=email]', process.env.ADMIN_EMAIL);
await page.fill('input[name=password]', process.env.ADMIN_PASSWORD);
await page.click('.login .btn');
await page.waitForSelector('.kpis');
await page.screenshot({ path: join(OUT, 'shop-admin-mobile-overview.png') });
await page.goto(`${BASE}/admin#/orders/${orderId}`);
await page.waitForSelector('.btn--scan');
await page.screenshot({ path: join(OUT, 'shop-admin-mobile-order.png'), fullPage: true });
await page.click('.view header .btn--scan');
await page.waitForSelector('dialog.scanner[open]');
await page.waitForFunction(() => /Registered|already/i.test(document.querySelector('.scanner__msg')?.textContent || ''), null, { timeout: 15000 });
await page.screenshot({ path: join(OUT, 'shop-admin-scanner.png') });
const camMsg = await page.textContent('.scanner__msg');
ok('camera scan registered piece', /No\. 001/.test(camMsg), camMsg);
// Second piece via the manual / hand-scanner field
await page.fill('#scan-manual', `${BASE}/p/${codes[1]}`);
await page.press('#scan-manual', 'Enter');
await page.waitForFunction(() => /All pieces registered/.test(document.querySelector('.scanner__msg')?.textContent || ''), null, { timeout: 8000 });
ok('typed scan registered second piece', true, await page.textContent('.scanner__msg'));
await page.waitForSelector('dialog.scanner', { state: 'detached', timeout: 5000 }).catch(() => {});
await page.waitForSelector('.banner.is-done');
await page.screenshot({ path: join(OUT, 'shop-admin-mobile-order-done.png'), fullPage: true });
// Now ship it
await page.selectOption('#st', 'shipped');
await page.fill('#courier', 'TCS');
await page.fill('#tracking', 'TCS-778899');
await page.click('.card.stack > .btn');
await page.waitForFunction(() => document.querySelector('.view header .pill')?.textContent === 'shipped', null, { timeout: 5000 });
ok('order shipped after scanning', true);
// Lookup tool on a blank code
await page.goto(`${BASE}/admin#/scan`);
await page.fill('#lk', codes[2]);
await page.press('#lk', 'Enter');
await page.waitForSelector('.view .card');
ok('lookup shows blank code', (await page.textContent('.view .card .pill')) === 'unassigned');
await camBrowser.close();

// ------------------------------------------------------------------ 4. public piece pages
for (const [vp, name] of [[{ width: 1440, height: 900 }, 'desktop'], [{ width: 390, height: 844 }, 'mobile']]) {
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: name === 'mobile' ? 2 : 1 });
  const p = await ctx.newPage();
  watch(p, `piece-${name}`);
  await p.goto(`${BASE}/p/${codes[0]}`);
  await p.waitForSelector('.ticket__number');
  await p.waitForTimeout(400);
  await p.screenshot({ path: join(OUT, `shop-piece-${name}.png`) });
  if (name === 'desktop') {
    ok('piece page owner', (await p.textContent('.ticket__fields')).includes('Ayesha K.'));
    await p.goto(`${BASE}/p/${codes[2]}`);
    await p.waitForSelector('.cert--empty h1');
    ok('blank code page', (await p.textContent('h1')).includes('Not yet registered'));
    await p.screenshot({ path: join(OUT, 'shop-piece-unregistered.png') });
    await p.goto(`${BASE}/p/NOTAREALCODE`);
    await p.waitForSelector('.cert--empty h1');
    ok('unknown code page', (await p.textContent('h1')).includes('Not recognised'));
    // Customer order page now shows shipped + piece links
    await p.goto(`${BASE}/order`);
    await p.fill('#l-number', orderNumber);
    await p.fill('#l-email', 'ayesha@example.com');
    await p.click('#lookup-form .button');
    await p.waitForSelector('#order-view:not([hidden])');
    ok('order lookup shows pieces', (await p.locator('.pieces a').count()) === 2);
    await p.screenshot({ path: join(OUT, 'shop-order-shipped.png'), fullPage: true });
  }
  await ctx.close();
}
await browser.close();

// 404 on the unknown code is expected; drop that one from the error list.
const real = errors.filter((e) => !/\/api\/pieces\/NOTAREALCODE/.test(e) && !/status of 40[14]/.test(e) && !/status of 422/.test(e));
console.log(JSON.stringify({ results, errors: real }, null, 2));
process.exitCode = results.every((r) => r.pass) && !real.length ? 0 : 1;
