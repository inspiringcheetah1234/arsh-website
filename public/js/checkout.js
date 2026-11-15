import { loadShop, bag, resolve, totals, money, api } from './shop.js';
import { initGrain } from './sections.js';

const $ = (s) => document.querySelector(s);
const form = $('#checkout');
const status = $('#checkout-status');
const place = $('#place');
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const METHODS = {
  cod: ['Cash on delivery', 'Pay the courier when your order arrives.'],
  bank: ['Bank transfer', 'We send our account details with your confirmation. Your order ships once payment is received.'],
};

document.body.append(Object.assign(document.createElement('div'), { className: 'grain' }));
initGrain();

const shop = await loadShop();

function render() {
  const rows = resolve(shop).filter((r) => r.variant.available);
  const empty = rows.length === 0 || !shop.shopOpen;
  $('#checkout-empty').hidden = !empty;
  form.hidden = empty;
  if (empty) return rows;
  $('#summary-lines').replaceChildren(...rows.map((r) => {
    const li = document.createElement('li');
    li.className = 'summary__line';
    li.innerHTML = '<img alt="" width="48" height="120"><div><p></p><p class="ui"></p></div><p class="ui"></p>';
    li.querySelector('img').src = r.product.image;
    li.querySelector('div p').textContent = r.product.name;
    li.querySelector('div p.ui').textContent = `Size ${r.variant.size} × ${r.quantity}`;
    li.querySelector(':scope > p.ui').textContent = money(r.total, shop.currency);
    return li;
  }));
  const t = totals(shop, rows);
  $('#sum-subtotal').textContent = money(t.subtotal, shop.currency);
  $('#sum-shipping').textContent = t.shipping ? money(t.shipping, shop.currency) : 'Complimentary';
  $('#sum-total').textContent = money(t.total, shop.currency);
  return rows;
}

$('#payment-methods').replaceChildren(...shop.paymentMethods.filter((m) => METHODS[m]).map((m, i) => {
  const label = document.createElement('label');
  label.innerHTML = '<input type="radio" name="paymentMethod"><strong></strong><span></span>';
  const input = label.querySelector('input');
  input.value = m;
  input.checked = i === 0;
  label.querySelector('strong').textContent = METHODS[m][0];
  label.querySelector('span').textContent = METHODS[m][1];
  return label;
}));

render();
bag.on(render);
form.addEventListener('input', (e) => { if (e.target.getAttribute('aria-invalid') === 'true') e.target.setAttribute('aria-invalid', 'false'); });

const setStatus = (state, text) => { status.dataset.state = state; status.textContent = text; };

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = new FormData(form);
  const v = (k) => String(f.get(k) || '').trim();
  // Client checks mirror the server's; the server is the authority.
  const checks = [['name', v('name').length >= 2], ['email', EMAIL.test(v('email'))], ['phone', /^[+\d][\d\s-]{6,}$/.test(v('phone'))],
    ['line1', v('line1').length >= 3], ['city', v('city').length >= 2]];
  let first = null;
  for (const [k, ok] of checks) {
    const input = form.elements[k];
    input.setAttribute('aria-invalid', ok ? 'false' : 'true');
    if (!ok && !first) first = input;
  }
  if (first) { setStatus('error', 'Please complete the highlighted fields.'); first.focus(); return; }

  const rows = render();
  if (!rows.length) return;
  place.disabled = true;
  setStatus('pending', 'Placing your order');
  try {
    const res = await api('/api/orders', {
      method: 'POST',
      body: {
        items: rows.map((r) => ({ variantId: r.variantId, quantity: r.quantity })),
        paymentMethod: v('paymentMethod'),
        customer: {
          name: v('name'), email: v('email'), phone: v('phone'), certificateName: v('certificateName') || v('name'), notes: v('notes'),
          address: { line1: v('line1'), line2: v('line2'), city: v('city'), province: v('province'), postal: v('postal') },
        },
      },
    });
    bag.clear();
    location.href = `/order?n=${encodeURIComponent(res.number)}&t=${encodeURIComponent(res.token)}&new=1`;
  } catch (err) {
    setStatus('error', err.message);
    place.disabled = false;
  }
});
