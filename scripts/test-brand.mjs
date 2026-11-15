// Brand compliance, checked in a real browser (ARSH Brand Guidelines Vol. 01):
//   · logo minimums: wordmark ≥ 160 px wide, mark ≥ 40 px wide (the box illustration is exempt)
//   · palette: section backgrounds are exactly the brand values
//   · the wordmark is Latin only: no Arabic anywhere
//   · the logo artwork loads (SVG masks), the brand type stack is in use
//   · text contrast ≥ 4.5:1 (≥ 3:1 for large type), measured from computed colours
//   npm run dev   then   node scripts/test-brand.mjs      (URL=http://localhost:4180 to point elsewhere)
import { chromium } from 'playwright-core';
import { existsSync } from 'node:fs';

const BASE = process.env.URL || 'http://localhost:4173';
const CHROME = process.env.CHROMIUM_PATH || ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/chromium', '/usr/bin/google-chrome'].find(existsSync);
const results = [];
const ok = (name, pass, detail = '') => results.push({ name, pass: !!pass, detail });

const BRAND = { orbit: 'rgb(242, 59, 53)', blue: 'rgb(43, 61, 176)', cream: 'rgb(246, 236, 225)', wax: 'rgb(165, 29, 30)', space: 'rgb(13, 13, 13)' };

// Runs in the page: contrast failures for visible text inside `root`.
function contrastScan(rootSelector) {
  const parse = (c) => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const [r, g, b, a = 1] = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return { r, g, b, a }; };
  const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const lum = ({ r, g, b }) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  const over = (top, bottom) => ({ r: top.r * top.a + bottom.r * (1 - top.a), g: top.g * top.a + bottom.g * (1 - top.a), b: top.b * top.a + bottom.b * (1 - top.a), a: 1 });
  const backdrop = (el) => {
    const layers = [];
    for (let n = el; n; n = n.parentElement) {
      const c = parse(getComputedStyle(n).backgroundColor);
      if (c && c.a > 0) { layers.push(c); if (c.a >= 0.99) break; }
    }
    let base = { r: 13, g: 13, b: 13, a: 1 };
    if (!layers.length || layers.at(-1).a < 0.99) base = { r: 246, g: 236, b: 225, a: 1 };
    return layers.reverse().reduce((acc, l) => over(l, acc), base);
  };
  const root = document.querySelector(rootSelector);
  const bad = [];
  let checked = 0;
  for (const el of root.querySelectorAll('*')) {
    const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 1);
    if (!own) continue;
    const cs = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    if (cs.visibility === 'hidden' || cs.display === 'none' || rect.width < 2 || rect.height < 2) continue;
    let opacity = 1;
    for (let n = el; n; n = n.parentElement) opacity *= Number(getComputedStyle(n).opacity);
    if (opacity < 0.99 || el.closest('[aria-hidden="true"], .sr-only, .grain')) continue;
    const bg = backdrop(el);
    const fgRaw = parse(cs.color);
    const fg = over({ ...fgRaw, a: fgRaw.a }, bg);
    const [l1, l2] = [lum(fg), lum(bg)].sort((a, b) => b - a);
    const ratio = (l1 + 0.05) / (l2 + 0.05);
    const size = parseFloat(cs.fontSize), weight = Number(cs.fontWeight);
    const large = size >= 24 || (size >= 18.66 && weight >= 700);
    checked++;
    if (ratio < (large ? 3 : 4.5)) bad.push(`${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]} "${el.textContent.trim().slice(0, 28)}" ${ratio.toFixed(2)}:1 (${Math.round(size)}px)`);
  }
  return { checked, bad };
}

const browser = await chromium.launch({ executablePath: CHROME });
const errors = [];

