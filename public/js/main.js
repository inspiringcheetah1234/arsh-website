// ARSH BY HZK — entry point.

import { $, $$, get, loadJSON, wait, mq } from './util.js';
import { createScroll } from './scroll.js';
import { Hero } from './hero.js';
import { Catalogue } from './catalogue.js';
import { initGrain, initManifesto, initBox, initFounder, initReveals, headerTheme } from './sections.js';
import { initAccess } from './access.js';
import { Sound } from './sound.js';
import { loadShop, mountBag, bag, money } from './shop.js';

const root = document.documentElement;
const reduced = mq.reduced();
const mobile = root.classList.contains('is-mobile');
if ('scrollRestoration' in history) history.scrollRestoration = 'manual';

const preloader = $('#preloader');
const progress = { data: 0, frames: 0, fonts: 0 };
// The wordmark is written across the preloader as things load.
const report = () => {
  const p = progress.data * 0.15 + progress.frames * 0.75 + progress.fonts * 0.1;
  preloader.style.setProperty('--p', p.toFixed(3));
  if (p > 0.97) preloader.classList.add('is-ready');
};

function applyCopy(copy) {
  $$('[data-copy]').forEach((el) => {
    const v = get(copy, el.dataset.copy);
    if (typeof v === 'string') el.textContent = v;
  });
  $$('[data-copy-attr]').forEach((el) => {
    const [attr, path] = el.dataset.copyAttr.split(':');
    const v = get(copy, path);
    if (typeof v === 'string') el.setAttribute(attr, v);
  });
  document.title = copy.meta.title;
  $('meta[name="description"]').setAttribute('content', copy.meta.description);
}

async function boot() {
  const started = performance.now();
  initGrain();
  const scroll = createScroll({ reduced });
  scroll.stop();

  const [copy, config, shop] = await Promise.all([loadJSON('data/copy.json'), loadJSON('data/config.json'), loadShop()]);
  const catalogue = {
    collection: copy.catalogue.collection, showPrices: shop.shopOpen, currency: shop.currency, shopOpen: shop.shopOpen,
    items: shop.products.map((p) => ({ ...p, meta: p.meta || {} })),
  };
  progress.data = 1; report();
  applyCopy(copy);

  // Hero frames (first N block the preloader) + fonts, in parallel.
  const hero = new Hero({
    section: $('#hero'), scroll, config, reduced, mobile,
    onProgress: (p) => sound.update(p),
  });
  const fonts = Promise.race([document.fonts?.ready ?? Promise.resolve(), wait(2500)])
    .then(() => { progress.fonts = 1; report(); });
  const frames = hero.load((p) => { progress.frames = p; report(); })
    .catch((err) => { console.warn('[hero] frames unavailable — run scripts/make-frames.sh', err); progress.frames = 1; report(); });

  // Everything else builds while frames load.
  const sound = new Sound({ button: $('#sound-toggle'), copy });
  const access = initAccess({ copy, config });
  const drawer = mountBag({ toggle: $('#bag-toggle'), onOpen: () => scroll.stop(), onClose: () => scroll.start() });
  const dialog = initDetail({ catalogue, copy, scroll, access, drawer });
  const cat = new Catalogue({
    section: $('#collection'), scroll, data: catalogue, copy, reduced,
    onOpen: (i, from) => dialog.open(i, from),
  });
  initManifesto({ copy, reduced });
  initReveals();
  const theme = headerTheme({ scroll, heroProgress: () => hero.current });
  await Promise.all([initBox({ copy, config, reduced, mobile }), initFounder({ copy, config }), frames, fonts]);

  // Layout pass: section heights first, then offsets.
  const layout = () => {
    cat.resize();
    hero.resize();
    cat.measure();
    theme.measure();
    scroll.refresh();
    hero.measure();
    cat.measure();
    theme.measure();
  };
  layout();
  if (reduced) hero.staticOverlay();

  let rt = 0, lastW = innerWidth;
  addEventListener('resize', () => {
    clearTimeout(rt);
    rt = setTimeout(() => {
      // Mobile URL-bar show/hide only changes height; svh/lvh-based stages ignore it.
      if (mobile && innerWidth === lastW) { hero.resize(); return; }
      lastW = innerWidth;
      layout();
    }, 150);
  });

  scroll.onTick((dt) => {
    hero.tick(dt);
    cat.tick();
    theme.update();
  });

  preloader.style.setProperty('--p', '1');
  preloader.classList.add('is-ready');
  const elapsed = performance.now() - started;
  await wait(Math.max(0, 1300 - elapsed));
  scrollTo(0, 0);
  $('#preloader').classList.add('is-done');
  root.classList.remove('is-loading');
  scroll.start();
  hero.stream();
  window.__arsh = { hero, cat, scroll }; // handle for tests / debugging
}

