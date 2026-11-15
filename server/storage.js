// File storage for uploaded images.
// Production (Vercel): Vercel Blob — set BLOB_READ_WRITE_TOKEN (Vercel → Storage → Blob creates it).
// Local dev: files land in public/uploads/ and are served by the dev server.

import { mkdir, writeFile, unlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, normalize } from 'node:path';
import { randomBytes } from 'node:crypto';

const UPLOADS = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'uploads');

export const storageKind = () => (process.env.BLOB_READ_WRITE_TOKEN ? 'blob' : process.env.VERCEL ? 'none' : 'local');

export async function putFile(name, buffer, contentType) {
  const ext = { 'image/webp': '.webp', 'image/png': '.png', 'image/jpeg': '.jpg' }[contentType] || '';
  const key = `products/${name}-${randomBytes(5).toString('hex')}${ext}`;
  const kind = storageKind();
  if (kind === 'blob') {
    const { put } = await import('@vercel/blob');
    const res = await put(key, buffer, { access: 'public', contentType, addRandomSuffix: false, cacheControlMaxAge: 31536000 });
    return res.url;
  }
  if (kind === 'none') throw new Error('Image storage is not configured. Add a Vercel Blob store (BLOB_READ_WRITE_TOKEN).');
  const file = join(UPLOADS, key);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, buffer);
  return `/uploads/${key}`;
}

/** Removes a file this app uploaded. Paths outside /uploads (e.g. bundled placeholders) are left alone. */
export async function removeFile(url) {
  try {
    if (/^https:\/\/[^/]+\.blob\.vercel-storage\.com\//.test(url) && process.env.BLOB_READ_WRITE_TOKEN) {
      const { del } = await import('@vercel/blob');
      await del(url);
    } else if (url.startsWith('/uploads/')) {
      const file = normalize(join(UPLOADS, url.slice('/uploads/'.length)));
      if (file.startsWith(UPLOADS)) await unlink(file);
    }
  } catch { /* already gone */ }
}
