// Catalogue: horizontal lineup on a shared baseline.
// Scroll position s (0..N): 0 = overview row, k = piece k (1-based) active.
// Every figure is placed with one transform per frame; no layout reads in the loop.

import { clamp, lerp, ramp, mq } from './util.js';

const HOLD = 0.3; // extra scroll (in piece units) held at the overview and after the last piece

export class Catalogue {
  constructor({ section, scroll, data, copy, reduced, onOpen }) {
    this.section = section;
    this.stage = section.querySelector('#catalogue-stage');
    this.row = section.querySelector('#catalogue-row');
    this.ui = {
      index: section.querySelector('#catalogue-index'),
      name: section.querySelector('#catalogue-name'),
      meta: section.querySelector('#catalogue-meta'),
      progress: section.querySelector('#catalogue-progress'),
      hint: section.querySelector('.catalogue__hint'),
    };
    this.scroll = scroll;
    this.data = data;
    this.copy = copy;
    this.items = data.items;
    this.N = this.items.length;
    this.reduced = reduced;
    this.onOpen = onOpen;
    this.s = 0;
    this.shown = null;
    this.idleTimer = 0;
    this.drag = null;
    this.suppressClick = false;
    this.aspect = 0.4;
    this.build();
    this.bind();
  }

  build() {
    const frag = document.createDocumentFragment();
    this.looks = this.items.map((item, i) => {
      const li = document.createElement('li');
      li.className = 'look';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'look__btn';
      btn.setAttribute('aria-label', `${item.name}, ${this.metaText(item)}. ${String(i + 1).padStart(2, '0')} of ${this.N}. Open details`);
      const img = document.createElement('img');
      img.src = item.image;
      img.alt = '';
      img.width = 600; img.height = 1500;
      img.decoding = 'async';
      img.draggable = false;
      btn.append(img);
      li.append(btn);
      frag.append(li);
      btn.addEventListener('click', () => this.onClick(i));
      btn.addEventListener('focus', () => { if (btn.matches(':focus-visible') && this.activeIndex() !== i) this.goTo(i); });
      if (i === 0) img.addEventListener('load', () => {
        if (img.naturalWidth) { this.aspect = img.naturalWidth / img.naturalHeight; this.resize(); }
      }, { once: true });
      return { li, btn, img, last: '' };
    });
    this.row.append(frag);
  }

  metaText(item) {
    const parts = [item.meta?.fit, item.meta?.wash].filter(Boolean);
    if (this.data.showPrices && item.price != null) parts.push(this.price(item.price));
    return parts.join(' — ');
  }

  price(v) {
    return `${this.data.currency ?? ''} ${Number(v).toLocaleString('en-PK')}`.trim();
  }

