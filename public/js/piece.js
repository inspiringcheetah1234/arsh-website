// The page a QR code opens: /p/<CODE>. A one-way boarding pass, after the hang tag in the brand guidelines:
// it shows who the piece belongs to, the article, its number in the edition and the date.
import { api } from './shop.js';
import { initGrain } from './sections.js';

const cert = document.getElementById('cert');
const code = location.pathname.split('/').filter(Boolean).pop() || '';
document.body.append(Object.assign(document.createElement('div'), { className: 'grain' }));
initGrain();

const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
const logo = (cls, label) => { const w = el('span', `wordmark ${cls || ''}`.trim()); w.setAttribute('role', 'img'); w.setAttribute('aria-label', label); return w; };
const mark = () => { const m = el('span', 'mark'); m.setAttribute('aria-hidden', 'true'); return m; };
const pad = (n) => String(n).padStart(3, '0');
const longDate = (d) => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

function empty(title, text) {
  cert.className = 'cert--empty';
  cert.replaceChildren(logo('', 'Arsh by HZK'), el('h1', 'display', title), el('p', 'text', text));
  document.title = `${title} — ARSH BY HZK`;
}

try {
  const p = await api(`/api/pieces/${encodeURIComponent(code)}`);
  if (p.status === 'registered') {
    cert.className = 'ticket';

    const stub = el('div', 'ticket__stub');
    stub.append(el('span', 'ticket__vert ui', 'One way'), el('span', 'ticket__vert ui', 'Until the sun goes out'));

    const main = el('div', 'ticket__main');
    const top = el('div', 'ticket__top');
    top.append(logo('', 'Arsh by HZK'), mark());
    const number = el('h1', 'ticket__number display', `No. ${pad(p.edition.number)}`);
    number.append(el('small', null, `/ ${p.edition.size}`));
    const fields = el('dl', 'ticket__fields ui');
    const row = (k, v) => { if (!v) return; const d = el('div'); d.append(el('dt', null, k), el('dd', null, v)); fields.append(d); };
    row('Passenger', p.owner);
    row('Article', p.article);
    row('Fit', p.meta.fit);
    row('Wash', p.meta.wash);
    row('Issued', longDate(p.purchasedAt));
    row('From', 'Lahore');
    row('To', 'The stars');
    row('Class', 'Zero-G');
    main.append(top, el('p', 'ticket__label ui', 'Registered piece'), number, el('p', 'ticket__name heading', p.name), fields, el('p', 'ticket__code ui', `Verified — ${p.code}`));

    const fig = el('figure', 'ticket__fig');
    const img = el('img'); img.src = p.image; img.alt = `${p.name}, full-length view`; img.width = 600; img.height = 1500;
    fig.append(img);

    cert.replaceChildren(stub, main, fig);
    document.title = `${p.name} No. ${pad(p.edition.number)} — ARSH BY HZK`;
  } else if (p.status === 'void') {
    empty('No longer in use.', 'This code has been retired. If it is sewn into your piece, please contact us.');
  } else {
    empty('Not yet registered.', 'This piece has no owner yet. It will have when it is sold.');
  }
} catch (err) {
  empty('Not recognised.', err.status === 404
    ? 'We could not find this code. Genuine Arsh pieces carry a code that opens on this site.'
    : 'We could not reach our registry. Please try again in a moment.');
}
