import { api, money, loadShop, mountBag } from './shop.js';
import { initGrain } from './sections.js';

const $ = (s) => document.querySelector(s);
const params = new URLSearchParams(location.search);
const STEPS = [['pending', 'Received'], ['confirmed', 'Confirmed'], ['packed', 'Registered & packed'], ['shipped', 'Shipped']];
const ORDER = ['pending', 'confirmed', 'packed', 'shipped', 'delivered'];

document.body.append(Object.assign(document.createElement('div'), { className: 'grain' }));
initGrain();
mountBag({ toggle: $('#bag-toggle') });

const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
const date = (d) => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

async function show(o) {
  const shop = await loadShop();
  const view = $('#order-view');
  const isNew = params.get('new') === '1';
  view.replaceChildren();

  const head = el('div', 'order-head');
  const left = el('div');
  left.append(el('p', 'ui', o.number), el('h1', 'display', isNew ? 'Received.' : o.status === 'cancelled' ? 'Cancelled.' : 'Your order.'));
  left.append(el('p', 'lede', isNew
    ? `A confirmation is on its way to you. Placed ${date(o.createdAt)}.`
    : `Placed ${date(o.createdAt)}.`));
  head.append(left);
  view.append(head);

  if (o.status !== 'cancelled') {
    const tl = el('ol', 'timeline ui');
    const at = ORDER.indexOf(o.status);
    for (const [key, label] of STEPS) {
      const li = el('li', ORDER.indexOf(key) <= at ? 'is-done' : '', o.status === 'delivered' && key === 'shipped' ? 'Delivered' : label);
      tl.append(li);
    }
    view.append(tl);
  }

  const grid = el('div', 'order-grid');
  const items = el('div');
  for (const it of o.items) {
    const row = el('div', 'order-item');
    const p = shop.products.find((x) => x.article === it.article);
    const img = el('img'); img.alt = ''; img.width = 64; img.height = 160; img.src = p?.image || '';
    const mid = el('div');
    mid.append(el('h3', null, it.name), el('p', 'ui', `${it.article} — Size ${it.size} × ${it.quantity}`));
    if (it.pieces.length) {
      const pcs = el('div', 'pieces ui');
      for (const pc of it.pieces) {
        const a = el('a', null, `No. ${String(pc.edition).padStart(3, '0')} / ${pc.editionSize}`);
        a.href = new URL(pc.url).pathname;
        pcs.append(a);
      }
      mid.append(pcs);
    }
    row.append(img, mid, el('p', 'ui', money(it.unitPrice * it.quantity, o.currency)));
    items.append(row);
  }
  grid.append(items);

  const side = el('aside');
  const dl = el('dl', 'summary__totals ui');
  const add = (k, v, cls) => { const d = el('div', cls); d.append(el('dt', null, k), el('dd', null, v)); dl.append(d); };
  add('Subtotal', money(o.subtotal, o.currency));
  add('Shipping', o.shipping ? money(o.shipping, o.currency) : 'Complimentary');
  add('Total', money(o.total, o.currency), 'grand');
  add('Payment', `${o.paymentMethod === 'cod' ? 'Cash on delivery' : 'Bank transfer'} — ${o.paymentStatus}`);
  if (o.courier || o.tracking) add('Shipping with', [o.courier, o.tracking].filter(Boolean).join(' · '));
  side.append(dl);
  const addr = el('p', 'lede');
  addr.style.marginTop = '0.75rem';
  addr.textContent = [o.name, o.address.line1, o.address.line2, [o.address.city, o.address.province].filter(Boolean).join(', ')].filter(Boolean).join('\n');
  addr.style.whiteSpace = 'pre-line';
  side.append(el('p', 'ui order-side-label', 'Delivering to'), addr);
  if (o.paymentMethod === 'bank' && o.paymentStatus === 'unpaid' && o.bankDetails) side.append(el('p', 'bank', o.bankDetails));
  side.append(el('p', 'ui order-side-label', `Pieces registered to: ${o.certificateName}`));
  grid.append(side);
  view.append(grid);
  view.hidden = false;
  $('#order-lookup').hidden = true;
  document.title = `${o.number} — ARSH BY HZK`;
  if (params.get('t')) history.replaceState(null, '', `/order?n=${encodeURIComponent(o.number)}&t=${encodeURIComponent(o.token)}`);
}

async function load(query) {
  const o = await api(`/api/orders/lookup?${new URLSearchParams(query)}`);
  await show(o);
}

const lookup = $('#lookup-form');
lookup.addEventListener('submit', async (e) => {
  e.preventDefault();
  const st = $('#lookup-status');
  st.dataset.state = 'pending'; st.textContent = 'Looking';
  try {
    await load({ n: lookup.n.value.trim(), email: lookup.email.value.trim() });
  } catch (err) {
    st.dataset.state = 'error'; st.textContent = err.message;
  }
});

if (params.get('n') && params.get('t')) {
  load({ n: params.get('n'), t: params.get('t') }).catch(() => { $('#order-lookup').hidden = false; });
} else {
  if (params.get('n')) lookup.n.value = params.get('n');
  $('#order-lookup').hidden = false;
}
