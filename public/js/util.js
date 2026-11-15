export const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
export const lerp = (a, b, t) => a + (b - a) * t;
/** 0..1 across [a, b], smoothstepped. */
export const ramp = (p, a, b) => {
  const t = clamp((p - a) / (b - a));
  return t * t * (3 - 2 * t);
};
export const get = (obj, path) => path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export async function loadJSON(url, opts = {}) {
  const res = await fetch(url, { credentials: 'same-origin', ...opts });
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return res.json();
}

/** Resolves true/false; never rejects. */
export function loadImage(src, img = new Image()) {
  return new Promise((resolve) => {
    img.decoding = 'async';
    img.onload = () => resolve(true);
    img.onerror = () => resolve(false);
    img.src = src;
  });
}

export const mq = {
  mobile: () => matchMedia('(max-width: 767px)').matches,
  reduced: () => matchMedia('(prefers-reduced-motion: reduce)').matches,
};
