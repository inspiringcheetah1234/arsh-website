// Maintenance CLI.
//   node server/cli.js migrate                         create/upgrade tables
//   node server/cli.js seed                            load the placeholder catalogue (only if there are no products)
//   node server/cli.js admin:create <email> [name] [--owner]   prompts for a password (or ADMIN_PASSWORD env)
import './env.js';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { db, one, q } from './db.js';
import { hashPassword } from './auth.js';
import { createProduct } from './products.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const [cmd, ...args] = process.argv.slice(2);

export async function seedCatalogue() {
  const has = await one('SELECT count(*)::int AS n FROM products');
  if (has.n > 0) return 0;
  const data = JSON.parse(await readFile(join(HERE, 'seed', 'catalogue.json'), 'utf8'));
  const sizes = ['28', '30', '32', '34', '36'];
  for (const [i, it] of data.items.entries()) {
    await createProduct({
      name: it.name, slug: it.slug, article: `A${String(i + 1).padStart(2, '0')}`,
      description: 'Placeholder description. Replace in the admin.',
      fit: it.meta.fit, wash: it.meta.wash, fabric: it.meta.fabric,
      price: it.price ?? 45000, edition_size: 250, image: '/' + it.image.replace(/^\//, ''), status: 'active', sort: i,
      variants: sizes.map((size) => ({ size, stock: 6 })),
    });
  }
  return data.items.length;
}

async function main() {
  await db();
  if (cmd === 'migrate') { console.log('schema up to date'); return; }
  if (cmd === 'seed') { console.log(`seeded ${await seedCatalogue()} products`); return; }
  if (cmd === 'admin:create') {
    const [email, ...rest] = args.filter((a) => !a.startsWith('--'));
    if (!email) throw new Error('usage: admin:create <email> [name] [--owner]');
    let pw = process.env.ADMIN_PASSWORD;
    if (!pw) {
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      pw = await rl.question('Password (10+ characters): ');
      rl.close();
    }
    if (!pw || pw.length < 10) throw new Error('Password must be at least 10 characters');
    await q(`INSERT INTO admins (email, name, password_hash, role) VALUES ($1, $2, $3, $4)
             ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, role = EXCLUDED.role`,
    [email.toLowerCase(), rest.join(' '), await hashPassword(pw), args.includes('--owner') ? 'owner' : 'staff']);
    console.log(`admin ${email} saved`);
    return;
  }
  console.log('commands: migrate | seed | admin:create <email> [name] [--owner]');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().then(() => process.exit(0), (err) => { console.error(err.message); process.exit(1); });
}
