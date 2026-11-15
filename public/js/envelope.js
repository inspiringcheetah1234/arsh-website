// The waitlist envelope. Sealed: the form is inert and invisible. Breaking the seal plays a short sequence
// (seal cracks → flap opens → letter rises → envelope falls away), then the real form is live.
// Reduced motion never reaches this file: the page shows the form directly.

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export function initEnvelope({ stage, envelope, seal, form, auto = false }) {
  envelope.hidden = false;
  stage.classList.add('is-sealed');
  form.inert = true;
  form.setAttribute('aria-hidden', 'true');

  let started = false;
  async function open() {
    if (started) return;
    started = true;
    seal.disabled = true;
    const step = (c) => envelope.classList.add(c);

    step('s1');            // the wax breaks
    await wait(450);
    step('s2');            // the flap swings up
    await wait(430);
    step('s2b');           // ...and lies behind the letter
    await wait(480);
    step('s3');            // the letter rises out of the pocket
    await wait(1000);
    step('s4');            // the envelope falls away, the real letter appears
    stage.classList.remove('is-sealed');
    form.inert = false;
    form.removeAttribute('aria-hidden');
    await wait(800);
    envelope.hidden = true;
    stage.dataset.state = 'open';
    form.focus({ preventScroll: true });
    form.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  seal.addEventListener('click', open);
  stage.dataset.state = 'sealed';
  // Arriving with a piece or an email already chosen: no need to ask twice, let it open itself.
  if (auto) setTimeout(open, 900);
  return { open };
}