  bind() {
    this.scroll.onScroll(() => this.scheduleSnap());
    addEventListener('keydown', (e) => {
      if (document.querySelector('dialog[open]')) return;
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      if (!this.isPinned()) return;
      if (e.target.closest?.('input, textarea')) return;
      e.preventDefault();
      const cur = Math.round(this.s);
      const next = clamp(cur + (e.key === 'ArrowRight' ? 1 : -1), 0, this.N);
      this.goToS(next);
      if (next > 0) this.looks[next - 1].btn.focus({ preventScroll: true });
    });

    const st = this.stage;
    st.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      this.drag = { x: e.clientX, y: e.clientY, y0: this.scroll.y, s0: Math.round(this.s), active: false, id: e.pointerId };
    });
    st.addEventListener('pointermove', (e) => {
      const d = this.drag;
      if (!d || d.id !== e.pointerId) return;
      const dx = e.clientX - d.x, dy = e.clientY - d.y;
      if (!d.active) {
        if (Math.abs(dx) < 8 || Math.abs(dx) < Math.abs(dy)) return;
        d.active = true;
        st.classList.add('is-dragging');
        try { st.setPointerCapture(e.pointerId); } catch { /* pointer already released */ }
      }
      const perPiece = this.unit / Math.max(1, this.S1);
      this.scroll.to(clamp(d.y0 - dx * perPiece, this.yForS(0), this.yForS(this.N)), { immediate: true });
    });
    const end = (e) => {
      const d = this.drag;
      if (!d || d.id !== e.pointerId) return;
      this.drag = null;
      st.classList.remove('is-dragging');
      if (!d.active) return;
      this.suppressClick = true;
      setTimeout(() => { this.suppressClick = false; }, 50);
      const dx = e.clientX - d.x;
      const moved = Math.abs(this.s - d.s0);
      const dir = dx < 0 ? 1 : -1;
      const target = Math.abs(dx) > 30 ? d.s0 + dir * Math.max(1, Math.round(moved)) : d.s0;
      this.goToS(clamp(target, 0, this.N));
    };
    st.addEventListener('pointerup', end);
    st.addEventListener('pointercancel', (e) => { if (this.drag?.id === e.pointerId) { this.drag = null; st.classList.remove('is-dragging'); } });
  }

  // ---------------------------------------------------------------- geometry
  resize() {
    const vw = this.stage.clientWidth;
    const vh = this.stage.clientHeight;
    const mobile = mq.mobile();
    const a = this.aspect;
    this.vw = vw; this.vh = vh; this.mobile = mobile;

    this.unit = Math.round(vh * (mobile ? 0.62 : 0.72));
    const total = vh + (this.N + 2 * HOLD) * this.unit;
    this.section.style.setProperty('--cat-h', `${Math.round(total)}px`);

    // Active piece: near full height. Neighbours: smaller, ghosted.
    this.hA = Math.min(vh * (mobile ? 0.6 : 0.78), (vw * 0.9) / a);
    this.hN = this.hA * (mobile ? 0.58 : 0.6);
    const wA = this.hA * a, wN = this.hN * a;
    const gap = vw * (mobile ? 0.05 : 0.035);
    this.S1 = wA / 2 + wN / 2 + gap * 1.5;
    this.S2 = wN + gap;
    this.baseFocus = vh * (mobile ? 0.11 : 0.075);

    // Overview: one row of small figures, centred.
    const avail = vw - (mobile ? 32 : vw * 0.16);
    this.hO = Math.min(vh * (mobile ? 0.2 : 0.3), avail / (this.N * a * 1.3 - a * 0.3));
    this.pitchO = this.hO * a * 1.3;
    this.baseOver = vh * (mobile ? 0.6 : 0.64);

    this.blurMax = mobile ? 2 : 3.5;
    this.row.style.setProperty('--look-w', `${(wA).toFixed(1)}px`);
    this.row.style.setProperty('--look-h', `${this.hA.toFixed(1)}px`);
    this.measure();
    this.render(true);
  }

  measure() {
    this.top = this.section.offsetTop;
  }

  yForS(s) { return this.top + (s + HOLD) * this.unit; }
  sForY(y) { return (y - this.top) / this.unit - HOLD; }
  isPinned() {
    const raw = this.sForY(this.scroll.y);
    return raw > -HOLD - 0.01 && raw < this.N + HOLD + 0.01;
  }
  activeIndex() { return this.s < 0.5 ? -1 : clamp(Math.round(this.s) - 1, 0, this.N - 1); }

  xFocus(d) {
    const ad = Math.abs(d);
    const x = ad <= 1 ? ad * this.S1 : this.S1 + (ad - 1) * this.S2;
    return Math.sign(d) * x;
  }

  // ---------------------------------------------------------------- per frame
  tick() {
    const raw = this.sForY(this.scroll.y);
    // Only work while the stage is (nearly) on screen.
    if (raw < -HOLD - 1.6 || raw > this.N + HOLD + 1.6) return;
    const s = clamp(raw, 0, this.N);
    if (Math.abs(s - this.s) < 0.0005 && !this.force) return;
    this.s = s;
    this.render();
  }

  render(force = false) {
    if (!this.vw) return;
    const { s, N, hA, vw } = this;
    const t = ramp(s, 0, 1); // overview -> focus
    const f = Math.max(0, s - 1); // active float index in focus mode
    const yOver = -(this.vh - this.baseOver) + this.baseFocus;

    for (let i = 0; i < N; i++) {
      const L = this.looks[i];
      const d = i - f;
      const act = Math.max(0, 1 - Math.abs(d));
      // Focus layout
      const kF = (this.hN + (hA - this.hN) * act) / hA;
      const xF = this.xFocus(d);
      const oF = 0.24 + 0.76 * act;
      const bF = (1 - act) * this.blurMax;
      const gF = (1 - act) * 0.65;
      // Overview layout
      const kO = this.hO / hA;
      const xO = (i - (N - 1) / 2) * this.pitchO;
      // Blend
      const k = lerp(kO, kF, t);
      const x = lerp(xO, xF, t);
      const y = lerp(yOver, 0, t) - this.baseFocus;
      const o = lerp(1, oF, t);
      const b = lerp(0, bF, t);
      const g = lerp(0.1, gF, t);
      const halfW = (hA * this.aspect * k) / 2;
      const visible = Math.abs(x) - halfW < vw / 2 + 40;

      const key = visible ? `${x.toFixed(1)}|${y.toFixed(1)}|${k.toFixed(4)}|${o.toFixed(3)}|${b.toFixed(2)}` : 'hidden';
      if (key === L.last && !force) continue;
      L.last = key;
      if (!visible) { L.li.style.visibility = 'hidden'; continue; }
      L.li.style.visibility = '';
      L.li.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) scale(${k.toFixed(4)})`;
      L.li.style.opacity = o.toFixed(3);
      L.li.style.filter = b > 0.05 || g > 0.02 ? `blur(${b.toFixed(2)}px) grayscale(${g.toFixed(3)})` : 'none';
      L.li.style.zIndex = String(100 - Math.round(Math.abs(d) * 10));
    }

    const active = this.activeIndex();
    this.looks.forEach((L, i) => L.li.classList.toggle('is-active', i === active && s >= 0.5));
    this.ui.progress.style.transform = `scaleX(${(s / N).toFixed(4)})`;
    this.ui.hint.style.opacity = String(1 - ramp(s, 0.6, 1.2));
    this.section.dataset.active = String(active);
    this.section.dataset.s = s.toFixed(3);
    if (active !== this.shown) this.label(active);
  }

  label(i) {
    this.shown = i;
    const { index, name, meta } = this.ui;
    if (i < 0) {
      index.textContent = '';
      name.textContent = this.copy.catalogue.label;
      meta.textContent = this.data.collection ?? '';
      return;
    }
    const item = this.items[i];
    index.textContent = `No. ${String(i + 1).padStart(2, '0')} / ${String(this.N).padStart(2, '0')}`;
    name.textContent = item.name;
    meta.textContent = this.metaText(item);
  }

  // ---------------------------------------------------------------- navigation
  goTo(i) { this.goToS(i + 1); }
  goToS(s) {
    this.scroll.to(this.yForS(s), { duration: 0.9, immediate: this.reduced });
  }

  onClick(i) {
    if (this.suppressClick) return;
    if (this.activeIndex() === i && Math.abs(this.s - (i + 1)) < 0.35) this.onOpen?.(i, this.looks[i].btn);
    else this.goTo(i);
  }

  scheduleSnap() {
    clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => this.snap(), 170);
  }

  snap() {
    if (this.drag || document.querySelector('dialog[open]')) return;
    const raw = this.sForY(this.scroll.y);
    if (raw < 0.35 || raw > this.N) return;
    const target = Math.round(raw);
    if (Math.abs(raw - target) < 0.01) return;
    this.goToS(target);
  }
}
