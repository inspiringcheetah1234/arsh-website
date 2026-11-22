// ARSH admin — hash-routed single page. Views: overview, orders, order, scan, products, product, qr, batch, settings.
import { openScanner } from './scanner.js';
import { imageManager } from './images.js';
import { viewWaitlist } from './waitlist.js';

const view = document.getElementById('view');
const shell = document.getElementById('shell');
const toastEl = document.getElementById('toast');
let me = null;

// ---------------------------------------------------------------- helpers
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'html') el.innerHTML = v; // only ever used with server-generated SVG
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const kid of kids.flat(Infinity)) if (kid != null && kid !== false) el.append(kid instanceof Node ? kid : String(kid));
  return el;
}
const money = (n, c = 'PKR') => `${c} ${Number(n || 0).toLocaleString('en-PK')}`;
const when = (d) => new Date(d).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const day = (d) => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const pad = (n, w = 3) => String(n).padStart(w, '0');
const pill = (s, label) => h('span', { class: `pill s-${s}` }, label ?? s);

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method, credentials: 'same-origin',
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(method !== 'GET' ? { 'X-Arsh-Admin': '1' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* empty */ }
  if (res.status === 401 && !path.endsWith('/login')) { me = null; renderLogin(); throw Object.assign(new Error('Signed out'), { silent: true }); }
  if (!res.ok) throw Object.assign(new Error(data?.error || `Request failed (${res.status})`), { status: res.status, data });
  return data;
}

let toastTimer = 0;
function toast(text, err = false) {
  toastEl.textContent = text;
  toastEl.classList.toggle('err', err);
  toastEl.classList.add('is-on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('is-on'), 3200);
}
const fail = (err) => { if (!err.silent) toast(err.message, true); };

function page(title, actions, ...body) {
  view.replaceChildren(h('header', {}, h('h1', {}, title), actions ? h('div', { class: 'row' }, actions) : null), ...body);
  view.focus({ preventScroll: true });
}

// ---------------------------------------------------------------- auth
function renderLogin(error = '') {
  shell.hidden = true;
  document.querySelector('.login')?.remove();
  const err = h('p', { class: 'err', role: 'alert' }, error);
  const form = h('form', { novalidate: true },
    h('span', { class: 'wordmark', role: 'img', 'aria-label': 'Arsh by HZK' }),
    h('label', { class: 'f' }, 'Email', h('input', { name: 'email', type: 'email', autocomplete: 'username', required: true })),
    h('label', { class: 'f' }, 'Password', h('input', { name: 'password', type: 'password', autocomplete: 'current-password', required: true })),
    h('button', { class: 'btn', type: 'submit' }, 'Sign in'), err);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.textContent = '';
    try {
      const r = await api('/api/admin/login', { method: 'POST', body: { email: form.email.value, password: form.password.value } });
      me = r.admin;
      document.querySelector('.login').remove();
      boot();
    } catch (x) { err.textContent = x.message; }
  });
  document.body.prepend(h('div', { class: 'login' }, form));
  form.email.focus();
}

document.getElementById('logout').addEventListener('click', async () => {
  await api('/api/admin/logout', { method: 'POST' }).catch(() => {});
  me = null;
  renderLogin();
});