for (const [vp, name] of [[{ width: 1440, height: 900 }, 'desktop'], [{ width: 390, height: 844 }, 'mobile']]) {
  const ctx = await browser.newContext({ viewport: vp, isMobile: name === 'mobile', hasTouch: name === 'mobile' });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  const failedAssets = [];
  page.on('response', (r) => { if (r.status() >= 400 && /\/assets\/(brand|fonts)\//.test(r.url())) failedAssets.push(r.url()); });

  await page.goto(BASE + '/');
  await page.waitForFunction(() => document.querySelector('#preloader.is-done'), null, { timeout: 30000 });
  await page.waitForTimeout(1300);
  const go = async (sel, frac = 0) => {
    await page.evaluate(([sel, frac]) => {
      const el = document.querySelector(sel);
      window.__arsh.scroll.to(el.offsetTop + frac * Math.max(0, el.offsetHeight - innerHeight), { immediate: true });
    }, [sel, frac]);
    await page.waitForTimeout(1400);
  };

  // --- logo sizes
  const logos = await page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll('.wordmark, .mark')) {
      if (el.closest('.box__patch') || el.closest('.box__scene') || el.classList.contains('footer__galaxy')) continue; // packaging illustration / tonal bleed
      const r = el.getBoundingClientRect();
      if (r.width < 1) continue;
      out.push({ kind: el.classList.contains('wordmark') ? 'wordmark' : 'mark', w: Math.round(r.width), where: el.closest('[class]')?.className.split(' ')[0] });
    }
    return out;
  });
  const smallWord = logos.filter((l) => l.kind === 'wordmark' && l.w < 160);
  const smallMark = logos.filter((l) => l.kind === 'mark' && l.w < 40);
  ok(`${name}: wordmarks ≥ 160px (${logos.filter((l) => l.kind === 'wordmark').length} found)`, smallWord.length === 0, JSON.stringify(smallWord));
  ok(`${name}: marks ≥ 40px (${logos.filter((l) => l.kind === 'mark').length} found)`, smallMark.length === 0, JSON.stringify(smallMark));

  // --- logo artwork + type stack
  const art = await page.evaluate(async () => {
    const m = getComputedStyle(document.querySelector('.hero__brand .wordmark')).maskImage || getComputedStyle(document.querySelector('.hero__brand .wordmark')).webkitMaskImage;
    const res = await fetch('/assets/brand/wordmark.svg');
    return { mask: m, status: res.status, type: res.headers.get('content-type') };
  });
  ok(`${name}: wordmark SVG mask applied`, /wordmark\.svg/.test(art.mask) && art.status === 200 && /svg/.test(art.type), JSON.stringify(art));
  ok(`${name}: logo/font assets all load`, failedAssets.length === 0, failedAssets.join(' '));
  const type = await page.evaluate(() => {
    const f = (s) => getComputedStyle(document.querySelector(s)).fontFamily;
    return { display: f('.manifesto__line'), heading: f('.catalogue__name'), label: f('.eyebrow'), body: f('.founder__lines') };
  });
  ok(`${name}: type stack (Bootzy Condensed / Bootzy / Mergo / Neue Montreal first)`,
    /Bootzy Condensed/.test(type.display) && /^"?Bootzy"?,/.test(type.heading) && /Mergo/.test(type.label) && /Neue Montreal/.test(type.body), JSON.stringify(type));

  await page.evaluate(() => document.fonts.ready);
  const loaded = await page.evaluate(() => [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family.replace(/"/g, '')));
  ok(`${name}: the real Bootzy Condensed and Bootzy files load`, loaded.includes('Bootzy Condensed') && loaded.includes('Bootzy'), loaded.join(', '));

  // --- palette
  const bg = await page.evaluate(() => Object.fromEntries(['.manifesto', '.catalogue', '.box', '.founder', '.access', '.footer'].map((s) => [s, getComputedStyle(document.querySelector(s)).backgroundColor])));
  ok(`${name}: section colours are exact brand values`,
    bg['.manifesto'] === BRAND.cream && bg['.catalogue'] === BRAND.cream && bg['.founder'] === BRAND.cream &&
    bg['.box'] === BRAND.wax && bg['.access'] === BRAND.blue && bg['.footer'] === BRAND.orbit, JSON.stringify(bg));

  // --- no Arabic, landing
  ok(`${name}: no Arabic text on the landing page`, !/[؀-ۿ]/.test(await page.evaluate(() => document.documentElement.outerHTML.replace(/<script[\s\S]*?<\/script>/g, ''))));

  // --- contrast, section by section
  const fails = [];
  let checked = 0;
  for (const [sel, frac] of [['#manifesto', 0.5], ['#collection', 0], ['#box', 1], ['#founder', 0], ['#access', 0], ['.footer', 0]]) {
    await go(sel, frac);
    if (sel === '#manifesto') await page.evaluate(() => window.__arsh.scroll.to(document.querySelector('#manifesto').offsetTop + 200, { immediate: true })), await page.waitForTimeout(1500);
    const r = await page.evaluate(contrastScan, sel);
    checked += r.checked;
    fails.push(...r.bad.map((b) => `${sel}: ${b}`));
  }
  ok(`${name}: landing text contrast (${checked} text elements)`, fails.length === 0, fails.join(' | '));
  await ctx.close();
}

// --- shop pages and the waitlist, both sizes: no Arabic, logo minimums, contrast
for (const [vp, name] of [[{ width: 1440, height: 900 }, 'desktop'], [{ width: 390, height: 844 }, 'mobile']]) {
  const ctx = await browser.newContext({ viewport: vp, isMobile: name === 'mobile', hasTouch: name === 'mobile' });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  for (const path of ['/checkout', '/order', '/p/ABCDEFGHJK', '/waitlist', '/team']) {
    await page.goto(BASE + path);
    await page.waitForTimeout(1500);
    const arabic = /[\u0600-\u06FF]/.test(await page.evaluate(() => document.body.innerText));
    const r = await page.evaluate(contrastScan, 'main');
    const logos = await page.evaluate(() => [...document.querySelectorAll('.wordmark, .mark')].filter((el) => !el.classList.contains('waitlist__galaxy') && !el.closest('.seal')).map((el) => ({ kind: el.classList.contains('wordmark') ? 'wordmark' : 'mark', w: Math.round(el.getBoundingClientRect().width) })).filter((l) => l.w > 0));
    const small = logos.filter((l) => (l.kind === 'wordmark' && l.w < 160) || (l.kind === 'mark' && l.w < 40));
    ok(`${name} ${path}: no Arabic, logo minimums, contrast (${r.checked} text elements)`, !arabic && small.length === 0 && r.bad.length === 0, JSON.stringify(small) + ' ' + r.bad.join(' | '));
  }
  await ctx.close();
}

await browser.close();
console.log(JSON.stringify({ results, errors }, null, 2));
process.exitCode = results.every((r) => r.pass) && !errors.length ? 0 : 1;
