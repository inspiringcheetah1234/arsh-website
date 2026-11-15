// Visual + behaviour check with Playwright (uses an already-installed Chromium; never downloads one).
//   node scripts/serve.mjs &           (in another terminal)
//   (cd scripts && node test.mjs)       -> screenshots in scripts/screenshots/
// Set CHROMIUM_PATH to point at a specific browser binary.
import { chromium } from 'playwright-core';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'screenshots');
const URL_ = process.env.URL || 'http://localhost:4173/';
mkdirSync(OUT, { recursive: true });

function findChromium() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const h = homedir();
  const sys = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome'];
  const roots = [
    [join(h, 'Library/Caches/ms-playwright'), /^chromium/],
    [join(h, '.cache/ms-playwright'), /^chromium/],
    [join(h, '.cache/puppeteer/chrome-headless-shell'), /./],
    [join(h, '.cache/puppeteer/chrome'), /./],
  ];
  const tails = [
    'chrome-headless-shell-mac-arm64/chrome-headless-shell', 'chrome-headless-shell-mac-x64/chrome-headless-shell',
    'chrome-headless-shell-linux64/chrome-headless-shell',
    'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
    'chrome-mac/Chromium.app/Contents/MacOS/Chromium',
    'chrome-mac-arm64/Chromium.app/Contents/MacOS/Chromium',
    'chrome-linux/chrome', 'chrome-linux64/chrome',
  ];
  for (const [root, re] of roots.slice(0, 2)) {
    if (!existsSync(root)) continue;
    for (const d of readdirSync(root).filter((n) => re.test(n)).sort().reverse()) {
      for (const t of tails) if (existsSync(join(root, d, t))) return join(root, d, t);
    }
  }
  for (const p of sys) if (existsSync(p)) return p;
  for (const [root, re] of roots.slice(2)) {
    if (!existsSync(root)) continue;
    for (const d of readdirSync(root).filter((n) => re.test(n)).sort().reverse()) {
      for (const t of tails) if (existsSync(join(root, d, t))) return join(root, d, t);
    }
  }
  throw new Error('No Chromium found. Set CHROMIUM_PATH.');
}

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900, mobile: false },
  { name: 'mobile', width: 390, height: 844, mobile: true },
];
const results = [];
const browser = await chromium.launch({ executablePath: findChromium(), headless: true });

