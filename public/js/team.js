// /team — everyone who makes Arsh. Content: data/team.json.
// Pinned reel: vertical scroll drives a sideways track (one person per step), the neighbours ghosted.
// Reduced motion / narrow failure modes: the same cards as a plain swipeable strip.
import { initGrain } from './sections.js';

const $ = (s) => document.querySelector(s);
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
const pad = (n) => String(n).padStart(2, '0');
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const PLACEHOLDER = '/assets/team/placeholder.webp';
const STITCH = { 'Orbit Red': '#F23B35', 'Andromeda Blue': '#2B3DB0', 'Ticket Cream': '#F6ECE1', 'Wax Red': '#A51D1E', 'Deep Space': '#0D0D0D' };

document.body.append(Object.assign(el('div', 'grain'), {}));
initGrain();

const [team, config] = await Promise.all([
  fetch('/data/team.json').then((r) => r.json()),
  fetch('/data/config.json').then((r) => r.json()).catch(() => ({})),
]);
const members = team.members || [];
const N = members.length;

$('#team-eyebrow').textContent = team.reelLabel || 'The team';
$('#team-title').textContent = team.title;
$('#team-lede').textContent = team.lede;
$('#everyone-title').textContent = team.everyone || 'All of us';
document.title = `${team.reelLabel || 'The team'} — ARSH BY HZK`;

// Footer Instagram, same behaviour as the landing page.
{
  const slot = $('#footer-instagram');
  const url = config.instagram?.brand;
  if (url) { const a = el('a', null, 'Instagram'); a.href = url; a.target = '_blank'; a.rel = 'noopener'; slot.append(a); }
  else slot.textContent = 'Instagram — link pending';
}

// ---------------------------------------------------------------- cards
const track = $('#reel-track');
const grid = $('#everyone-grid');
const photo = (m, i, cls) => {
  const img = el('img', cls);
  img.src = m.photo || PLACEHOLDER;
  img.alt = `Portrait of ${m.name}`;
  img.width = 800; img.height = 1000;
  img.decoding = 'async';
  if (i > 1) img.loading = 'lazy';
  img.draggable = false;
  return img;
};

const cards = members.map((m, i) => {
  const li = el('li', 'member');
  const card = el('article', 'member__card');
  card.setAttribute('aria-label', `${m.name}, ${m.role}`);
  const fig = el('figure', 'member__photo');
  fig.append(photo(m, i));
  const info = el('div', 'member__info');
  const top = el('div');
  top.append(el('h3', 'member__name display', m.name));
  const bottom = el('div');
  bottom.append(el('p', 'member__role ui', m.role));
  const facts = el('dl', 'member__facts');
  const fact = (k, v, swatch) => {
    if (!v) return;
    const d = el('div'); const dd = el('dd');
    if (swatch) { const s = el('span', 'swatch'); s.style.background = swatch; s.setAttribute('aria-hidden', 'true'); dd.append(s); }
    dd.append(document.createTextNode(String(v)));
    d.append(el('dt', null, k), dd);
    facts.append(d);
  };
  fact('Part of the company since', m.since);
  fact('Specialisation', m.specialisation);
  fact('Stitch colour', m.stitch, STITCH[m.stitch]);
  bottom.append(facts);
  info.append(top, bottom);
  card.append(fig, info);
  li.append(card);
  return li;
});
track.append(...cards);

grid.append(...members.map((m, i) => {
  const li = el('li');
  const b = el('button', 'tile');
  b.type = 'button';
  b.setAttribute('aria-label', `${m.name}, ${m.role}. Show in the reel`);
  b.append(photo(m, 9, null), el('span', 'tile__name', m.name), el('span', 'tile__role', m.role));
  b.addEventListener('click', () => goTo(i));
  li.append(b);
  return li;
}));

// ---------------------------------------------------------------- reel
const reel = $('#reel');
const stage = $('#reel-stage');
const countEl = $('#reel-count');
const bar = $('#reel-bar');
let reelTop = 0, dist = 1, step = 1;
let target = 0, current = 0, shown = -1, raf = 0;

function measure() {
  const vh = stage.offsetHeight || innerHeight;
  const gap = parseFloat(getComputedStyle(track).columnGap) || 0;
  step = (cards[0]?.offsetWidth || 1) + gap;
  const total = vh + Math.max(0, N - 1) * vh * 0.7;
  reel.style.setProperty('--reel-h', `${Math.round(total)}px`);
  reelTop = reel.getBoundingClientRect().top + scrollY;
  dist = Math.max(1, total - vh);
}

function paint() {
  const f = current * Math.max(0, N - 1);
  track.style.transform = `translate3d(${(-f * step).toFixed(1)}px, 0, 0)`;
  cards.forEach((c, i) => {
    const d = Math.min(1, Math.abs(i - f));
    c.style.opacity = (1 - d * 0.68).toFixed(3);
    c.style.transform = `scale(${(1 - d * 0.07).toFixed(4)})`;
  });
  bar.style.transform = `scaleX(${current.toFixed(4)})`;
  const idx = clamp(Math.round(f), 0, N - 1);
  if (idx !== shown) { shown = idx; countEl.textContent = `${pad(idx + 1)} / ${pad(N)}`; countEl.setAttribute('aria-label', `${idx + 1} of ${N}: ${members[idx].name}`); }
  stage.dataset.active = String(idx);
}

function frame() {
  raf = 0;
  const diff = target - current;
  if (Math.abs(diff) > 0.0004) { current += diff * 0.14; raf = requestAnimationFrame(frame); } else current = target;
  paint();
}
function onScroll() {
  target = clamp((scrollY - reelTop) / dist);
  if (!raf) raf = requestAnimationFrame(frame);
}

export function goTo(i) {
  const k = clamp(i, 0, N - 1);
  if (reel.classList.contains('is-pinned')) {
    scrollTo({ top: reelTop + (N > 1 ? (k / (N - 1)) * dist : 0), behavior: reduced ? 'auto' : 'smooth' });
  } else {
    reel.scrollIntoView({ behavior: 'auto', block: 'center' });
    track.scrollTo({ left: cards[k].offsetLeft - (track.clientWidth - cards[k].offsetWidth) / 2, behavior: reduced ? 'auto' : 'smooth' });
  }
}

if (!reduced && N > 1) {
  reel.classList.add('is-pinned');
  measure();
  addEventListener('scroll', onScroll, { passive: true });
  let rt = 0;
  addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => { measure(); onScroll(); }, 120); });
  document.fonts?.ready.then(() => { measure(); onScroll(); });
  // Images change the page above the reel when they load; re-measure once everything has settled.
  addEventListener('load', () => { measure(); onScroll(); });
  onScroll();
  current = target; paint();

  addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    if (e.target.closest?.('input, textarea, select')) return;
    const p = (scrollY - reelTop) / dist;
    if (p < -0.05 || p > 1.05) return;
    e.preventDefault();
    goTo(Math.round(current * (N - 1)) + (e.key === 'ArrowRight' ? 1 : -1));
  });
}

window.__team = { goTo, count: () => N, active: () => shown, pinned: () => reel.classList.contains('is-pinned') };
