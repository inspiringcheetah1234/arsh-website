// One scroll + one ticker for the whole site.
// Lenis (smooth wheel) + GSAP ticker when motion is allowed; native scroll otherwise.

export function createScroll({ reduced }) {
  const gsap = window.gsap;
  const ScrollTrigger = window.ScrollTrigger;
  if (gsap && ScrollTrigger) gsap.registerPlugin(ScrollTrigger);

  const listeners = new Set();
  const tickers = new Set();
  let lenis = null;

  if (!reduced && window.Lenis) {
    lenis = new window.Lenis({ lerp: 0.1, smoothWheel: true, anchors: true, autoRaf: false });
    lenis.on('scroll', () => {
      ScrollTrigger?.update();
      listeners.forEach((fn) => fn(lenis.scroll));
    });
  } else {
    addEventListener('scroll', () => listeners.forEach((fn) => fn(scrollY)), { passive: true });
  }

  let last = performance.now();
  const frame = (now) => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    lenis?.raf(now);
    tickers.forEach((fn) => fn(dt, now));
  };
  if (gsap) {
    gsap.ticker.lagSmoothing(0);
    gsap.ticker.add(() => frame(performance.now()));
  } else {
    const loop = (t) => { frame(t); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  }

  return {
    lenis,
    get y() { return lenis ? lenis.scroll : scrollY; },
    onScroll(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    onTick(fn) { tickers.add(fn); return () => tickers.delete(fn); },
    to(y, { immediate = false, duration = 0.9 } = {}) {
      if (lenis) lenis.scrollTo(y, { immediate, duration, force: true, easing: (t) => 1 - Math.pow(1 - t, 3) });
      else scrollTo({ top: y, behavior: immediate || reduced ? 'auto' : 'smooth' });
    },
    stop() { lenis?.stop(); },
    start() { lenis?.start(); },
    refresh() { lenis?.resize(); ScrollTrigger?.refresh(); },
  };
}
