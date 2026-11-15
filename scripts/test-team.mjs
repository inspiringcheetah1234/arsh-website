// Team page: the reel follows scroll, arrow keys, grid jump, black-and-white portraits, reduced motion, mobile.
//   npm run dev   then   node scripts/test-team.mjs       (screenshots → scripts/screenshots/team-*.png)
import { chromium } from 'playwright-core';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'screenshots');
mkdirSync(OUT, { recursive: true });
const BASE = process.env.URL || 'http://localhost:4173';
const CHROME = process.env.CHROMIUM_PATH || ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/chromium', '/usr/bin/google-chrome'].find(existsSync);
const team = JSON.parse(readFileSync(join(HERE, '..', 'public', 'data', 'team.json'), 'utf8'));
const N = team.members.length;
const results = [], errors = [];
const ok = (name, pass, detail = '') => results.push({ name, pass: !!pass, detail: String(detail) });
const browser = await chromium.launch({ executablePath: CHROME });
const watch = (p, tag) => {
  p.on('console', (m) => { if (m.type() === 'error') errors.push(`${tag}: ${m.text()}`); });
  p.on('pageerror', (e) => errors.push(`${tag}: ${e.message}`));
};
const active = (p) => p.evaluate(() => window.__team.active());
const settle = (p, i) => p.waitForFunction((i) => window.__team.active() === i, i, { timeout: 8000 }).then(() => p.waitForTimeout(500));

for (const [vp, name] of [[{ width: 1440, height: 900 }, 'desktop'], [{ width: 390, height: 844 }, 'mobile']]) {
  const c = await browser.newContext({ viewport: vp, deviceScaleFactor: name === 'mobile' ? 2 : 1, isMobile: name === 'mobile', hasTouch: name === 'mobile' });
  const p = await c.newPage();
  watch(p, name);
  await p.goto(BASE + '/team');
  await p.waitForFunction(() => window.__team);
  await p.waitForTimeout(600);
  ok(`${name}: every member has a card and a tile`, (await p.locator('.member').count()) === N && (await p.locator('.tile').count()) === N);
  ok(`${name}: reel is pinned`, await p.evaluate(() => window.__team.pinned()));
  ok(`${name}: every portrait is black and white with alt text`, await p.evaluate(() => [...document.querySelectorAll('.member__photo img, .tile img')].every((i) => getComputedStyle(i).filter.includes('grayscale(1)') && i.alt.startsWith('Portrait of'))));
  await p.evaluate(() => window.__team.goTo(3));
  await settle(p, 3);
  const centred = await p.evaluate(() => { const r = document.querySelectorAll('.member')[3].getBoundingClientRect(); return Math.abs((r.left + r.right) / 2 - innerWidth / 2); });
  ok(`${name}: the active card sits in the centre`, centred < 12, centred);
  ok(`${name}: neighbours are ghosted`, await p.evaluate(() => { const m = document.querySelectorAll('.member'); return Number(m[3].style.opacity) > 0.95 && Number(m[4].style.opacity) < 0.5; }));
  ok(`${name}: counter follows`, (await p.textContent('#reel-count')).startsWith('04 /'));
  await p.screenshot({ path: join(OUT, `team-${name}-reel.png`) });
  ok(`${name}: no name breaks mid-word`, await p.evaluate(() => [...document.querySelectorAll('.member__name')].every((n) => n.scrollWidth <= n.clientWidth + 1 && n.textContent.split(' ').every((w) => { const r = document.createRange(); r.selectNodeContents(n); return r.getClientRects().length <= n.textContent.split(' ').length; }))));
  await p.evaluate(() => document.querySelector('.everyone').scrollIntoView());
  await p.waitForTimeout(500);
  ok(`${name}: grid portraits keep 4:5`, await p.evaluate(() => { const r = document.querySelector('.tile img').getBoundingClientRect(); return Math.abs(r.width / r.height - 0.8) < 0.02; }));
  await p.screenshot({ path: join(OUT, `team-${name}-grid.png`) });
  await p.locator('.tile').nth(5).click();
  await settle(p, 5);
  ok(`${name}: a grid tile jumps to that person`, (await active(p)) === 5);
  ok(`${name}: no sideways page scroll`, !(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth)));
  if (name === 'desktop') {
    await p.keyboard.press('ArrowRight');
    await settle(p, 6);
    ok('desktop: arrow keys step through the reel', (await active(p)) === 6);
  }
  await c.close();
}

// Reduced motion: a plain strip, nothing pinned
{
  const c = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  const p = await c.newPage();
  watch(p, 'reduced');
  await p.goto(BASE + '/team');
  await p.waitForFunction(() => window.__team);
  ok('reduced motion: no pinning, the strip scrolls sideways', await p.evaluate(() => {
    const t = document.getElementById('reel-track');
    return !window.__team.pinned() && t.scrollWidth > t.clientWidth && getComputedStyle(t).overflowX === 'auto';
  }));
  await c.close();
}

// Linked from the landing page
{
  const p = await browser.newPage();
  await p.goto(BASE + '/');
  ok('landing page links to the team', (await p.locator('a[href="/team"]').count()) >= 2);
  await p.close();
}

await browser.close();
console.log(JSON.stringify({ results, errors }, null, 2));
process.exitCode = results.every((r) => r.pass) && !errors.length ? 0 : 1;
