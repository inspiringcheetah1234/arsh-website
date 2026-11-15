// Product images end to end: upload a cutout (off-centre, oversized → normalised onto the baseline),
// an opaque cutout (warning), three gallery photos; reorder, describe, delete; check the storefront panel.
//   npm run dev   then   node scripts/test-images.mjs
import '../server/env.js';
import { chromium } from 'playwright-core';
import sharp from 'sharp';
import { existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'screenshots');
mkdirSync(OUT, { recursive: true });
const BASE = process.env.URL || 'http://localhost:4173';
const CHROME = process.env.CHROMIUM_PATH || ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/chromium', '/usr/bin/google-chrome'].find(existsSync);
const results = [], errors = [];
const ok = (name, pass, detail = '') => results.push({ name, pass: !!pass, detail });

// Test files: a transparent "cutout" placed off-centre on a big canvas, an opaque photo, three gallery shots.
const tmp = tmpdir();
const fig = await sharp(join(HERE, '..', 'public', 'assets', 'catalogue', 'placeholder-07.webp')).resize({ height: 1300 }).png().toBuffer();
const cutPath = join(tmp, 'arsh-cutout.png');
await sharp({ create: { width: 2400, height: 2000, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
  .composite([{ input: fig, left: 300, top: 120 }]).png().toFile(cutPath);
const opaquePath = join(tmp, 'arsh-opaque.jpg');
await sharp({ create: { width: 900, height: 1600, channels: 3, background: '#8a8f99' } }).jpeg().toFile(opaquePath);
const shots = [];
for (const [i, c] of ['#2A3858', '#A98A66', '#2E3B31'].entries()) {
  const p = join(tmp, `arsh-photo-${i + 1}.jpg`);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="2000"><rect width="100%" height="100%" fill="${c}"/><text x="50%" y="52%" font-family="Helvetica" font-size="220" fill="#EFE7D8" text-anchor="middle">PHOTO ${i + 1}</text></svg>`;
  await sharp(Buffer.from(svg)).jpeg({ quality: 90 }).toFile(p);
  shots.push(p);
}

const browser = await chromium.launch({ executablePath: CHROME });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await ctx.newPage();
page.on('console', (m) => { if (m.type() === 'error' && !/status of 40[134]/.test(m.text())) errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(e.message));
page.on('dialog', (d) => d.accept());

await page.goto(BASE + '/admin');
await page.waitForSelector('.login form');
await page.fill('input[name=email]', process.env.ADMIN_EMAIL);
await page.fill('input[name=password]', process.env.ADMIN_PASSWORD);
await page.click('.login .btn');
await page.waitForSelector('.kpis');
await page.goto(BASE + '/admin#/products/7');
await page.waitForSelector('.images');

// Opaque cutout → accepted with a warning
await page.setInputFiles('.images label.btn:has-text("Replace") input', opaquePath);
await page.waitForFunction(() => document.querySelector('.img-warn')?.textContent.length > 0, null, { timeout: 15000 });
ok('opaque cutout warns', /transparent/.test(await page.textContent('.img-warn')));

// Proper cutout → normalised
await page.setInputFiles('.images label.btn:has-text("Replace") input', cutPath);
await page.waitForFunction(() => /Cutout updated/.test(document.querySelector('.img-status')?.textContent || '') && !document.querySelector('.img-warn').textContent, null, { timeout: 15000 });
const cutUrl = await page.getAttribute('.cutout__img', 'src');
const cutRes = await page.request.get(BASE + cutUrl);
const cutMeta = await sharp(await cutRes.body()).metadata();
const cutTrim = await sharp(await cutRes.body()).trim({ threshold: 1 }).toBuffer({ resolveWithObject: true });
const bottom = cutTrim.info.trimOffsetTop !== undefined ? -cutTrim.info.trimOffsetTop + cutTrim.info.height : null;
ok('cutout normalised to 1200×3000 webp', cutMeta.format === 'webp' && cutMeta.width === 1200 && cutMeta.height === 3000, `${cutMeta.format} ${cutMeta.width}x${cutMeta.height}`);
ok('feet on baseline (y≈2924)', bottom !== null && Math.abs(bottom - 2924) <= 2, `bottom=${bottom}`);
ok('figure centred', Math.abs((-cutTrim.info.trimOffsetLeft + cutTrim.info.width / 2) - 600) <= 3, `centre=${-cutTrim.info.trimOffsetLeft + cutTrim.info.width / 2}`);

// Gallery: three photos
await page.setInputFiles('.images label.btn:has-text("Add photos") input', shots);
await page.waitForFunction(() => document.querySelectorAll('.gallery__item').length === 3 && /Done/.test(document.querySelector('.img-status').textContent), null, { timeout: 30000 });
ok('3 photos uploaded', true);
await page.fill('.gallery__item:nth-child(1) input', 'Back pocket detail');
await page.press('.gallery__item:nth-child(1) input', 'Tab');
await page.waitForTimeout(500);
await page.click('.gallery__item:nth-child(3) button[aria-label^="Move photo 3 earlier"]');
await page.waitForTimeout(600);
const order = await page.$$eval('.gallery__item img', (els) => els.map((e) => e.src.split('/').pop()));
await page.screenshot({ path: join(OUT, 'images-admin.png'), fullPage: true });
await page.click('.gallery__item:nth-child(2) .btn--danger');
await page.waitForFunction(() => document.querySelectorAll('.gallery__item').length === 2);
ok('reorder + delete', order.length === 3);

// Saving the product form must not revert the uploaded cutout
await page.click('form.order button[type=submit]');
await page.waitForTimeout(800);
const after = await page.evaluate(async () => (await (await fetch('/api/admin/products')).json()).products.find((p) => p.id === 7));
ok('save keeps new cutout', after.image === cutUrl, after.image);
ok('alt text saved', after.images.some((i) => i.alt === 'Back pocket detail'));

// Storefront panel shows thumbnails and swaps the main image
const shop = await ctx.newPage();
shop.on('pageerror', (e) => errors.push(e.message));
await shop.goto(BASE + '/');
await shop.waitForFunction(() => document.querySelector('#preloader.is-done'), null, { timeout: 30000 });
await shop.evaluate(() => window.__arsh.scroll.to(window.__arsh.cat.yForS(7), { immediate: true }));
await shop.waitForTimeout(800);
await shop.screenshot({ path: join(OUT, 'images-lineup.png') });
await shop.evaluate(() => { const c = window.__arsh.cat; c.looks[c.activeIndex()].btn.click(); });
await shop.waitForSelector('#detail-thumbs:not([hidden]) button');
ok('panel thumbnails', (await shop.locator('#detail-thumbs button').count()) === 3);
await shop.click('#detail-thumbs li:nth-child(2) button');
await shop.waitForTimeout(400);
ok('thumbnail swaps image', (await shop.getAttribute('#detail-img', 'class'))?.includes('is-photo'));
await shop.screenshot({ path: join(OUT, 'images-panel.png') });
await shop.setViewportSize({ width: 390, height: 844 });
await shop.waitForTimeout(500);
await shop.screenshot({ path: join(OUT, 'images-panel-mobile.png') });

await browser.close();
console.log(JSON.stringify({ results, errors }, null, 2));
process.exitCode = results.every((r) => r.pass) && !errors.length ? 0 : 1;
