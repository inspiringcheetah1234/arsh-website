// /waitlist — the full waitlist form. Posts to /api/waitlist; the confirmation is a boarding pass.
import { api, loadShop } from './shop.js';
import { initGrain } from './sections.js';
import { initEnvelope } from './envelope.js';

const $ = (s) => document.querySelector(s);
const form = $('#wl-form');
const status = $('#wl-status');
const submit = $('#wl-submit');
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE = /^[+\d][\d\s-]{6,}$/;
const params = new URLSearchParams(location.search);

document.body.append(Object.assign(document.createElement('div'), { className: 'grain' }));
initGrain();

const copy = (await (await fetch('/data/copy.json')).json());
const t = copy.waitlist;
document.title = t.pageTitle;
for (const el of document.querySelectorAll('[data-copy]')) {
  const v = el.dataset.copy.split('.').reduce((o, k) => o?.[k], copy);
  if (typeof v === 'string') el.textContent = v;
}

for (const el of document.querySelectorAll('[data-copy-attr]')) {
  const [attr, path] = el.dataset.copyAttr.split(':');
  const v = path.split('.').reduce((o, k) => o?.[k], copy);
  if (typeof v === 'string') el.setAttribute(attr, v);
}

const option = (value, text) => Object.assign(document.createElement('option'), { value, textContent: text });
const shop = await loadShop();
const products = shop.products.filter((p) => p.id);

const interest = $('#wl-interest');
interest.replaceChildren(option('', t.interestAny), ...products.map((p) => option(String(p.id), `${p.name}${p.article ? ` (${p.article})` : ''}`)));
const sizes = [...new Set(products.flatMap((p) => p.variants.map((v) => v.size)))];
$('#wl-size').replaceChildren(option('', t.sizeAny), ...(sizes.length ? sizes : ['28', '30', '32', '34', '36']).map((s) => option(s, s)));
$('#wl-heard').replaceChildren(option('', '—'), ...t.heardOptions.map((h) => option(h, h)));

// Prefill from the landing page (?email=) or a piece (?interest=<slug>)
if (params.get('email')) form.email.value = params.get('email').slice(0, 200);
const wanted = products.find((p) => p.slug === params.get('interest'));
if (wanted) interest.value = String(wanted.id);

// The envelope: sealed until someone breaks the seal (reduced motion skips it and shows the letter).
if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
  initEnvelope({ stage: $('#wl-stage'), envelope: $('#envelope'), seal: $('#seal'), form, auto: Boolean(params.get('email') || wanted) });
}

const setStatus = (state, text) => { status.dataset.state = state; status.textContent = text; };
const pad = (n) => String(n).padStart(4, '0');
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };

form.addEventListener('input', (e) => { if (e.target.getAttribute('aria-invalid') === 'true') e.target.setAttribute('aria-invalid', 'false'); });

function ticket(res, values) {
  const done = $('#wl-done');
  const stub = el('div', 'ticket__stub');
  stub.append(el('span', 'ticket__vert ui', 'Standby'), el('span', 'ticket__vert ui', 'Until the sun goes out'));

  const main = el('div', 'ticket__main');
  const top = el('div', 'ticket__top');
  const word = el('span', 'wordmark'); word.setAttribute('role', 'img'); word.setAttribute('aria-label', 'Arsh by HZK');
  const mark = el('span', 'mark'); mark.setAttribute('aria-hidden', 'true');
  top.append(word, mark);
  const number = el('h2', 'ticket__number display', `No. ${pad(res.number)}`);
  number.setAttribute('tabindex', '-1');
  const fields = el('dl', 'ticket__fields ui');
  const row = (k, v) => { if (!v) return; const d = el('div'); d.append(el('dt', null, k), el('dd', null, v)); fields.append(d); };
  const piece = products.find((p) => String(p.id) === values.productId);
  row('Passenger', values.name);
  row('Interested in', piece ? `${piece.article ? piece.article + ' — ' : ''}${piece.name}` : t.interestAny);
  row('Size', values.size);
  row('Issued', new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }));
  row('From', 'Lahore');
  row('To', 'The stars');
  row('Status', 'Standby');
  main.append(top, el('p', 'ticket__label ui', t.ticketLabel), number, fields);

  const ticketEl = el('article', 'ticket');
  ticketEl.append(stub, main);
  const note = el('p', 'waitlist__note', t.ticketNote.replace('{email}', values.email));
  const back = el('p', 'waitlist__back ui');
  const a = el('a', null, t.back); a.href = '/';
  back.append(a);
  done.replaceChildren(ticketEl, note, back);
  done.hidden = false;
  form.hidden = true;
  $('#wl-panel').classList.add('is-done');
  document.title = `No. ${pad(res.number)} — ARSH BY HZK`;
  number.focus({ preventScroll: true });
  done.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = new FormData(form);
  const v = (k) => String(f.get(k) || '').trim();
  const checks = [
    ['name', v('name').length >= 2, t.required],
    ['email', EMAIL.test(v('email')), v('email') ? t.invalidEmail : t.required],
    ['phone', !v('phone') || PHONE.test(v('phone')), t.invalidPhone],
    ['consent', form.consent.checked, t.consentMissing],
  ];
  let first = null;
  for (const [k, ok, msg] of checks) {
    form.elements[k].setAttribute('aria-invalid', ok ? 'false' : 'true');
    if (!ok && !first) first = [form.elements[k], msg];
  }
  if (first) { setStatus('error', checks.filter(([, ok]) => !ok).length > 1 ? t.required : first[1]); first[0].focus(); return; }

  const values = { name: v('name'), email: v('email'), phone: v('phone'), city: v('city'), productId: v('productId'), size: v('size'), heardFrom: v('heardFrom') };
  submit.disabled = true;
  setStatus('pending', t.sending);
  try {
    const res = await api('/api/waitlist', {
      method: 'POST',
      body: { ...values, productId: values.productId ? Number(values.productId) : null, consent: true, company: v('company'), source: 'waitlist' },
    });
    if (res.status === 'already' || !res.number) { setStatus('success', res.status === 'already' ? t.already : t.ticketNote.replace('{email}', values.email)); submit.disabled = false; return; }
    ticket(res, values);
  } catch (err) {
    setStatus('error', err.status && err.status < 500 ? err.message : t.error);
    submit.disabled = false;
  }
});
