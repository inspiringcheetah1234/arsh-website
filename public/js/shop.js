// Shop client: catalogue from the API, the bag (kept in this browser), and the bag drawer.

const KEY = 'arsh.bag.v1';
let shopPromise = null;
const listeners = new Set();

export const money = (n, currency = 'PKR') => `${currency} ${Number(n).toLocaleString('en-PK')}`;

export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  let data = null;
  try { data = await res.json(); } catch { /* empty body */ }
  if (!res.ok) {
    const err = new Error(data?.error || `Request failed (${res.status})`);
    Object.assign(err, { status: res.status, data });
    throw err;
  }
  return data;
}

/** Shop data from the API; falls back to the static placeholder catalogue if the API is unreachable. */
export function loadShop() {
  if (!shopPromise) {
    shopPromise = api('/api/shop').catch(async () => {
      const res = await fetch('/data/catalogue.json');
      const data = await res.json();
      return {
        shopOpen: false, currency: data.currency || 'PKR', offline: true,
        products: data.items.map((it, i) => ({ id: i + 1, slug: it.slug, article: '', name: it.name, image: it.image, meta: it.meta, price: it.price, variants: [] })),
      };
    });
  }
  return shopPromise;
}

// ---------------------------------------------------------------- bag state
function read() {
  try { const v = JSON.parse(localStorage.getItem(KEY) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; }
}
function write(lines) {
  try { localStorage.setItem(KEY, JSON.stringify(lines)); } catch { /* private mode: bag lives for this page only */ }
  memory = lines;
  listeners.forEach((fn) => fn(lines));
}
let memory = read();

export const bag = {
  lines: () => memory,
  count: () => memory.reduce((s, l) => s + l.quantity, 0),
  add(variantId, quantity = 1) {
    const lines = memory.map((l) => ({ ...l }));
    const hit = lines.find((l) => l.variantId === variantId);
    if (hit) hit.quantity = Math.min(5, hit.quantity + quantity);
    else lines.push({ variantId, quantity });
    write(lines);
  },
  set(variantId, quantity) {
    write(memory.map((l) => (l.variantId === variantId ? { ...l, quantity } : l)).filter((l) => l.quantity > 0));
  },
  clear() { write([]); },
  on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
};
addEventListener('storage', (e) => { if (e.key === KEY) { memory = read(); listeners.forEach((fn) => fn(memory)); } });

/** Resolve bag lines against the catalogue. Unknown or unavailable variants are flagged. */
export function resolve(shop, lines = memory) {
  const out = [];
  for (const l of lines) {
    for (const p of shop.products) {
      const v = p.variants.find((x) => x.id === l.variantId);
      if (v) { out.push({ ...l, product: p, variant: v, total: p.price * l.quantity }); break; }
    }
  }
  return out;
}

export function totals(shop, resolved) {
  const subtotal = resolved.reduce((s, l) => s + l.total, 0);
  const shipping = resolved.length === 0 ? 0 : shop.freeShippingOver > 0 && subtotal >= shop.freeShippingOver ? 0 : shop.shippingFlat;
  return { subtotal, shipping, total: subtotal + shipping };
}

// ---------------------------------------------------------------- drawer
let drawer = null;

export function mountBag({ toggle, onOpen, onClose } = {}) {
  const el = document.createElement('dialog');
  el.className = 'bag';
  el.setAttribute('aria-labelledby', 'bag-title');
  el.setAttribute('data-lenis-prevent', '');
  el.innerHTML = `
    <div class="bag__panel">
      <header class="bag__head"><h2 class="ui" id="bag-title">Bag</h2><button type="button" class="ui bag__close">Close</button></header>
      <div class="bag__body"><ul class="bag__lines" role="list"></ul><p class="bag__empty">Your bag is empty.</p></div>
      <footer class="bag__foot">
        <dl class="bag__sum ui"><div><dt>Subtotal</dt><dd class="bag__subtotal"></dd></div><div><dt>Shipping</dt><dd class="bag__shipping"></dd></div></dl>
        <a class="button button--red bag__checkout" href="/checkout">Checkout</a>
      </footer>
    </div>`;
  document.body.append(el);
  const $ = (s) => el.querySelector(s);
  el.addEventListener('click', (e) => { if (e.target === el) el.close(); });
  $('.bag__close').addEventListener('click', () => el.close());
  el.addEventListener('close', () => onClose?.());

  const render = async () => {
    const shop = await loadShop();
    const rows = resolve(shop);
    const t = totals(shop, rows);
    $('.bag__lines').replaceChildren(...rows.map((r) => {
      const li = document.createElement('li');
      li.className = 'bag__line';
      li.innerHTML = `
        <img alt="" width="60" height="150">
        <div class="bag__info"><p class="bag__name"></p><p class="ui bag__meta"></p>
          <div class="bag__qty ui"><button type="button" aria-label="One fewer">−</button><span aria-live="polite"></span><button type="button" aria-label="One more">+</button></div>
        </div>
        <p class="ui bag__price"></p>`;
      li.querySelector('img').src = r.product.image;
      li.querySelector('.bag__name').textContent = r.product.name;
      li.querySelector('.bag__meta').textContent = `Size ${r.variant.size}${r.variant.available ? '' : ' — sold out'}`;
      li.querySelector('.bag__qty span').textContent = r.quantity;
      li.querySelector('.bag__price').textContent = money(r.total, shop.currency);
      const [minus, plus] = li.querySelectorAll('.bag__qty button');
      minus.addEventListener('click', () => bag.set(r.variantId, r.quantity - 1));
      plus.addEventListener('click', () => bag.set(r.variantId, Math.min(5, r.quantity + 1)));
      plus.disabled = r.quantity >= 5;
      return li;
    }));
    el.classList.toggle('is-empty', rows.length === 0);
    $('.bag__subtotal').textContent = money(t.subtotal, shop.currency);
    $('.bag__shipping').textContent = rows.length ? (t.shipping ? money(t.shipping, shop.currency) : 'Complimentary') : '—';
  };

  const updateToggle = () => {
    if (!toggle) return;
    const n = bag.count();
    toggle.querySelector('.count').textContent = n ? `(${n})` : '';
    toggle.setAttribute('aria-label', `Bag, ${n} item${n === 1 ? '' : 's'}`);
  };
  bag.on(() => { updateToggle(); if (el.open) render(); });
  updateToggle();
  toggle?.addEventListener('click', () => drawer.open());

  drawer = {
    async open() { await render(); onOpen?.(); el.showModal(); },
    close() { el.close(); },
    el,
  };
  return drawer;
}
