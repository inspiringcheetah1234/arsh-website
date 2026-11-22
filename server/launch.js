// Launch phases, controlled from Admin → Overview (no code or Vercel changes needed):
//   waitlist  everyone who opens the main site is sent to /waitlist
//   early     the whole site is visible. Prices and buying are locked; waitlist members unlock them with their email
//   open      everyone can see prices and order
// The owner can always get past the waitlist phase with /api/preview?key=<PREVIEW_KEY> (cookie arsh_preview) and then sees everything unlocked.
// Pages are hidden by a small script in the page head that asks /api/launch (see public/js/gate.js). Prices and ordering are enforced here, on the server.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { parseCookies } from './http.js';
import { one } from './db.js';

export const PHASES = ['waitlist', 'early', 'open'];
export const PREVIEW_COOKIE = 'arsh_preview';
export const EARLY_COOKIE = 'arsh_early';
export const phaseOf = (settings) => (PHASES.includes(settings.launchPhase) ? settings.launchPhase : 'waitlist');

const secret = () => process.env.SESSION_SECRET || 'dev-only-session-secret-change-me-0000000000';
const sig = (email) => createHmac('sha256', secret()).update(`early:${email}`).digest('base64url').slice(0, 32);
export const earlyCookieValue = (email) => `${Buffer.from(email).toString('base64url')}.${sig(email)}`;
function earlyCookieOk(value) {
  const [b, s] = String(value || '').split('.');
  if (!b || !s) return false;
  let email = '';
  try { email = Buffer.from(b, 'base64url').toString(); } catch { return false; }
  const want = Buffer.from(sig(email)), got = Buffer.from(s);
  return want.length === got.length && timingSafeEqual(want, got);
}

/** What this visitor may see and do right now. */
export function viewerState(req, settings) {
  const phase = phaseOf(settings);
  const cookies = parseCookies(req);
  const preview = Boolean(cookies[PREVIEW_COOKIE]);
  const early = earlyCookieOk(cookies[EARLY_COOKIE]);
  const unlocked = phase === 'open' || preview || (phase === 'early' && early);
  return { phase, preview, gated: phase === 'waitlist' && !preview, unlocked, locked: !unlocked, canBuy: Boolean(settings.shopOpen) && unlocked };
}

/** Waitlist members who joined before early access opened (and were not removed) get in. */
export async function earlyMember(email, settings) {
  const row = await one("SELECT created_at FROM waitlist WHERE lower(email) = $1 AND status IN ('waiting', 'invited')", [String(email).trim().toLowerCase()]);
  if (!row) return 'unknown';
  if (settings.earlyOpenedAt && new Date(row.created_at) > new Date(settings.earlyOpenedAt)) return 'late';
  return 'ok';
}
