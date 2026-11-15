// Optional low rumble, synthesised (no audio files, no music). Off by default.
// Brown noise -> low-pass; level follows hero progress and swells toward the impact.

import { ramp } from './util.js';

export class Sound {
  constructor({ button, copy }) {
    this.button = button;
    this.label = button.querySelector('.header__sound-label');
    this.copy = copy;
    this.on = false;
    this.level = 0;
    button.addEventListener('click', () => this.toggle());
  }

  setup() {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return false;
    const ctx = new Ctx();
    const len = ctx.sampleRate * 4;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      d[i] = last * 3.5;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf; src.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 110; lp.Q.value = 0.7;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    src.connect(lp).connect(gain).connect(ctx.destination);
    src.start();
    Object.assign(this, { ctx, lp, gain });
    return true;
  }

  async toggle() {
    if (!this.ctx && !this.setup()) return;
    this.on = !this.on;
    this.button.setAttribute('aria-pressed', String(this.on));
    this.label.textContent = this.on ? this.copy.nav.soundOn : this.copy.nav.soundOff;
    try {
      if (this.on) await this.ctx.resume();
    } catch { /* autoplay policy: stays silent */ }
    this.apply();
  }

  /** p: hero progress 0..1; past the hero the rumble fades out. */
  update(p) {
    this.level = (0.25 + 0.75 * ramp(p, 0.5, 0.9)) * (1 - ramp(p, 0.94, 1));
    this.apply();
  }

  apply() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.gain.gain.setTargetAtTime(this.on ? this.level * 0.5 : 0, t, 0.25);
    this.lp.frequency.setTargetAtTime(90 + this.level * 160, t, 0.3);
  }
}
