// Request Access: one email field -> configurable endpoint (data/config.json -> access.endpoint).
// Empty endpoint = stub mode: simulated success, nothing leaves the browser.

import { wait } from './util.js';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function initAccess({ copy, config }) {
  const form = document.getElementById('access-form');
  const input = document.getElementById('access-email');
  const status = document.getElementById('access-status');
  const button = form.querySelector('.access__submit');
  const more = document.getElementById('access-more');
  const t = copy.access;
  const cfg = config.access || {};

  const set = (state, text) => {
    status.dataset.state = state;
    status.textContent = text;
    input.setAttribute('aria-invalid', state === 'error' && !EMAIL.test(input.value.trim()) ? 'true' : 'false');
  };

  input.addEventListener('input', () => { if (status.dataset.state === 'error') set('', ''); });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = input.value.trim();
    if (!EMAIL.test(email)) { set('error', t.invalid); input.focus(); return; }
    if (form.company.value) { set('success', t.success); form.reset(); return; } // honeypot

    button.disabled = true;
    set('pending', t.sending);
    try {
      let data = {};
      if (!cfg.endpoint) {
        await wait(cfg.stubDelayMs ?? 700);
      } else {
        const res = await fetch(cfg.endpoint, {
          method: cfg.method || 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ email, interest: form.interest.value || null, source: 'arsh-website' }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw Object.assign(new Error(String(res.status)), { detail: res.status < 500 ? body.error : '' });
        }
        data = await res.json().catch(() => ({}));
      }
      set('success', data.status === 'already' ? t.already : data.number ? `${t.success} No. ${String(data.number).padStart(4, '0')}.` : t.success);
      if (more) { more.href = `/waitlist?email=${encodeURIComponent(email)}`; more.hidden = false; }
      form.reset();
    } catch (err) {
      set('error', err.detail || t.error);
    } finally {
      button.disabled = false;
    }
  });

  return {
    prefill(slug) {
      form.interest.value = slug || '';
    },
    focus() { input.focus({ preventScroll: true }); },
  };
}
