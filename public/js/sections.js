// Manifesto, The Box, Founder, footer, grain, header theme.

import { $, $$, loadImage } from './util.js';

export function initGrain() {
  const el = $('.grain');
  const size = 160;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = (Math.random() * 255) | 0;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  el.style.backgroundImage = `url(${c.toDataURL('image/png')})`;
}

export function initManifesto({ copy, reduced }) {
  const line = $('.manifesto__line');
  const lines = copy.manifesto.lines;
  line.setAttribute('aria-label', lines.join(' '));
  line.replaceChildren(...lines.map((text) => {
    const l = document.createElement('span');
    l.className = 'l';
    l.setAttribute('aria-hidden', 'true');
    text.split(/\s+/).forEach((word) => {
      const w = document.createElement('span');
      w.className = 'w';
      w.textContent = word;
      l.append(w);
    });
    return l;
  }));
  const spans = $$('.w', line);
  if (reduced || !window.gsap) { spans.forEach((s) => (s.style.opacity = '1')); return; }
  window.gsap.to(spans, {
    opacity: 1, ease: 'none', stagger: 0.18,
    scrollTrigger: { trigger: '.manifesto', start: 'top 75%', end: 'center 40%', scrub: 0.6 },
  });
}

export async function initBox({ copy, config, reduced, mobile }) {
  const section = $('#box');
  const scene = $('#box-scene');
  const list = $('#box-steps');
  list.replaceChildren(...copy.box.steps.map((s) => {
    const li = document.createElement('li');
    li.className = 'box__step';
    const n = Object.assign(document.createElement('p'), { className: 'ui', textContent: s.label });
    const h = Object.assign(document.createElement('h3'), { textContent: s.title });
    const t = Object.assign(document.createElement('p'), { textContent: s.text });
    li.append(n, h, t);
    return li;
  }));
  const steps = $$('.box__step', list);

  // Real packaging photography replaces the drawn placeholders when configured.
  const pack = config.packaging || {};
  let any = false;
  await Promise.all(['box', 'tissue', 'patch'].map(async (k) => {
    if (!pack[k]) return;
    const img = new Image();
    img.className = 'pack-img';
    img.alt = '';
    if (await loadImage(pack[k], img)) { $(`[data-pack="${k}"]`, scene).append(img); any = true; }
  }));
  scene.classList.toggle('has-images', any);

  const lid = $('.box__lid', scene);
  const patch = $('.box__patch', scene);
  const tissue = $('.box__tissue', scene);
  const FLIP = -176; // the lid opens on its back edge and lies open behind the box, inside face up
  const setStep = (p) => steps.forEach((s, i) => s.classList.toggle('is-on', p >= i / steps.length - 0.02));

  if (reduced || !window.gsap) {
    section.style.setProperty('--box-h', 'auto');
    $('.box__stage').style.position = 'relative';
    lid.style.transform = `rotateX(${FLIP}deg)`;
    patch.style.opacity = '1';
    setStep(1);
    return;
  }
  section.style.setProperty('--box-h', mobile ? '260vh' : '320vh');
  const gsap = window.gsap;
  gsap.set(patch, { opacity: 0, y: '60%', rotate: 6 });
  gsap.set(tissue, { scale: 0.94, opacity: 0.6 });
  const tl = gsap.timeline({
    defaults: { ease: 'power2.inOut' },
    scrollTrigger: {
      trigger: section, start: 'top top', end: 'bottom bottom', scrub: 0.8,
      onUpdate: (st) => setStep(st.progress),
    },
  });
  tl.to({}, { duration: 0.12 })
    .to(lid, { rotateX: FLIP, duration: 0.5 })
    .to(tissue, { scale: 1, opacity: 1, duration: 0.3 }, 0.3)
    .to(patch, { opacity: 1, y: '0%', rotate: -4, duration: 0.3 }, 0.62)
    .to({}, { duration: 0.08 });
  setStep(0);
}

export async function initFounder({ copy, config }) {
  const lines = $('#founder-lines');
  lines.innerHTML = '';
  copy.founder.lines.forEach((t) => { const p = document.createElement('p'); p.textContent = t; lines.append(p); });

  const link = $('#founder-link');
  link.replaceChildren(socialLink(config.instagram?.founder, copy.founder.instagramLabel));
  $('#footer-instagram').replaceChildren(socialLink(config.instagram?.brand, copy.footer.instagram));

  const src = config.founder?.portrait;
  if (src) {
    const fig = $('#founder-portrait');
    const img = new Image();
    img.alt = copy.founder.portraitAlt;
    img.width = 800; img.height = 1000;
    img.loading = 'lazy';
    if (await loadImage(src, img)) { fig.replaceChildren(img); }
  }
}

function socialLink(url, label) {
  if (url) {
    const a = document.createElement('a');
    a.href = url; a.target = '_blank'; a.rel = 'noopener'; a.textContent = label;
    return a;
  }
  const span = document.createElement('span');
  span.className = 'pending';
  span.textContent = `${label} — link pending`;
  return span;
}

export function initReveals() {
  const els = $$('.founder__text > *, .founder__portrait, .access__inner > *, .box__intro');
  els.forEach((el) => el.classList.add('reveal'));
  const io = new IntersectionObserver((entries) => entries.forEach((e) => {
    if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target); }
  }), { rootMargin: '0px 0px -10% 0px' });
  els.forEach((el) => io.observe(el));
}

/** Header colour follows the section under it; the hero hands over to light at the whiteout. */
export function headerTheme({ scroll, heroProgress }) {
  const header = $('#header');
  const sections = $$('main > section, footer');
  let cache = [];
  const measure = () => { cache = sections.map((s) => ({ s, top: s.offsetTop, bottom: s.offsetTop + s.offsetHeight, theme: s.dataset.theme })); };
  const update = (y) => {
    const probe = y + 32;
    const hit = cache.find((c) => probe >= c.top && probe < c.bottom);
    let theme = hit?.theme || 'dark';
    if (hit?.s.id === 'hero') theme = heroProgress() > 0.93 ? 'light' : 'dark';
    if (header.dataset.theme !== theme) header.dataset.theme = theme;
  };
  measure();
  return { measure, update: () => update(scroll.y) };
}

