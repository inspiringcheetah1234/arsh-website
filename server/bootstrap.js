// Keeps the owner login in step with ADMIN_EMAIL / ADMIN_PASSWORD. Runs once per server start (and per cold start on Vercel).
// To reset the admin password: change ADMIN_PASSWORD (Vercel: Settings → Environment Variables) and redeploy.
import { one, q } from './db.js';
import { resetWaitlist } from './waitlist.js';
import { hashPassword, verifyPassword } from './auth.js';

export async function syncOwnerFromEnv() {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) return null;
  const production = process.env.VERCEL || process.env.NODE_ENV === 'production';
  if (production && password.length < 10) { console.warn('[bootstrap] ADMIN_PASSWORD must be at least 10 characters; owner not updated'); return null; }
  const existing = await one('SELECT id, password_hash FROM admins WHERE lower(email) = $1', [email]);
  if (!existing) {
    await q('INSERT INTO admins (email, name, password_hash, role) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING', [email, 'Owner', await hashPassword(password), 'owner']);
    return 'created';
  }
  if (!(await verifyPassword(password, existing.password_hash))) {
    await q("UPDATE admins SET password_hash = $2, role = 'owner' WHERE id = $1", [existing.id, await hashPassword(password)]);
    return 'updated';
  }
  return 'unchanged';
}

// One-time waitlist wipe: set RESET_WAITLIST to any new value (e.g. 2026-11-22) and redeploy. It runs once per value
// (the value is remembered in settings), so leaving the variable in place never wipes later signups.
export async function resetWaitlistFromEnv() {
  const token = process.env.RESET_WAITLIST?.trim();
  if (!token) return null;
  const done = await one("SELECT value FROM settings WHERE key = 'waitlistResetToken'");
  if (done && done.value === token) return 'already';
  const { deleted } = await resetWaitlist();
  await q("INSERT INTO settings (key, value) VALUES ('waitlistResetToken', $1::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", [JSON.stringify(token)]);
  console.warn(`[bootstrap] waitlist reset (${deleted} entries removed)`);
  return 'reset';
}
