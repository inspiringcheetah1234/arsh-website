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
import { db, one, q } from '../server/db.js';
import { hashPassword, verifyPassword } from '../server/auth.js';
import { seedCatalogue } from '../server/cli.js';

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
  // Dev only: the owner in .env always works locally (created, or its password re-synced, on every start).
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  if (email && password) {
    const existing = await one('SELECT id, password_hash FROM admins WHERE lower(email) = $1', [email]);
    if (!existing) {
      await q('INSERT INTO admins (email, name, password_hash, role) VALUES ($1, $2, $3, $4)', [email, 'Owner', await hashPassword(password), 'owner']);
      console.log(`created owner account ${email} (password in .env)`);
    } else if (!(await verifyPassword(password, existing.password_hash))) {
      await q("UPDATE admins SET password_hash = $2, role = 'owner' WHERE id = $1", [existing.id, await hashPassword(password)]);
      console.log(`updated password for ${email} from .env`);
    }
  }
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
  const rw = REWRITES.find(([re]) => re.test(path));
  const candidates = rw ? [rw[1]] : path.endsWith('/') ? [path + 'index.html'] : [path, path + '.html'];
  for (const c of candidates) if (await file(res, c)) return;
  res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
}).listen(PORT, () => console.log(`ARSH → http://localhost:${PORT}   admin → http://localhost:${PORT}/admin`));
