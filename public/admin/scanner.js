// QR scanner dialog. Camera: native BarcodeDetector where available (Chrome/Android), jsQR otherwise (iOS Safari).
// A USB/Bluetooth hand scanner also works: it types the URL into the manual field and presses Enter.
//
// openScanner({ title, onCode }) — onCode(text) resolves to { ok, message, keepOpen, pick? } and is
// called once per distinct code. pick: [{ label, value }] shows choice buttons; the chosen value is
// passed back as onCode(text, value).

export function openScanner({ title = 'Scan', onCode }) {
  const dlg = document.createElement('dialog');
  dlg.className = 'scanner';
  dlg.innerHTML = `
    <div class="scanner__head"><p></p><button type="button">Done</button></div>
    <div class="scanner__cam"><video playsinline muted></video><div class="scanner__frame"></div></div>
    <p class="scanner__msg" role="status" aria-live="assertive">Starting camera…</p>
    <div class="scanner__pick" hidden></div>
    <form class="scanner__manual"><label class="sr-only" for="scan-manual">Code or link</label>
      <input id="scan-manual" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="Type or scan a code">
      <button class="btn btn--sm" type="submit">Enter</button></form>`;
  document.body.append(dlg);
  const $ = (s) => dlg.querySelector(s);
  $('.scanner__head p').textContent = title;
  const video = $('video');
  const msg = $('.scanner__msg');
  const pick = $('.scanner__pick');
  const manual = $('#scan-manual');
  let stream = null, raf = 0, stopped = false, busy = false, last = { text: '', at: 0 };
  let detector = null;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  const say = (text, cls = '') => { msg.textContent = text; msg.className = `scanner__msg ${cls}`; };
  const flash = (ok) => {
    dlg.classList.remove('is-hit', 'is-miss');
    void dlg.offsetWidth;
    dlg.classList.add(ok ? 'is-hit' : 'is-miss');
    setTimeout(() => dlg.classList.remove('is-hit', 'is-miss'), 900);
    try { navigator.vibrate?.(ok ? 60 : [40, 60, 40]); } catch { /* not supported */ }
  };

  async function handle(text, choice) {
    if (busy) return;
    busy = true;
    pick.hidden = true;
    say('Checking…');
    try {
      const r = await onCode(text, choice);
      flash(r.ok);
      say(r.message, r.ok ? 'ok' : 'err');
      if (r.pick?.length) {
        pick.replaceChildren(...r.pick.map((p) => {
          const b = document.createElement('button');
          b.type = 'button';
          b.textContent = p.label;
          b.addEventListener('click', () => { busy = false; handle(text, p.value); });
          return b;
        }));
        pick.hidden = false;
      }
      if (r.ok && !r.keepOpen) setTimeout(close, 900);
    } catch (err) {
      flash(false);
      say(err.message || 'Something went wrong', 'err');
    } finally {
      busy = false;
    }
  }

  async function tick() {
    if (stopped) return;
    if (video.readyState >= 2 && !busy) {
      let text = null;
      try {
        if (detector) {
          const found = await detector.detect(video);
          text = found[0]?.rawValue || null;
        } else if (window.jsQR) {
          const w = Math.min(640, video.videoWidth), h = Math.round(w * video.videoHeight / video.videoWidth);
          if (w && h) {
            canvas.width = w; canvas.height = h;
            ctx.drawImage(video, 0, 0, w, h);
            const img = ctx.getImageData(0, 0, w, h);
            text = window.jsQR(img.data, w, h, { inversionAttempts: 'dontInvert' })?.data || null;
          }
        }
      } catch { /* a frame failed to decode; keep going */ }
      const now = Date.now();
      if (text && !(text === last.text && now - last.at < 2500)) {
        last = { text, at: now };
        handle(text);
      }
    }
    raf = setTimeout(tick, 120);
  }

  async function start() {
    try {
      if ('BarcodeDetector' in window) {
        const formats = await window.BarcodeDetector.getSupportedFormats?.() ?? [];
        if (formats.includes('qr_code')) detector = new window.BarcodeDetector({ formats: ['qr_code'] });
      }
    } catch { detector = null; }
    if (!navigator.mediaDevices?.getUserMedia) { say('Camera not available here. Type or use a hand scanner.'); manual.focus(); return; }
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 1280 } }, audio: false });
      if (stopped) { stream.getTracks().forEach((t) => t.stop()); return; }
      video.srcObject = stream;
      await video.play().catch(() => {});
      say('Point the camera at the code.');
      tick();
    } catch {
      say('Camera blocked or unavailable. Allow camera access, or type the code.', 'err');
      $('.scanner__cam').hidden = true;
      manual.focus();
    }
  }

  function close() {
    stopped = true;
    clearTimeout(raf);
    stream?.getTracks().forEach((t) => t.stop());
    if (dlg.open) dlg.close();
    dlg.remove();
  }

  $('.scanner__head button').addEventListener('click', close);
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); close(); });
  $('.scanner__manual').addEventListener('submit', (e) => {
    e.preventDefault();
    const v = manual.value.trim();
    if (v) { last = { text: v, at: Date.now() }; handle(v); manual.value = ''; }
  });

  dlg.showModal();
  start();
  return { close };
}
