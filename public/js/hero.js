// Hero: scroll-scrubbed frame sequence on <canvas>.
// Footage-agnostic: everything comes from assets/frames/<set>/manifest.json (written by scripts/make-frames.sh).

import { clamp, ramp, loadJSON, loadImage } from './util.js';

export class Hero {
  constructor({ section, scroll, config, reduced, mobile, onProgress }) {
    this.section = section;
    this.stage = section.querySelector('.hero__stage');
    this.canvas = section.querySelector('#hero-canvas');
    this.poster = section.querySelector('#hero-poster');
    this.ctx = this.canvas.getContext('2d', { alpha: false });
    this.scroll = scroll;
    this.cfg = config.hero;
    this.beats = config.hero.beats;
    this.reduced = reduced;
    this.set = mobile ? 'mobile' : 'desktop';
    this.onProgress = onProgress;
    this.frames = [];
    this.target = 0;
    this.current = 0;
    this.drawn = -1;
    this.dirty = true;
    this.el = {
      brand: section.querySelector('.hero__brand'),
      line1: section.querySelector('.hero__line--1'),
      line2: section.querySelector('.hero__line--2'),
      cue: section.querySelector('.hero__cue'),
      white: section.querySelector('.hero__whiteout'),
    };
  }

  url(n) {
    const m = this.manifest;
    // ?v changes whenever the frames are rebuilt, so a footage swap is never served from a stale cache
    return `${this.cfg.framesPath}/${this.set}/${m.pattern.replace('{n}', String(n).padStart(m.pad, '0'))}${m.v ? `?v=${m.v}` : ''}`;
  }

  /** Loads the manifest and the blocking frames. report(0..1) drives the preloader. */
  async load(report = () => {}) {
    this.manifest = await loadJSON(`${this.cfg.framesPath}/${this.set}/manifest.json`, { cache: 'no-cache' });
    const { count } = this.manifest;

    if (this.reduced) {
      const ok = await loadImage(this.url(this.manifest.poster + 1), this.poster);
      report(1);
      return ok;
    }

    this.frames = Array.from({ length: count }, () => ({ img: null, ready: false, requested: false }));
    const blocking = Math.min(this.cfg.blockingFrames ?? 20, count);
    let done = 0;
    await this.fetchFrames([...Array(blocking).keys()], 6, () => report(++done / blocking));
    this.resize();
    return true;
  }

  /** Streams the remaining frames coarse-to-fine so any scroll position soon has a near frame. */
  stream() {
    if (this.reduced || !this.frames.length) return;
    const n = this.frames.length;
    const order = [];
    const seen = new Set();
    for (let step = 16; step >= 1; step = Math.floor(step / 2)) {
      for (let i = 0; i < n; i += step) if (!seen.has(i)) { seen.add(i); order.push(i); }
    }
    this.fetchFrames(order.filter((i) => !this.frames[i].requested), 4);
  }

  fetchFrames(indices, concurrency, onEach = () => {}) {
    let k = 0;
    const worker = async () => {
      while (k < indices.length) {
        const i = indices[k++];
        const f = this.frames[i];
        if (f.requested) { onEach(); continue; }
        f.requested = true;
        const img = new Image();
        const ok = await loadImage(this.url(i + 1), img);
        if (ok) {
          f.img = img; f.ready = true;
          if (Math.abs(i - this.indexFor(this.current)) < Math.abs(this.drawn - this.indexFor(this.current)) || this.drawn < 0) this.dirty = true;
        }
        onEach();
      }
    };
    return Promise.all(Array.from({ length: concurrency }, worker));
  }

  indexFor(p) { return Math.round(p * (this.frames.length - 1)); }

  nearestReady(i) {
    const f = this.frames;
    if (f[i]?.ready) return i;
    for (let d = 1; d < f.length; d++) {
      if (f[i - d]?.ready) return i - d;
      if (f[i + d]?.ready) return i + d;
    }
    return -1;
  }