for (const vp of VIEWPORTS) {
  const ctx = await browser.newContext({
    viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: vp.mobile ? 2 : 1,
    isMobile: vp.mobile, hasTouch: vp.mobile,
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('requestfailed', (r) => errors.push(`requestfailed: ${r.url()}`));
  page.on('response', (r) => { if (r.status() >= 400) errors.push(`HTTP ${r.status()}: ${r.url()}`); });
  await page.addInitScript(() => {
    window.__rejections = [];
    addEventListener('unhandledrejection', (e) => window.__rejections.push(String(e.reason)));
    window.__cls = 0;
    new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; })
      .observe({ type: 'layout-shift', buffered: true });
  });

  const t0 = Date.now();
  await page.goto(URL_, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelector('#preloader.is-done'), null, { timeout: 30000 });
  const preloadMs = Date.now() - t0;
  // Let every frame stream in so "frame shown == frame wanted" can be asserted exactly.
  await page.waitForFunction(() => window.__arsh.hero.frames.every((f) => f.ready), null, { timeout: 120000 });
  const shot = (n) => page.screenshot({ path: join(OUT, `${vp.name}-${n}.png`) });
  const settle = (ms = 500) => page.waitForTimeout(ms);

  // ---- Hero
  const hero = [];
  for (const p of [0, 0.25, 0.5, 0.75, 1]) {
    await page.evaluate((p) => {
      const h = window.__arsh.hero;
      window.__arsh.scroll.to(h.top + p * h.dist, { immediate: true });
    }, p);
    await page.waitForFunction((p) => Math.abs(window.__arsh.hero.current - p) < 0.0005, p, { timeout: 10000 });
    await settle(250);
    const r = await page.evaluate(() => {
      const h = window.__arsh.hero, c = document.querySelector('#hero-canvas');
      return { current: h.current, frame: Number(c.dataset.frame), want: Number(c.dataset.want), count: h.frames.length,
        expected: Math.round(h.current * (h.frames.length - 1)) };
    });
    hero.push({ p, ...r, ok: r.frame === r.expected });
    await shot(`hero-p${String(p).replace('.', '')}`);
  }

  // ---- Manifesto
  await page.evaluate(() => window.__arsh.scroll.to(document.querySelector('#manifesto').offsetTop, { immediate: true }));
  await settle(900);
  await shot('manifesto');

  // ---- Catalogue
  const cat = [];
  const goS = async (s) => {
    await page.evaluate((s) => window.__arsh.scroll.to(window.__arsh.cat.yForS(s), { immediate: true }), s);
    await settle(700);
  };
  await goS(0);
  await shot('catalogue-overview');
  cat.push({ state: 'overview', label: await page.textContent('#catalogue-name') });
  for (const s of [1, 4, 7]) {
    await goS(s);
    await shot(`catalogue-piece-${s}`);
    cat.push({ state: `piece ${s}`, index: await page.textContent('#catalogue-index'), label: await page.textContent('#catalogue-name'), meta: await page.textContent('#catalogue-meta') });
  }
  // Arrow key -> next piece
  await page.keyboard.press('ArrowRight');
  await settle(1300);
  cat.push({ state: 'after ArrowRight (from 7)', active: await page.evaluate(() => document.querySelector('#collection').dataset.active), s: await page.evaluate(() => window.__arsh.cat.s.toFixed(3)) });
  // Soft snap: park between pieces, wait for snap
  await page.evaluate(() => window.__arsh.scroll.to(window.__arsh.cat.yForS(5.4)));
  await settle(2200);
  cat.push({ state: 'snap from 5.4', s: await page.evaluate(() => window.__arsh.cat.s.toFixed(3)) });
  // Click a ghost -> jumps
  await goS(4);
  await page.evaluate(() => window.__arsh.cat.looks[4].btn.click());
  await settle(1500);
  cat.push({ state: 'click ghost 5', active: await page.evaluate(() => document.querySelector('#collection').dataset.active) });
  // Detail panel
  await page.evaluate(() => { const c = window.__arsh.cat; c.looks[c.activeIndex()].btn.click(); });
  await settle(800);
  const open = await page.evaluate(() => document.querySelector('#detail').open);
  await shot('detail');
  await page.keyboard.press('Escape');
  await settle(700);
  const closed = await page.evaluate(() => !document.querySelector('#detail').open);
  cat.push({ state: 'detail', open, closedByEscape: closed });

  // ---- Remaining sections
  for (const [id, frac] of [['box', 0.05], ['box', 0.5], ['box', 0.95], ['founder', 0], ['access', 0]]) {
    await page.evaluate(([id, frac]) => {
      const el = document.getElementById(id);
      window.__arsh.scroll.to(el.offsetTop + frac * Math.max(0, el.offsetHeight - innerHeight), { immediate: true });
    }, [id, frac]);
    await settle(1200);
    await shot(`${id}${id === 'box' ? '-' + Math.round(frac * 100) : ''}`);
  }
  // Access form: invalid then valid (stub endpoint)
  await page.fill('#access-email', 'not-an-email');
  await page.click('.access__submit');
  const invalid = await page.textContent('#access-status');
  await page.fill('#access-email', 'test@example.com');
  await page.click('.access__submit');
  await page.waitForFunction(() => document.querySelector('#access-status').dataset.state === 'success', null, { timeout: 5000 });
  await shot('access-success');
  const success = await page.textContent('#access-status');
  await page.evaluate(() => window.__arsh.scroll.to(document.body.scrollHeight, { immediate: true }));
  await settle(800);
  await shot('footer');

  const overflowX = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  const rejections = await page.evaluate(() => window.__rejections);
  const cls = await page.evaluate(() => window.__cls);
  results.push({ viewport: vp.name, preloadMs, hero, cat, access: { invalid, success }, overflowX, cls: +cls.toFixed(4), errors, rejections });
  await ctx.close();
}

// Reduced motion: poster frame, normal scroll
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(URL_);
  await page.waitForFunction(() => document.querySelector('#preloader.is-done'), null, { timeout: 30000 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: join(OUT, 'reduced-motion-hero.png') });
  const heroH = await page.evaluate(() => document.querySelector('#hero').offsetHeight / innerHeight);
  results.push({ viewport: 'reduced-motion', heroHeightInViewports: +heroH.toFixed(2), errors });
  await ctx.close();
}

await browser.close();
console.log(JSON.stringify(results, null, 2));
