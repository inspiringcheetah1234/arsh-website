// Local dev server: static files from public/, the API from server/, same routes as Vercel.
// usage: npm run dev   (or: node scripts/serve.mjs [port])  ->  http://localhost:4173
// First run: creates the local database, loads the placeholder catalogue and, if ADMIN_EMAIL and
// ADMIN_PASSWORD are set in .env, creates that owner account.
import '../server/env.js';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { handle } from '../server/api.js';
import { db } from '../server/db.js';
import { seedCatalogue } from '../server/cli.js';
import { GATED, GATE_TARGET, PREVIEW_COOKIE } from '../server/gate.js';
import { parseCookies } from '../server/http.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
const PORT = Number(process.argv[2] || process.env.PORT || 4173);
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.otf': 'font/otf', '.ttf': 'font/ttf', '.mp4': 'video/mp4',
  '.txt': 'text/plain; charset=utf-8', '.ico': 'image/x-icon',
};
// Mirrors vercel.json rewrites + cleanUrls.
const REWRITES = [[/^\/p\/[A-Za-z0-9]+\/?$/, '/piece.html'], [/^\/admin\/?$/, '/admin/index.html']];

async function bootstrap() {
  await db();
  const n = await seedCatalogue();
  if (n) console.log(`seeded ${n} placeholder products`);
  // The owner in .env always works locally (db.js syncs it on connect).
}

async function file(res, path) {
  const target = normalize(join(ROOT, path));
  if (!target.startsWith(ROOT)) return false;
  try {
    const info = await stat(target);
    if (!info.isFile()) return false;
    res.writeHead(200, {
      'Content-Type': TYPES[extname(target)] || 'application/octet-stream',
      'Cache-Control': /\/(assets|vendor)\//.test(target) && !/\/assets\/frames\//.test(target) ? 'public, max-age=3600' : 'no-cache',
    });
    res.end(await readFile(target));
    return true;
  } catch { return false; }
}

await bootstrap();
createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (path === '/api' || path.startsWith('/api/')) return handle(req, res);
  if (process.env.SITE_GATE === '1' && GATED.includes(path.replace(/(.)\/$/, '$1')) && !parseCookies(req)[PREVIEW_COOKIE]) {
    res.writeHead(307, { Location: GATE_TARGET, 'Cache-Control': 'no-store' }).end();
    return;
  }
  const rw = REWRITES.find(([re]) => re.test(path));
  const candidates = rw ? [rw[1]] : path.endsWith('/') ? [path + 'index.html'] : [path, path + '.html'];
  for (const c of candidates) if (await file(res, c)) return;
  res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
}).listen(PORT, () => console.log(`ARSH → http://localhost:${PORT}   admin → http://localhost:${PORT}/admin`));
