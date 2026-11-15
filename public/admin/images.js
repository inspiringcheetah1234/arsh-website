// Product image manager: lineup cutout + gallery. Files are resized in the browser (keeps uploads under
// Vercel's 4.5 MB limit and handles phone photos), then re-encoded and normalised on the server.

const MAX_BYTES = 3.8 * 1024 * 1024;

/** Downscale to `maxSide`, keep transparency, return a Blob small enough to upload. */
async function prepare(file, maxSide = 2400) {
  if (!/^image\//.test(file.type) && !/\.(jpe?g|png|webp|heic|heif|avif)$/i.test(file.name)) throw new Error(`${file.name} is not an image`);
  let bmp;
  try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch {
    throw new Error(`${file.name} could not be read here${/hei[cf]/i.test(file.name) ? ' — export it as JPG or PNG first' : ''}`);
  }
  let scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  for (let i = 0; i < 5; i++) {
    const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    canvas.getContext('2d').drawImage(bmp, 0, 0, w, h);
    // WebP keeps alpha and is small; browsers that can't encode it fall back to PNG.
    const blob = await new Promise((r) => canvas.toBlob(r, 'image/webp', 0.92));
    if (blob && blob.size <= MAX_BYTES) { bmp.close?.(); return blob; }
    scale *= 0.8;
  }
  bmp.close?.();
  throw new Error(`${file.name} is too large even after resizing`);
}

export function imageManager({ product, h, api, toast, fail, onCutout }) {
  let images = product.images || [];
  const status = h('p', { class: 'muted img-status', role: 'status', 'aria-live': 'polite' });

  const upload = async (blob, kind, normalise = true) => {
    const res = await fetch(`/api/admin/products/${product.id}/images?kind=${kind}&normalise=${normalise ? 1 : 0}`, {
      method: 'POST', credentials: 'same-origin', body: blob,
      headers: { 'Content-Type': blob.type || 'application/octet-stream', 'X-Arsh-Admin': '1' },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Upload failed (${res.status})`);
    return data;
  };

  // ---------------------------------------------------------------- cutout
  const cutImg = h('img', { src: product.image, alt: `${product.name} — lineup cutout`, class: 'cutout__img' });
  const normalise = h('input', { type: 'checkbox', checked: true });
  const cutWarn = h('p', { class: 'img-warn', role: 'alert' });
  const cutInput = h('input', { type: 'file', accept: 'image/png,image/webp,image/*', class: 'sr-only', id: 'cut-file' });
  cutInput.addEventListener('change', async () => {
    const file = cutInput.files[0];
    cutInput.value = '';
    if (!file) return;
    cutWarn.textContent = '';
    status.textContent = `Uploading ${file.name}…`;
    try {
      const r = await upload(await prepare(file, 3000), 'cutout', normalise.checked);
      cutImg.src = r.url;
      onCutout?.(r.url);
      cutWarn.textContent = r.warnings?.join(' ') || '';
      status.textContent = 'Cutout updated.';
      toast('Cutout updated');
    } catch (err) { status.textContent = ''; fail(err); }
  });
  const cutout = h('section', { class: 'card stack' },
    h('div', { class: 'row', style: 'justify-content:space-between' }, h('h2', { style: 'margin:0' }, 'Lineup cutout'),
      h('label', { class: 'btn btn--sm' }, 'Replace', cutInput)),
    h('div', { class: 'cutout' }, cutImg, h('span', { class: 'cutout__base', 'aria-hidden': 'true' })),
    h('label', { class: 'check' }, normalise, 'Fit to the lineup (trim, scale, feet on the baseline)'),
    cutWarn,
    h('p', { class: 'muted', style: 'font-size:.8125rem' }, 'Full-body photo with the background removed (transparent PNG or WebP). The line marks the shared floor every figure stands on.'));

  // ---------------------------------------------------------------- gallery
  const grid = h('ul', { class: 'gallery', role: 'list' });
  const galInput = h('input', { type: 'file', accept: 'image/*', multiple: true, class: 'sr-only', id: 'gal-file' });

  const move = async (id, dir) => {
    const ids = images.map((i) => i.id);
    const at = ids.indexOf(id), to = at + dir;
    if (to < 0 || to >= ids.length) return;
    [ids[at], ids[to]] = [ids[to], ids[at]];
    try { images = (await api(`/api/admin/products/${product.id}/images/order`, { method: 'POST', body: { ids } })).images; render(); } catch (err) { fail(err); }
  };
  const remove = async (img) => {
    if (!confirm('Delete this photo?')) return;
    try { await api(`/api/admin/products/${product.id}/images/${img.id}`, { method: 'DELETE' }); images = images.filter((x) => x.id !== img.id); render(); toast('Photo deleted'); } catch (err) { fail(err); }
  };
  const saveAlt = async (img, value) => {
    if (value === img.alt) return;
    try { Object.assign(img, await api(`/api/admin/products/${product.id}/images/${img.id}`, { method: 'PATCH', body: { alt: value } })); toast('Description saved'); } catch (err) { fail(err); }
  };

  function render() {
    grid.replaceChildren(...images.map((img, i) => h('li', { class: 'gallery__item' },
      h('img', { src: img.url, alt: img.alt || '', loading: 'lazy' }),
      h('label', { class: 'sr-only', for: `alt-${img.id}` }, `Description for photo ${i + 1}`),
      h('input', { id: `alt-${img.id}`, value: img.alt, placeholder: 'Describe the photo', maxlength: 200, onchange: (e) => saveAlt(img, e.target.value.trim()) }),
      h('div', { class: 'row gallery__tools' },
        h('button', { type: 'button', class: 'btn btn--ghost btn--sm', disabled: i === 0, 'aria-label': `Move photo ${i + 1} earlier`, onclick: () => move(img.id, -1) }, '←'),
        h('button', { type: 'button', class: 'btn btn--ghost btn--sm', disabled: i === images.length - 1, 'aria-label': `Move photo ${i + 1} later`, onclick: () => move(img.id, 1) }, '→'),
        h('button', { type: 'button', class: 'btn btn--danger btn--sm', onclick: () => remove(img) }, 'Delete')))));
    if (!images.length) grid.append(h('li', { class: 'gallery__empty muted' }, 'No photos yet. Drop images here or press Add photos.'));
  }

  const addFiles = async (files) => {
    const list = [...files];
    for (const [n, file] of list.entries()) {
      status.textContent = `Uploading ${n + 1} of ${list.length}…`;
      try {
        const r = await upload(await prepare(file, 2400), 'gallery');
        images = r.images;
        render();
      } catch (err) { fail(err); }
    }
    status.textContent = list.length ? 'Done.' : '';
  };
  galInput.addEventListener('change', () => { const f = galInput.files; addFiles(f).finally(() => { galInput.value = ''; }); });

  const gallery = h('section', { class: 'card stack dropzone' },
    h('div', { class: 'row', style: 'justify-content:space-between' }, h('h2', { style: 'margin:0' }, 'Photos'),
      h('label', { class: 'btn btn--sm' }, 'Add photos', galInput)),
    grid,
    h('p', { class: 'muted', style: 'font-size:.8125rem' }, 'Detail, on-body and fabric shots. They appear in the product panel after the cutout, in this order. Up to 12.'));
  for (const ev of ['dragenter', 'dragover']) gallery.addEventListener(ev, (e) => { e.preventDefault(); gallery.classList.add('is-over'); });
  for (const ev of ['dragleave', 'drop']) gallery.addEventListener(ev, () => gallery.classList.remove('is-over'));
  gallery.addEventListener('drop', (e) => { e.preventDefault(); if (e.dataTransfer?.files?.length) addFiles(e.dataTransfer.files); });

  render();
  return h('div', { class: 'images' }, cutout, gallery, status);
}