  measure() {
    this.top = this.section.offsetTop;
    this.dist = Math.max(1, this.section.offsetHeight - this.stage.offsetHeight);
  }

  resize() {
    this.measure();
    const w = this.stage.clientWidth, h = this.stage.clientHeight;
    // Letterbox bars for 2.39:1. On portrait screens keep them as a thin cinematic frame.
    const bar = w / h > 1 ? Math.max(0, (h - w / 2.39) / 2) : h * 0.075;
    this.section.style.setProperty('--bar-h', `${bar.toFixed(1)}px`);
    if (this.reduced || !this.manifest) return;
    const { width: fw, height: fh } = this.manifest;
    const cover = Math.max(w / fw, h / fh);
    const dpr = clamp(Math.min(devicePixelRatio || 1, 1 / cover), 1, 2);
    const cw = Math.round(w * dpr), ch = Math.round(h * dpr);
    if (this.canvas.width !== cw || this.canvas.height !== ch) {
      this.canvas.width = cw; this.canvas.height = ch;
      this.drawn = -1;
      this.dirty = true;
    }
  }

  /** Called every frame. */
  tick(dt) {
    if (this.reduced) return;
    this.target = clamp((this.scroll.y - this.top) / this.dist);
    const k = 1 - Math.pow(1 - (this.cfg.lerp ?? 0.1), dt * 60);
    const diff = this.target - this.current;
    if (Math.abs(diff) > 0.00005) { this.current += diff * k; this.dirty = true; }
    else if (this.current !== this.target) { this.current = this.target; this.dirty = true; }
    if (!this.dirty) return;
    this.dirty = false;
    this.draw();
    this.overlay(this.current);
    this.onProgress?.(this.current);
  }

  draw() {
    if (!this.frames.length) return;
    // Skip work once the hero is fully scrolled past.
    if (this.scroll.y > this.top + this.dist + this.stage.offsetHeight) return;
    const want = this.indexFor(this.current);
    const i = this.nearestReady(want);
    this.canvas.dataset.want = String(want);
    if (i < 0 || i === this.drawn) return;
    const img = this.frames[i].img;
    const cw = this.canvas.width, ch = this.canvas.height;
    const s = Math.max(cw / img.naturalWidth, ch / img.naturalHeight);
    const dw = img.naturalWidth * s, dh = img.naturalHeight * s;
    this.ctx.drawImage(img, (cw - dw) / 2, (ch - dh) / 2, dw, dh);
    this.drawn = i;
    this.canvas.dataset.frame = String(i);
  }

  overlay(p) {
    const b = this.beats;
    const { brand, line1, line2, cue, white } = this.el;
    // The wordmark is used large and left alone: it holds on the first screen, then signs off.
    const brandOut = ramp(p, 0.02, b.intro[1]);
    brand.style.opacity = String(1 - brandOut);
    brand.style.transform = `translateY(${(brandOut * -1.5).toFixed(3)}rem)`;
    cue.style.opacity = String(1 - ramp(p, 0, 0.04));

    const line = (el, [a, z]) => {
      const o = ramp(p, a, a + 0.05) * (1 - ramp(p, z - 0.06, z));
      el.style.opacity = String(o);
      el.style.transform = `translate(-50%, calc(50% + ${((1 - o) * 0.5).toFixed(3)}rem))`;
    };
    line(line1, b.line1);
    line(line2, b.line2 ?? [0.6, 0.84]);

    this.section.style.setProperty('--bar-out', ramp(p, b.letterbox[0], b.letterbox[1]).toFixed(4));
    white.style.opacity = ramp(p, b.whiteout[0], b.whiteout[1]).toFixed(4);
  }

  /** Static presentation for reduced motion. */
  staticOverlay() {
    this.el.line1.style.opacity = '1';
    this.el.line1.style.transform = 'translate(-50%, 0)';
    this.el.line2.style.display = 'none';
    this.el.cue.style.opacity = '0';
    this.section.style.setProperty('--bar-out', '1');
  }
}