// ---------------------------------------------------------------- router
const routes = [
  [/^#?\/?$/, 'dashboard', viewDashboard],
  [/^#\/orders$/, 'orders', viewOrders],
  [/^#\/orders\/(\d+)$/, 'orders', viewOrder],
  [/^#\/scan$/, 'scan', viewScan],
  [/^#\/products$/, 'products', viewProducts],
  [/^#\/products\/(new|\d+)$/, 'products', viewProduct],
  [/^#\/qr$/, 'qr', viewBatches],
  [/^#\/qr\/(\d+)$/, 'qr', viewBatch],
  [/^#\/waitlist$/, 'waitlist', (_, qs) => viewWaitlist({ h, api, page, toast, fail, when, day, pill }, qs)],
  [/^#\/settings$/, 'settings', viewSettings],
];
async function route() {
  if (!me) return;
  const hash = location.hash || '#/';
  const [path, qs] = hash.split('?');
  for (const [re, nav, fn] of routes) {
    const m = path.match(re);
    if (m) {
      document.querySelectorAll('[data-nav]').forEach((a) => { if (a.dataset.nav === nav) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
      view.replaceChildren(h('p', { class: 'muted' }, 'Loading…'));
      try { await fn(m[1], new URLSearchParams(qs || '')); } catch (err) { fail(err); }
      return;
    }
  }
  page('Not found', null, h('p', {}, h('a', { href: '#/' }, 'Back to overview')));
}
addEventListener('hashchange', route);

async function boot() {
  shell.hidden = false;
  document.getElementById('me').textContent = me.email;
  await route();
}

// ---------------------------------------------------------------- overview
// Website status: waitlist only → early access (waitlist members unlock prices) → open to everyone.
function launchCard(settings) {
  const phase = settings.launchPhase || 'waitlist';
  const STEPS = [
    ['waitlist', 'Waitlist only', 'Everyone who opens the website is sent to the waitlist page.'],
    ['early', 'Early access', 'The whole website is visible. Prices and Buy now are locked; waitlist members unlock them with their email.'],
    ['open', 'Open to everyone', 'Anyone can see prices and order.'],
  ];
  const go = async (next, question) => {
    if (!confirm(question)) return;
    try { await api('/api/admin/launch', { method: 'POST', body: { phase: next } }); toast('Website status updated'); viewDashboard(); }
    catch (err) { fail(err); }
  };
  const btn = (label, next, question, primary) => h('button', { class: `btn${primary ? '' : ' btn--ghost'}`, type: 'button', onclick: () => go(next, question) }, label);
  const current = STEPS.find(([k]) => k === phase);
  const owner = me?.role === 'owner';
  return h('div', { class: 'card', style: 'margin-bottom:1.5rem' },
    h('h2', {}, 'Website status'),
    h('p', { style: 'margin:.5rem 0 0' }, h('b', {}, `Now: ${current[1]}. `), current[2]),
    phase === 'early' && settings.earlyOpenedAt ? h('p', { class: 'muted', style: 'margin:.5rem 0 0' }, `Early access opened ${new Date(settings.earlyOpenedAt).toLocaleString('en-GB')}. People who join the waitlist after this wait for the public opening.`) : null,
    owner ? h('div', { class: 'row', style: 'margin-top:1rem;flex-wrap:wrap;gap:.5rem' },
      phase !== 'early' ? btn('Open early access', 'early', 'Open early access now? The whole website becomes visible; prices and buying stay locked except for waitlist members.', phase === 'waitlist') : null,
      phase !== 'open' ? btn('Open to everyone', 'open', 'Open the website to everyone now? Anyone will be able to see prices and order.', phase === 'early') : null,
      phase !== 'waitlist' ? btn('Back to waitlist only', 'waitlist', 'Hide the website again and send everyone to the waitlist page?') : null)
      : h('p', { class: 'muted', style: 'margin-top:1rem' }, 'Only the owner can change this.'));
}

async function viewDashboard() {
  const [d, { settings }] = await Promise.all([api('/api/admin/dashboard'), api('/api/admin/settings')]);
  const kpi = (label, value, href, alert) => h('a', { class: `kpi${alert ? ' is-alert' : ''}`, href }, h('span', { class: 'ui muted' }, label), h('b', {}, value));
  page('Overview', h('a', { class: 'btn btn--scan', href: '#/scan' }, 'Scan a piece'),
    launchCard(settings),
    h('div', { class: 'kpis' },
      kpi('Orders to scan', d.toScan, '#/orders?status=confirmed', d.toScan > 0),
      kpi('New orders', d.byStatus.pending || 0, '#/orders?status=pending', (d.byStatus.pending || 0) > 0),
      kpi('Sales, 30 days', money(d.sales.revenue), '#/orders'),
      kpi('Pieces registered', `${d.pieces.assigned}`, '#/qr')),
    h('div', { class: 'order' },
      h('section', { class: 'stack' }, h('div', {},
        h('h2', {}, 'Latest orders'), ordersTable(d.recent))),
      h('section', { class: 'stack' },
        h('div', { class: 'card' }, h('h2', {}, 'QR codes'),
          h('dl', { class: 'kv' }, h('dt', {}, 'Blank'), h('dd', {}, d.pieces.blank), h('dt', {}, 'Registered'), h('dd', {}, d.pieces.assigned)),
          d.pieces.blank < 50 ? h('p', { style: 'margin-top:1rem' }, h('a', { href: '#/qr' }, 'Generate a new batch of 250')) : null),
        h('div', { class: 'card' }, h('h2', {}, 'Waitlist'),
          h('dl', { class: 'kv' }, h('dt', {}, 'Waiting'), h('dd', {}, d.waitlist.waiting), h('dt', {}, 'Total'), h('dd', {}, d.waitlist.total)),
          h('p', { style: 'margin-top:1rem' }, h('a', { href: '#/waitlist' }, 'Open the waitlist'))),
        h('div', { class: 'card' }, h('h2', {}, 'Low stock'),
          d.lowStock.length ? h('dl', { class: 'kv' }, d.lowStock.map((v) => [h('dt', {}, `${v.article} · ${v.size}`), h('dd', {}, v.stock === 0 ? 'Sold out' : `${v.stock} left`)]))
            : h('p', { class: 'muted' }, 'Nothing low.')))));
}

function ordersTable(orders) {
  if (!orders.length) return h('div', { class: 'table-wrap' }, h('p', { class: 'empty' }, 'No orders yet.'));
  return h('div', { class: 'table-wrap' }, h('table', {},
    h('thead', {}, h('tr', {}, h('th', {}, 'Order'), h('th', {}, 'Date'), h('th', {}, 'Customer'), h('th', {}, 'Pieces'), h('th', { class: 'num' }, 'Total'), h('th', {}, 'Status'), h('th', {}, 'Payment'))),
    h('tbody', {}, orders.map((o) => h('tr', { class: 'click', onclick: () => { location.hash = `#/orders/${o.id}`; } },
      h('td', {}, h('a', { href: `#/orders/${o.id}` }, o.number)),
      h('td', { class: 'muted' }, when(o.created_at)),
      h('td', {}, o.name),
      h('td', {}, `${o.registered} / ${o.units}`),
      h('td', { class: 'num' }, money(o.total, o.currency)),
      h('td', {}, pill(o.status)),
      h('td', {}, pill(o.payment_status), ' ', h('span', { class: 'muted ui' }, o.payment_method)))))));
}

// ---------------------------------------------------------------- orders
async function viewOrders(_, qs) {
  const status = qs.get('status') || '';
  const q = qs.get('q') || '';
  const pageNo = Number(qs.get('page')) || 1;
  const d = await api(`/api/admin/orders?${new URLSearchParams({ status, q, page: pageNo })}`);
  const go = (patch) => { location.hash = `#/orders?${new URLSearchParams({ status, q, ...patch })}`; };
  const search = h('form', { class: 'row', role: 'search', onsubmit: (e) => { e.preventDefault(); go({ q: e.target.q.value.trim() }); } },
    h('label', { class: 'sr-only', for: 'oq' }, 'Search orders'),
    h('input', { id: 'oq', name: 'q', value: q, placeholder: 'Number, name, email, phone', style: 'max-width:20rem' }),
    h('button', { class: 'btn btn--ghost', type: 'submit' }, 'Search'));
  const tabs = h('div', { class: 'tabs', role: 'group', 'aria-label': 'Filter by status' },
    ['', 'pending', 'confirmed', 'packed', 'shipped', 'delivered', 'cancelled'].map((s) =>
      h('button', { type: 'button', 'aria-pressed': String(s === status), onclick: () => go({ status: s }) }, s || 'All')));
  page('Orders', search, tabs, ordersTable(d.orders),
    h('div', { class: 'row', style: 'margin-top:1rem' },
      pageNo > 1 ? h('button', { class: 'btn btn--ghost btn--sm', onclick: () => go({ page: pageNo - 1 }) }, 'Newer') : null,
      d.more ? h('button', { class: 'btn btn--ghost btn--sm', onclick: () => go({ page: pageNo + 1 }) }, 'Older') : null));
}

let products = null;
async function productImages() {
  if (!products) products = (await api('/api/admin/products')).products;
  return products;
}

async function viewOrder(id) {
  const [d, prods] = await Promise.all([api(`/api/admin/orders/${id}`), productImages()]);
  renderOrder(d, prods);
}

function renderOrder(d, prods) {
  const { order: o, items, events, complete } = d;
  const units = items.reduce((s, i) => s + i.quantity, 0);
  const done = items.reduce((s, i) => s + i.pieces.length, 0);
  const cancelled = o.status === 'cancelled';
  const reload = (next) => renderOrder(next, prods);

  const scan = (item = null) => openScanner({
    title: item ? `${item.article} · size ${item.size}` : `${o.number} — scan pieces`,
    onCode: async (text, chosen) => {
      try {
        const r = await api(`/api/admin/orders/${o.id}/assign`, { method: 'POST', body: { code: text, itemId: chosen || item?.id || null } });
        reload(r.order);
        const left = r.order.items.reduce((s, i) => s + i.quantity - i.pieces.length, 0);
        const msg = r.result.already ? 'Already registered to this order.' : `${r.result.message}.`;
        return { ok: true, message: left ? `${msg} ${left} to go.` : `${msg} All pieces registered.`, keepOpen: left > 0 && !item };
      } catch (err) {
        if (err.data?.needsItem) {
          const open = items.filter((i) => i.pieces.length < i.quantity);
          return { ok: false, message: 'Which piece is this?', pick: open.map((i) => ({ label: `${i.article} — ${i.name}, size ${i.size}`, value: i.id })) };
        }
        return { ok: false, message: err.message };
      }
    },
  });

  const release = async (code, label) => {
    if (!confirm(`Release ${label} from this order? The code becomes blank again.`)) return;
    try { await api(`/api/admin/pieces/${code}/unassign`, { method: 'POST' }); reload(await api(`/api/admin/orders/${o.id}`)); toast('Released'); } catch (e) { fail(e); }
  };

  const lines = items.map((it) => {
    const img = prods.find((p) => p.id === it.product_id)?.image;
    const open = it.quantity - it.pieces.length;
    return h('div', { class: 'line' },
      h('img', { src: img || '', alt: '', width: 56, height: 140 }),
      h('div', {},
        h('h3', {}, it.name),
        h('p', { class: 'ui muted' }, `${it.article} · size ${it.size} · × ${it.quantity}`),
        h('div', { class: 'slots' },
          it.pieces.map((p) => h('span', { class: 'slot' }, h('span', {}, `No. ${pad(p.edition_number)} / ${p.edition_size}`), h('span', { class: 'mono' }, p.serial),
            cancelled ? null : h('button', { type: 'button', title: 'Release', 'aria-label': `Release ${p.serial}`, onclick: () => release(p.code, p.serial) }, '×'))),
          Array.from({ length: Math.max(0, open) }, () => h('span', { class: 'slot slot--open' }, 'Awaiting scan')))),
      h('div', { class: 'stack', style: 'gap:.5rem;justify-items:end' },
        h('span', {}, money(it.unit_price * it.quantity, o.currency)),
        open > 0 && !cancelled ? h('button', { class: 'btn btn--sm', onclick: () => scan(it) }, 'Scan') : null));
  });

  const statusSel = h('select', { id: 'st' }, ['pending', 'confirmed', 'packed', 'shipped', 'delivered', 'cancelled'].map((s) => h('option', { value: s, selected: s === o.status }, s)));
  const paySel = h('select', { id: 'pay' }, ['unpaid', 'paid', 'refunded'].map((s) => h('option', { value: s, selected: s === o.payment_status }, s)));
  const courier = h('input', { id: 'courier', value: o.courier, placeholder: 'TCS, Leopards, M&P…' });
  const tracking = h('input', { id: 'tracking', value: o.tracking });
  const certName = h('input', { id: 'cert', value: o.certificate_name, maxlength: 80 });
  const note = h('textarea', { id: 'note', placeholder: 'Internal note (only staff see this)', rows: 3 });

  const save = async (extra = {}) => {
    const body = { status: statusSel.value, paymentStatus: paySel.value, courier: courier.value, tracking: tracking.value, certificateName: certName.value, note: note.value.trim() || undefined, ...extra };
    if (body.status === 'cancelled' && o.status !== 'cancelled' && !confirm('Cancel this order? Stock is restored and any registered pieces are released.')) return;
    try {
      reload(await api(`/api/admin/orders/${o.id}`, { method: 'PATCH', body }));
      toast('Saved');
    } catch (err) {
      if (err.status === 422 && err.data?.missing && confirm(`${err.message}.\n\nSave anyway without registering every piece?`)) return save({ force: true });
      fail(err);
    }
  };

  const a = o.address || {};
  page(o.number,
    [pill(o.status), !cancelled && done < units ? h('button', { class: 'btn btn--scan', onclick: () => scan() }, `Scan pieces (${done}/${units})`) : null],
    !cancelled ? h('div', { class: `banner${done >= units ? ' is-done' : ''}` },
      h('div', {}, h('strong', {}, done >= units ? 'Every piece is registered.' : `${units - done} piece${units - done > 1 ? 's' : ''} to scan before packing.`),
        h('div', { class: 'progress', style: 'width:min(22rem,60vw)' }, h('span', { style: `width:${units ? (done / units) * 100 : 0}%` }))),
      done < units ? h('span', { class: 'muted' }, 'Scan the code sewn into each jean.') : null) : null,
    h('div', { class: 'order' },
      h('div', { class: 'stack' },
        h('section', { class: 'card' }, h('h2', {}, 'Pieces'), lines,
          h('dl', { class: 'kv', style: 'margin-top:1.25rem' },
            h('dt', {}, 'Subtotal'), h('dd', {}, money(o.subtotal, o.currency)),
            h('dt', {}, 'Shipping'), h('dd', {}, money(o.shipping, o.currency)),
            h('dt', {}, 'Total'), h('dd', {}, h('strong', {}, money(o.total, o.currency))))),
        h('section', { class: 'card' }, h('h2', {}, 'Timeline'),
          h('div', { class: 'events' }, events.slice().reverse().map((e) => h('div', { class: 'event' }, h('time', {}, when(e.created_at)), h('div', {}, e.message, h('small', {}, e.actor))))))),
      h('div', { class: 'stack' },
        h('section', { class: 'card stack' }, h('h2', { style: 'margin:0' }, 'Fulfilment'),
          h('div', { class: 'grid2' }, h('label', { class: 'f' }, 'Status', statusSel), h('label', { class: 'f' }, 'Payment', paySel)),
          h('div', { class: 'grid2' }, h('label', { class: 'f' }, 'Courier', courier), h('label', { class: 'f' }, 'Tracking number', tracking)),
          h('label', { class: 'f' }, 'Name on pieces', certName),
          h('label', { class: 'f' }, 'Note', note),
          h('button', { class: 'btn', onclick: () => save() }, 'Save')),
        h('section', { class: 'card' }, h('h2', {}, 'Customer'),
          h('dl', { class: 'kv' },
            h('dt', {}, 'Name'), h('dd', {}, o.name),
            h('dt', {}, 'Email'), h('dd', {}, h('a', { href: `mailto:${o.email}` }, o.email)),
            h('dt', {}, 'Phone'), h('dd', {}, h('a', { href: `tel:${o.phone.replace(/\s/g, '')}` }, o.phone)),
            h('dt', {}, 'Address'), h('dd', { style: 'white-space:pre-line' }, [a.line1, a.line2, [a.city, a.province, a.postal].filter(Boolean).join(', ')].filter(Boolean).join('\n')),
            h('dt', {}, 'Payment'), h('dd', {}, o.payment_method === 'cod' ? 'Cash on delivery' : 'Bank transfer'),
            o.notes ? [h('dt', {}, 'Notes'), h('dd', {}, o.notes)] : null,
            h('dt', {}, 'Placed'), h('dd', {}, when(o.created_at)))),
        h('a', { href: `/order?n=${encodeURIComponent(o.number)}`, class: 'muted', target: '_blank', rel: 'noopener' }, 'Customer order page'))));
}

// ---------------------------------------------------------------- scan lookup
async function viewScan() {
  const out = h('div', { class: 'stack' });
  const show = (p) => {
    const reg = p.status === 'assigned';
    out.prepend(h('section', { class: 'card' },
      h('div', { class: 'row', style: 'justify-content:space-between' }, h('span', { class: 'mono' }, `${p.serial} · ${p.code}`), pill(p.status)),
      h('dl', { class: 'kv', style: 'margin-top:1rem' },
        h('dt', {}, 'Batch'), h('dd', {}, h('a', { href: `#/qr/${p.batch_id}` }, p.batch_label)),
        reg ? [
          h('dt', {}, 'Piece'), h('dd', {}, `${p.article} — ${p.product_name}, size ${p.size}`),
          h('dt', {}, 'Number'), h('dd', {}, `No. ${pad(p.edition_number)} / ${p.edition_size}`),
          h('dt', {}, 'Owner'), h('dd', {}, p.owner_name),
          h('dt', {}, 'Order'), h('dd', {}, h('a', { href: `#/orders/${p.order_id}` }, p.order_number)),
          h('dt', {}, 'Registered'), h('dd', {}, `${when(p.assigned_at)} by ${p.assigned_by}`),
        ] : null,
        h('dt', {}, 'Scans'), h('dd', {}, p.scans)),
      h('div', { class: 'row', style: 'margin-top:1rem' },
        h('a', { class: 'btn btn--ghost btn--sm', href: `/p/${p.code}`, target: '_blank', rel: 'noopener' }, 'Public page'),
        p.status === 'unassigned' ? h('button', { class: 'btn btn--danger btn--sm', onclick: async (e) => {
          if (!confirm('Void this code? Use this for damaged or misprinted labels.')) return;
          try { await api(`/api/admin/pieces/${p.code}/void`, { method: 'POST' }); e.target.closest('.card').remove(); toast('Voided'); } catch (x) { fail(x); }
        } }, 'Void code') : null)));
  };
  const lookup = async (text) => {
    try {
      const p = await api(`/api/admin/pieces/${encodeURIComponent(text.trim().split('/').pop())}`);
      show(p);
      return { ok: true, message: `${p.serial}: ${p.status === 'assigned' ? `${p.article} No. ${pad(p.edition_number)} — ${p.owner_name}` : p.status}`, keepOpen: true };
    } catch (err) { return { ok: false, message: err.message }; }
  };
  const manual = h('form', { class: 'row', onsubmit: async (e) => { e.preventDefault(); const r = await lookup(e.target.code.value); if (!r.ok) toast(r.message, true); e.target.reset(); } },
    h('label', { class: 'sr-only', for: 'lk' }, 'Code'), h('input', { id: 'lk', name: 'code', placeholder: 'Code or link', style: 'max-width:20rem', autocomplete: 'off' }),
    h('button', { class: 'btn btn--ghost', type: 'submit' }, 'Look up'));
  page('Scan', h('button', { class: 'btn btn--scan', onclick: () => openScanner({ title: 'Look up a piece', onCode: lookup }) }, 'Open camera'),
    h('p', { class: 'muted', style: 'margin-bottom:1.5rem;max-width:40rem' }, 'Look up any code: see whether it is blank, which order it belongs to, and its number. To register pieces to an order, open the order and press Scan.'),
    manual, h('div', { style: 'height:1.5rem' }), out);
}

// ---------------------------------------------------------------- products
async function viewProducts() {
  products = null;
  const list = await productImages();
  page('Products', h('a', { class: 'btn', href: '#/products/new' }, 'New product'),
    h('div', { class: 'table-wrap' }, h('table', {},
      h('thead', {}, h('tr', {}, h('th', {}, ''), h('th', {}, 'Article'), h('th', {}, 'Name'), h('th', { class: 'num' }, 'Price'), h('th', {}, 'Edition'), h('th', {}, 'Stock'), h('th', {}, 'Status'))),
      h('tbody', {}, list.map((p) => h('tr', { class: 'click', onclick: () => { location.hash = `#/products/${p.id}`; } },
        h('td', { style: 'width:3rem' }, h('img', { src: p.image, alt: '', width: 24, height: 60, style: 'display:block;height:3rem;width:auto' })),
        h('td', { class: 'mono' }, p.article),
        h('td', {}, h('a', { href: `#/products/${p.id}` }, p.name)),
        h('td', { class: 'num' }, money(p.price)),
        h('td', {}, `${p.registered} / ${p.edition_size}`),
        h('td', {}, p.variants.map((v) => `${v.size}:${v.stock}`).join('  ')),
        h('td', {}, pill(p.status))))))));
}

async function viewProduct(id) {
  const isNew = id === 'new';
  const p = isNew
    ? { name: '', slug: '', article: '', description: '', fit: '', wash: '', fabric: '', price: 0, edition_size: 250, image: '/assets/catalogue/', status: 'draft', sort: 0, variants: ['28', '30', '32', '34', '36'].map((size) => ({ size, stock: 0 })), registered: 0 }
    : (await productImages()).find((x) => x.id === Number(id));
  if (!p) return page('Not found', null);
  const f = {};
  const field = (key, label, attrs = {}) => h('label', { class: 'f' }, label, f[key] = h(attrs.tag || 'input', { value: attrs.tag ? null : p[key], ...attrs, tag: null }, attrs.tag === 'textarea' ? p[key] : null));
  const vbody = h('tbody');
  const addRow = (v = { size: '', stock: 0 }) => vbody.append(h('tr', {},
    h('td', {}, h('input', { value: v.size, 'aria-label': 'Size', class: 'v-size', style: 'max-width:7rem' })),
    h('td', {}, h('input', { type: 'number', min: 0, value: v.stock, 'aria-label': 'Stock', class: 'v-stock', style: 'max-width:8rem' })),
    h('td', {}, h('button', { type: 'button', class: 'link', onclick: (e) => e.target.closest('tr').remove() }, 'Remove'))));
  p.variants.forEach(addRow);
  const status = h('select', {}, ['active', 'draft', 'archived'].map((s) => h('option', { value: s, selected: s === p.status }, s)));

  const save = async (e) => {
    e.preventDefault();
    const body = {
      name: f.name.value, slug: f.slug.value, article: f.article.value, description: f.description.value,
      fit: f.fit.value, wash: f.wash.value, fabric: f.fabric.value, price: Number(f.price.value), edition_size: Number(f.edition_size.value),
      image: f.image.value, sort: Number(f.sort.value), status: status.value,
      variants: [...vbody.querySelectorAll('tr')].map((tr) => ({ size: tr.querySelector('.v-size').value.trim(), stock: Number(tr.querySelector('.v-stock').value) })).filter((v) => v.size),
    };
    try {
      const r = await api(isNew ? '/api/admin/products' : `/api/admin/products/${p.id}`, { method: isNew ? 'POST' : 'PATCH', body });
      products = null;
      toast('Saved');
      location.hash = `#/products/${r.id}`;
      if (!isNew) viewProduct(String(r.id));
    } catch (err) { fail(err); }
  };

  page(isNew ? 'New product' : p.name, h('a', { class: 'btn btn--ghost', href: '#/products' }, 'All products'),
    h('form', { class: 'order', onsubmit: save },
      h('div', { class: 'card stack' },
        h('div', { class: 'grid3' }, field('article', 'Article code', { required: true, placeholder: 'A11' }), field('name', 'Name', { required: true }), field('slug', 'Slug (URL)', { required: true, placeholder: 'straight-rinse' })),
        field('description', 'Description', { tag: 'textarea' }),
        h('div', { class: 'grid3' }, field('fit', 'Fit'), field('wash', 'Wash'), field('fabric', 'Fabric')),
        h('div', { class: 'grid3' }, field('price', 'Price (PKR)', { type: 'number', min: 0, required: true }), field('edition_size', 'Edition size (the x in 1 of x)', { type: 'number', min: 1, required: true }), field('sort', 'Order in lineup', { type: 'number' })),
        h('div', {}, h('h2', {}, 'Sizes & stock'),
          h('div', { class: 'table-wrap' }, h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'Size'), h('th', {}, 'Stock'), h('th', {}, ''))), vbody)),
          h('button', { type: 'button', class: 'link', style: 'margin-top:.75rem', onclick: () => addRow() }, 'Add size'))),
      h('div', { class: 'card stack' },
        h('label', { class: 'f' }, 'Status', status),
        isNew ? h('p', { class: 'muted' }, 'Save the product first, then add its cutout and photos.') : null,
        h('details', {}, h('summary', { class: 'ui muted' }, 'Image path (advanced)'),
          h('div', { style: 'margin-top:.75rem' }, field('image', 'Lineup image URL'))),
        isNew ? null : h('p', { class: 'muted' }, `${p.registered} of ${p.edition_size} numbered pieces registered.`),
        h('button', { class: 'btn', type: 'submit' }, 'Save product'))),
    isNew ? null : imageManager({
      product: p, h, api, toast, fail,
      onCutout: (url) => { f.image.value = url; p.image = url; products = null; },
    }));
}

// ---------------------------------------------------------------- QR batches
async function viewBatches() {
  const [{ batches, defaultSize }, prods] = await Promise.all([api('/api/admin/batches'), productImages()]);
  const size = h('input', { type: 'number', min: 1, max: 1000, value: defaultSize, id: 'bs' });
  const label = h('input', { id: 'bl', placeholder: 'Optional, e.g. "Spring patch run"' });
  const product = h('select', { id: 'bp' }, h('option', { value: '' }, 'Any article'), prods.map((p) => h('option', { value: p.id }, `${p.article} — ${p.name}`)));
  const create = async (e) => {
    e.preventDefault();
    const btn = e.submitter; btn.disabled = true;
    try {
      const r = await api('/api/admin/batches', { method: 'POST', body: { size: Number(size.value), label: label.value, productId: product.value ? Number(product.value) : null } });
      toast('Batch created');
      location.hash = `#/qr/${r.id}`;
    } catch (err) { fail(err); btn.disabled = false; }
  };
  page('QR codes', null,
    h('p', { class: 'muted', style: 'max-width:44rem;margin-bottom:1.5rem' }, 'Codes are printed blank and sewn into each jean. When an order is packed, scanning a code registers that jean to the customer: article, number in the edition, and date.'),
    h('form', { class: 'card', onsubmit: create, style: 'margin-bottom:1.5rem' },
      h('h2', {}, 'New batch'),
      h('div', { class: 'grid3' }, h('label', { class: 'f' }, 'Codes', size), h('label', { class: 'f' }, 'Label', label), h('label', { class: 'f' }, 'Reserve for', product)),
      h('div', { class: 'row', style: 'margin-top:1rem' }, h('button', { class: 'btn', type: 'submit' }, 'Generate'), h('span', { class: 'muted' }, 'Leave “Any article” unless the labels are printed for one style.'))),
    batches.length ? h('div', { class: 'table-wrap' }, h('table', {},
      h('thead', {}, h('tr', {}, h('th', {}, 'Batch'), h('th', {}, 'Created'), h('th', {}, 'For'), h('th', {}, 'Registered'), h('th', {}, 'Blank'), h('th', {}, ''))),
      h('tbody', {}, batches.map((b) => h('tr', { class: 'click', onclick: () => { location.hash = `#/qr/${b.id}`; } },
        h('td', {}, h('a', { href: `#/qr/${b.id}` }, b.label)), h('td', { class: 'muted' }, day(b.created_at)),
        h('td', {}, b.article || 'Any'), h('td', {}, `${b.assigned} / ${b.total}`), h('td', {}, b.total - b.assigned - b.void),
        h('td', {}, h('a', { href: `/api/admin/batches/${b.id}/sheet`, target: '_blank', rel: 'noopener', onclick: (e) => e.stopPropagation() }, 'Print')))))))
      : h('div', { class: 'card empty' }, 'No batches yet.'));
}

async function viewBatch(id) {
  const { batch, pieces } = await api(`/api/admin/batches/${id}`);
  const counts = pieces.reduce((c, p) => ({ ...c, [p.status]: (c[p.status] || 0) + 1 }), {});
  const serial = (seq) => `B${pad(batch.id)}-${pad(seq)}`;
  page(batch.label, [
    h('a', { class: 'btn', href: `/api/admin/batches/${batch.id}/sheet`, target: '_blank', rel: 'noopener' }, 'Print labels'),
    h('a', { class: 'btn btn--ghost', href: `/api/admin/batches/${batch.id}/csv` }, 'Download CSV')],
    h('p', { class: 'muted', style: 'margin-bottom:1.5rem' },
      `${pieces.length} codes · ${counts.assigned || 0} registered · ${counts.unassigned || 0} blank${counts.void ? ` · ${counts.void} void` : ''}${batch.article ? ` · reserved for ${batch.article}` : ''} · created ${day(batch.created_at)}`),
    h('div', { class: 'codes' }, pieces.map((p) => h('a', { class: 'code', href: p.order_id ? `#/orders/${p.order_id}` : `/p/${p.code}`, target: p.order_id ? null : '_blank', rel: 'noopener' },
      h('b', { class: 'mono' }, serial(p.seq)), h('span', { class: 'mono muted' }, p.code),
      p.status === 'assigned' ? h('span', {}, `${p.article} No. ${pad(p.edition_number)} · ${p.order_number}`) : pill(p.status)))));
}

// ---------------------------------------------------------------- settings
async function viewSettings() {
  const [{ settings: s }, { admins }, { emails }] = await Promise.all([
    api('/api/admin/settings'), api('/api/admin/admins'), api('/api/admin/emails')]);
  const owner = me.role === 'owner';
  const shopOpen = h('input', { type: 'checkbox', checked: s.shopOpen });
  const shipping = h('input', { type: 'number', min: 0, value: s.shippingFlat });
  const free = h('input', { type: 'number', min: 0, value: s.freeShippingOver });
  const cod = h('input', { type: 'checkbox', checked: s.paymentMethods.includes('cod') });
  const bank = h('input', { type: 'checkbox', checked: s.paymentMethods.includes('bank') });
  const bankDetails = h('textarea', { rows: 4 }, s.bankDetails);
  const siteUrl = h('input', { value: s.siteUrl, placeholder: location.origin });
  const ownerDisplay = h('select', {}, [['first-initial', 'First name + initial (Hammad Z.)'], ['first', 'First name only'], ['full', 'Full name']].map(([v, l]) => h('option', { value: v, selected: v === s.ownerDisplay }, l)));
  const notify = h('input', { type: 'email', value: s.notifyEmail, placeholder: 'orders@…' });
  const localInput = (iso) => { if (!iso) return ''; const d = new Date(iso); return new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 16); };
  const launchAt = h('input', { type: 'datetime-local', value: localInput(s.launchAt) });
  const dataBank = h('input', { type: 'email', value: s.dataBankEmail, placeholder: 'databank@…' });
  const dataBankAuto = h('input', { type: 'checkbox', checked: s.dataBankAuto });
  const save = async (e) => {
    e.preventDefault();
    try {
      await api('/api/admin/settings', { method: 'PATCH', body: {
        shopOpen: shopOpen.checked, shippingFlat: Number(shipping.value), freeShippingOver: Number(free.value),
        paymentMethods: [cod.checked && 'cod', bank.checked && 'bank'].filter(Boolean), bankDetails: bankDetails.value,
        siteUrl: siteUrl.value.trim(), ownerDisplay: ownerDisplay.value, notifyEmail: notify.value.trim(),
        launchAt: launchAt.value ? new Date(launchAt.value).toISOString() : '', dataBankEmail: dataBank.value.trim(), dataBankAuto: dataBankAuto.checked } });
      toast('Settings saved');
    } catch (err) { fail(err); }
  };
  const staffForm = h('form', { class: 'grid3', onsubmit: async (e) => {
    e.preventDefault();
    const t = e.target;
    try { await api('/api/admin/admins', { method: 'POST', body: { email: t.email.value, name: t.name.value, password: t.password.value } }); toast('Staff added'); viewSettings(); } catch (x) { fail(x); }
  } }, h('label', { class: 'f' }, 'Email', h('input', { name: 'email', type: 'email', required: true })), h('label', { class: 'f' }, 'Name', h('input', { name: 'name' })),
  h('label', { class: 'f' }, 'Temporary password', h('input', { name: 'password', type: 'password', minlength: 10, required: true, autocomplete: 'new-password' })),
  h('button', { class: 'btn btn--ghost', type: 'submit' }, 'Add staff'));

  page('Settings', null, h('div', { class: 'order' },
    h('form', { class: 'card stack', onsubmit: save },
      h('h2', { style: 'margin:0' }, 'Shop'),
      h('label', { class: 'check' }, shopOpen, 'Shop open — customers can check out. Off = “Request Access” only.'),
      h('div', { class: 'grid2' }, h('label', { class: 'f' }, 'Shipping (PKR)', shipping), h('label', { class: 'f' }, 'Free shipping over (0 = never)', free)),
      h('div', {}, h('p', { class: 'ui muted', style: 'margin-bottom:.5rem' }, 'Payment methods'), h('div', { class: 'row' }, h('label', { class: 'check' }, cod, 'Cash on delivery'), h('label', { class: 'check' }, bank, 'Bank transfer'))),
      h('label', { class: 'f' }, 'Bank details (shown for bank transfer)', bankDetails),
      h('label', { class: 'f' }, 'Site URL (inside QR codes and emails)', siteUrl),
      h('label', { class: 'f' }, 'Owner name on piece pages', ownerDisplay),
      h('label', { class: 'f' }, 'New-order alerts to', notify),
      h('h2', { style: 'margin:1rem 0 0' }, 'Waitlist'),
      h('label', { class: 'f' }, 'Opening date and time (drives the countdown on /waitlist and in emails; empty = no countdown)', launchAt),
      h('label', { class: 'f' }, 'Data bank email (every waitlist signup is copied here)', dataBank),
      h('label', { class: 'check' }, dataBankAuto, 'Copy each new signup to the data bank automatically'),
      owner ? h('button', { class: 'btn', type: 'submit' }, 'Save settings') : h('p', { class: 'muted' }, 'Only the owner can change settings.')),
    h('div', { class: 'stack' },
      h('section', { class: 'card' }, h('h2', {}, 'Team'),
        h('dl', { class: 'kv' }, admins.map((a) => [h('dt', {}, a.role), h('dd', {}, `${a.email}${a.name ? ` — ${a.name}` : ''}`)])),
        owner ? h('div', { style: 'margin-top:1.25rem' }, staffForm) : null),
      h('section', { class: 'card' }, h('h2', {}, 'Email log'),
        h('p', { class: 'muted', style: 'margin-bottom:1rem;font-size:.8125rem' }, 'Without RESEND_API_KEY, emails are recorded here instead of sent.'),
        emails.length ? h('div', { class: 'events' }, emails.slice(0, 20).map((e) => h('details', {}, h('summary', {}, `${when(e.created_at)} — ${e.subject} → ${e.recipient} (${e.status})`), h('pre', { style: 'white-space:pre-wrap;font-size:.8125rem' }, e.body))))
          : h('p', { class: 'muted' }, 'Nothing sent yet.')))));
}

// ---------------------------------------------------------------- start
api('/api/admin/me').then((r) => { me = r.admin; boot(); }).catch((err) => { if (!err.silent) renderLogin(); });