/** Catalogue detail panel (native <dialog>: focus trap + Escape for free). Size choice + add to bag. */
function initDetail({ catalogue, copy, scroll, access, drawer }) {
  const dlg = $('#detail');
  dlg.setAttribute('data-lenis-prevent', '');
  const el = {
    img: $('#detail-img'), thumbs: $('#detail-thumbs'), index: $('#detail-index'), name: $('#detail-name'), desc: $('#detail-desc'),
    fit: $('#detail-fit'), fabric: $('#detail-fabric'), wash: $('#detail-wash'), edition: $('#detail-edition'),
    price: $('#detail-price'), sizes: $('#detail-sizes'), sizesWrap: $('#detail-sizes-wrap'),
    add: $('#detail-add'), request: $('#detail-request'), status: $('#detail-status'),
  };
  let returnTo = null;
  let current = null;
  let chosen = null;

  const close = () => dlg.close();
  $('#detail-close').addEventListener('click', close);
  dlg.addEventListener('close', () => {
    if (!drawer.el.open) scroll.start();
    returnTo?.focus({ preventScroll: true });
  });
  // Sold out, or the shop is not open yet: the waitlist page, with this piece already chosen.
  el.request.addEventListener('click', () => {
    location.href = `/waitlist${current?.slug ? `?interest=${encodeURIComponent(current.slug)}` : ''}`;
  });
  el.add.addEventListener('click', () => {
    if (!chosen) { el.status.textContent = copy.catalogue.chooseSize; el.sizes.querySelector('input')?.focus(); return; }
    bag.add(chosen);
    returnTo = null;
    close();
    drawer.open();
  });

  const renderSizes = (item) => {
    chosen = null;
    el.sizes.replaceChildren(...item.variants.map((v) => {
      const label = document.createElement('label');
      label.className = 'size' + (v.available ? '' : ' is-out');
      label.innerHTML = '<input type="radio" name="size"><span></span>';
      const input = label.querySelector('input');
      input.value = String(v.id);
      input.disabled = !v.available;
      label.querySelector('span').textContent = v.size;
      if (!v.available) label.title = copy.catalogue.soldOut;
      input.addEventListener('change', () => { chosen = v.id; el.status.textContent = v.low ? copy.catalogue.lowStock : ''; });
      return label;
    }));
  };

  return {
    open(i, from) {
      const item = catalogue.items[i];
      current = item;
      returnTo = from;
      const shots = [{ url: item.image, alt: `${item.name}, full-length view`, cutout: true }, ...(item.gallery || []).map((g, n) => ({ url: g.url, alt: g.alt || `${item.name}, photo ${n + 2}` }))];
      const show = (shot) => {
        el.img.src = shot.url;
        el.img.alt = shot.alt;
        el.img.classList.toggle('is-photo', !shot.cutout);
        el.thumbs.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.url === shot.url)));
      };
      el.thumbs.replaceChildren(...shots.map((shot, n) => {
        const li = document.createElement('li');
        const b = document.createElement('button');
        b.type = 'button';
        b.dataset.url = shot.url;
        b.setAttribute('aria-label', `Show ${n === 0 ? 'full-length view' : `photo ${n + 1}`}`);
        const t = document.createElement('img');
        t.src = shot.url; t.alt = ''; t.loading = 'lazy';
        b.append(t);
        b.addEventListener('click', () => show(shot));
        li.append(b);
        return li;
      }));
      el.thumbs.hidden = shots.length < 2;
      show(shots[0]);
      el.index.textContent = `No. ${String(i + 1).padStart(2, '0')} / ${String(catalogue.items.length).padStart(2, '0')}${item.article ? ` — ${item.article}` : ''}`;
      el.name.textContent = item.name;
      el.desc.textContent = item.description || '';
      el.fit.textContent = item.meta?.fit || '—';
      el.fabric.textContent = item.meta?.fabric || '—';
      el.wash.textContent = item.meta?.wash || '—';
      el.edition.textContent = item.editionSize ? `${copy.catalogue.editionOf} ${item.editionSize}` : '—';
      const canBuy = catalogue.shopOpen && item.variants?.some((v) => v.available);
      el.price.hidden = !(catalogue.showPrices && item.price != null);
      el.price.textContent = item.price != null ? money(item.price, catalogue.currency) : '';
      el.sizesWrap.hidden = !catalogue.shopOpen || !item.variants?.length;
      el.add.hidden = !canBuy;
      el.request.hidden = canBuy;
      el.request.textContent = catalogue.shopOpen ? copy.catalogue.soldOutRequest : copy.catalogue.request;
      el.status.textContent = '';
      if (catalogue.shopOpen) renderSizes(item);
      scroll.stop();
      dlg.showModal();
      $('#detail-close').focus();
    },
  };
}

boot().catch((err) => {
  // Never leave the visitor behind the preloader.
  console.warn('[arsh] boot failed', err);
  $('#preloader')?.classList.add('is-done');
  root.classList.remove('is-loading');
});
