// Admin auth: scrypt password hashes + HMAC-signed, HttpOnly session cookie. No server-side session store.

import { scrypt, randomBytes, timingSafeEqual, createHmac } from 'node:crypto';
import { promisify } from 'node:util';
import { HttpError, parseCookies } from './http.js';
import { one } from './db.js';

const scryptAsync = promisify(scrypt);
const COOKIE = 'arsh_admin';
const MAX_AGE = 60 * 60 * 12; // 12 h

function secret() {
  const s = process.env.SESSION_SECRET;
  if (s && s.length >= 32) return s;
  if (process.env.VERCEL || process.env.NODE_ENV === 'production') throw new Error('SESSION_SECRET (32+ chars) must be set');
  return 'dev-only-session-secret-change-me-0000000000';
}

export async function hashPassword(pw) {
  const salt = randomBytes(16);
  const key = await scryptAsync(pw, salt, 64);
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(pw, stored) {
  const [alg, s, k] = String(stored).split('$');
  if (alg !== 'scrypt' || !s || !k) return false;
  const key = await scryptAsync(pw, Buffer.from(s, 'base64'), 64);
  const want = Buffer.from(k, 'base64');
  return want.length === key.length && timingSafeEqual(want, key);
}

const sign = (data) => createHmac('sha256', secret()).update(data).digest('base64url');

export function sessionCookie(admin) {
  const payload = Buffer.from(JSON.stringify({ id: admin.id, exp: Math.floor(Date.now() / 1000) + MAX_AGE })).toString('base64url');
  const value = `${payload}.${sign(payload)}`;
  const secure = process.env.VERCEL || process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${MAX_AGE}${secure}`;
}
export const clearCookie = () => `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`;

export async function currentAdmin(req) {
  const raw = parseCookies(req)[COOKIE];
  if (!raw) return null;
  const [payload, sig] = raw.split('.');
  if (!payload || !sig) return null;
  const expected = sign(payload);
  if (expected.length !== sig.length || !timingSafeEqual(Buffer.from(expected), Buffer.from(sig))) return null;
  let data;
  try { data = JSON.parse(Buffer.from(payload, 'base64url').toString()); } catch { return null; }
  if (!data.exp || data.exp < Date.now() / 1000) return null;
  return one('SELECT id, email, name, role FROM admins WHERE id = $1', [data.id]);
}

/** Admin guard. Mutations also require a custom header, which cross-site forms cannot send (CSRF). */
export async function requireAdmin(req) {
  const admin = await currentAdmin(req);
  if (!admin) throw new HttpError(401, 'Sign in required');
  if (req.method !== 'GET' && req.headers['x-arsh-admin'] !== '1') throw new HttpError(403, 'Missing admin header');
  return admin;
}

// Best-effort login throttle (per instance).
const attempts = new Map();
export function throttle(key, limit = 8) {
  const now = Date.now();
  const list = (attempts.get(key) || []).filter((t) => now - t < 15 * 60_000);
  if (list.length >= limit) throw new HttpError(429, 'Too many attempts. Try again in a few minutes.');
  list.push(now);
  attempts.set(key, list);
}
export const clearThrottle = (key) => attempts.delete(key);
