// Shop settings stored in the database, editable from the admin.

import { all, q } from './db.js';

export const DEFAULTS = {
  shopOpen: true,                 // false = "Request Access" mode, no checkout
  currency: 'PKR',
  shippingFlat: 500,              // PKR
  freeShippingOver: 0,            // 0 = never free
  paymentMethods: ['cod', 'bank'],
  bankDetails: 'Bank: —\nAccount title: —\nIBAN: —\nPlease use your order number as the reference.',
  siteUrl: '',                    // e.g. https://arsh.pk — used in QR codes and emails; falls back to SITE_URL env / request host
  ownerDisplay: 'first-initial',  // how the owner shows on a piece page: 'full' | 'first-initial' | 'first'
  notifyEmail: '',                // where new-order alerts go
  launchAt: '2026-12-14T19:00:00.000Z', // early access opens 15 Dec 2026, 00:00 Pakistan time; drives the countdown on /waitlist and in emails (admin can change it; '' = no countdown)
  launchPhase: 'waitlist',        // 'waitlist' | 'early' | 'open' — set from Admin → Overview
  earlyOpenedAt: '',              // when early access was opened; only people who joined before this unlock
  dataBankEmail: '',              // every waitlist signup is also emailed here, and the admin can email the full list here
  dataBankAuto: true,             // copy each new signup to dataBankEmail automatically
};

export async function getSettings() {
  const rows = await all('SELECT key, value FROM settings');
  const out = { ...DEFAULTS };
  for (const r of rows) if (r.key in DEFAULTS) out[r.key] = r.value;
  return out;
}

export async function saveSettings(patch) {
  for (const [k, v] of Object.entries(patch)) {
    if (!(k in DEFAULTS)) continue;
    await q('INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value', [k, JSON.stringify(v)]);
  }
  return getSettings();
}

export function siteUrl(settings, req) {
  const s = settings.siteUrl || process.env.SITE_URL;
  if (s) return s.replace(/\/$/, '');
  const host = req?.headers?.['x-forwarded-host'] || req?.headers?.host || 'localhost:4173';
  const proto = req?.headers?.['x-forwarded-proto'] || (/^localhost|^127\./.test(host) ? 'http' : 'https');
  return `${proto}://${host}`;
}

export function displayOwner(name, mode) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '';
  if (mode === 'full') return parts.join(' ');
  if (mode === 'first' || parts.length === 1) return parts[0];
  return `${parts[0]} ${parts.at(-1)[0].toUpperCase()}.`;
}
