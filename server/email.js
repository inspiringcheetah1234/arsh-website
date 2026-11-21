// Transactional email. Sends through SMTP (SMTP_USER + SMTP_PASS, e.g. a Google Workspace mailbox) or Resend (RESEND_API_KEY);
// with neither set it only records to email_log (admin → Settings → Email log), so nothing leaves the machine in development.

import { q } from './db.js';

const money = (n, c = 'PKR') => `${c} ${Number(n).toLocaleString('en-PK')}`;

let smtp = null;
async function smtpTransport() {
  if (smtp) return smtp;
  const { default: nodemailer } = await import('nodemailer');
  smtp = process.env.SMTP_HOST === 'json' // tests only: build the message, send nothing
    ? nodemailer.createTransport({ jsonTransport: true })
    : nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.gmail.com', port: Number(process.env.SMTP_PORT || 465), secure: Number(process.env.SMTP_PORT || 465) === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
  return smtp;
}

// Sends through (1) SMTP, e.g. a Google Workspace mailbox, when SMTP_USER + SMTP_PASS are set, else (2) Resend when RESEND_API_KEY is set,
// else only records the message in email_log.
export async function sendEmail({ to, subject, text, html, attachments }) {
  let status = 'logged';
  const from = process.env.EMAIL_FROM || (process.env.SMTP_USER ? `ARSH <${process.env.SMTP_USER}>` : 'ARSH <orders@example.com>');
  if (to && ((process.env.SMTP_USER && process.env.SMTP_PASS) || process.env.SMTP_HOST === 'json')) {
    try {
      const t = await smtpTransport();
      await t.sendMail({ from, to, subject, text, ...(html ? { html } : {}),
        ...(attachments ? { attachments: attachments.map((a) => ({ filename: a.filename, content: a.content, encoding: 'base64' })) } : {}) });
      status = 'sent';
    } catch (err) {
      status = `failed ${err.message}`.slice(0, 120);
    }
  } else {
    const key = process.env.RESEND_API_KEY;
    if (key && to) {
      try {
        const res = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ from, to: [to], subject, text, ...(html ? { html } : {}), ...(attachments ? { attachments } : {}) }),
        });
        status = res.ok ? 'sent' : `failed ${res.status}`;
      } catch (err) {
        status = `failed ${err.message}`.slice(0, 120);
      }
    }
  }
  await q('INSERT INTO email_log (recipient, subject, body, status) VALUES ($1, $2, $3, $4)', [to || '', subject, text, status]).catch(() => {});
  return status;
}

export function orderConfirmation(order, items, settings, base) {
  const lines = items.map((i) => `  ${i.name} (${i.article}) — size ${i.size} × ${i.quantity}   ${money(i.unit_price * i.quantity, order.currency)}`).join('\n');
  const pay = order.payment_method === 'bank'
    ? `\nPayment: bank transfer\n${settings.bankDetails}\n`
    : '\nPayment: cash on delivery\n';
  return {
    to: order.email,
    subject: `ARSH — order ${order.number} received`,
    text: `${order.name},\n\nThank you. Your order ${order.number} has been received.\n\n${lines}\n\n  Subtotal  ${money(order.subtotal, order.currency)}\n  Shipping  ${money(order.shipping, order.currency)}\n  Total     ${money(order.total, order.currency)}\n${pay}\nEach piece is registered to you before it leaves Lahore. Scan the code inside to see it.\n\nTrack your order: ${base}/order?n=${encodeURIComponent(order.number)}\n\nARSH BY HZK`,
  };
}

export function orderShipped(order, base) {
  return {
    to: order.email,
    subject: `ARSH — order ${order.number} is on its way`,
    text: `${order.name},\n\nYour order ${order.number} has left Lahore.${order.courier ? `\nCourier: ${order.courier}` : ''}${order.tracking ? `\nTracking: ${order.tracking}` : ''}\n\n${base}/order?n=${encodeURIComponent(order.number)}\n\nARSH BY HZK`,
  };
}

export function newOrderAlert(order, to, base) {
  return {
    to,
    subject: `New order ${order.number} — ${money(order.total, order.currency)}`,
    text: `${order.name} <${order.email}> placed ${order.number} (${order.payment_method.toUpperCase()}).\n\n${base}/admin/#/orders/${order.id}`,
  };
}

// ---------------------------------------------------------------- waitlist
export const pad = (n) => String(n).padStart(4, '0');
const esc = (v) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** Time left until `launchAt` (ISO string). null when no date is set. */
export function countdown(launchAt, now = Date.now()) {
  const t = Date.parse(launchAt || '');
  if (!t) return null;
  const ms = t - now;
  if (ms <= 0) return { open: true, ms, days: 0, hours: 0, minutes: 0, at: t };
  return { open: false, ms, days: Math.floor(ms / 864e5), hours: Math.floor((ms % 864e5) / 36e5), minutes: Math.floor((ms % 36e5) / 6e4), at: t };
}
const when = (t) => new Date(t).toLocaleString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Karachi' }) + ' (Pakistan time)';
const day = (t) => new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Karachi' });
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const left = (c) => c.days >= 1 ? `${plural(c.days, 'day')}, ${plural(c.hours, 'hour')}` : `${plural(c.hours, 'hour')}, ${plural(c.minutes, 'minute')}`;

// Brand email shell: Orbit Red band with the wordmark, Ticket Cream letter. Inline styles and tables only, because mail clients ignore the rest.
function shell({ base, preheader, body }) {
  return `<!doctype html><html><body style="margin:0;padding:0;background:#F6ECE1">
<span style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(preheader)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F6ECE1"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#F6ECE1;font-family:Helvetica,Arial,sans-serif;color:#0D0D0D">
<tr><td style="background:#F23B35;padding:28px 32px"><img src="${base}/assets/brand/email-wordmark.png" width="200" alt="ARSH" style="display:block;border:0;height:auto;max-width:100%"></td></tr>
<tr><td style="padding:36px 32px 12px;font-size:16px;line-height:1.6">${body}</td></tr>
<tr><td style="padding:12px 32px 36px;font-size:12px;line-height:1.5;color:#0D0D0D;opacity:.75">ARSH · Lahore, Pakistan<br>You are receiving this because you joined the ARSH waitlist.</td></tr>
</table></td></tr></table></body></html>`;
}

function countdownBlock(c) {
  if (!c) return '';
  if (c.open) return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:24px 0"><tr><td style="background:#2B3DB0;color:#F6ECE1;padding:24px;text-align:center;font-size:28px;font-weight:700;letter-spacing:.04em">EARLY ACCESS IS OPEN</td></tr></table>`;
  const cell = (n, l) => `<td align="center" style="padding:0 14px"><div style="font-size:48px;line-height:1;font-weight:700;color:#F6ECE1">${String(n).padStart(2, '0')}</div><div style="font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:#F6ECE1;margin-top:6px">${l}</div></td>`;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:24px 0"><tr><td align="center" style="background:#2B3DB0;padding:26px 8px">
<table role="presentation" cellpadding="0" cellspacing="0"><tr>${cell(c.days, 'days')}${cell(c.hours, 'hours')}${cell(c.minutes, 'minutes')}</tr></table>
<div style="color:#F6ECE1;font-size:13px;margin-top:16px">until early access opens<br>${esc(day(c.at))}</div></td></tr></table>`;
}

export function waitlistWelcome(entry, { launchAt = '', base = '' } = {}) {
  const no = pad(entry.number);
  const c = countdown(launchAt);
  const access = c ? (c.open ? 'Your early access has begun.' : `Your early access begins on ${day(c.at)}.`) : 'You will hear from us the moment early access begins.';
  const subject = c && !c.open ? `An invitation to the unchosen — ${left(c)} to go` : 'An invitation to the unchosen';
  const paras = [
    'Welcome to ARSH.',
    'For those who never quite fit the mould. For the imperfect, the unfinished, and those still figuring it out.',
    'You belong here.',
    'You’ve secured your place on our waitlist, and with it comes an invitation to experience our first collection before the rest of the universe.',
    access,
    '25 pieces of each design. Never to be reproduced.',
    'The countdown has begun.',
  ];
  const text = `AN INVITATION TO THE UNCHOSEN.\n\n${paras.join('\n\n')}\n\n${c && !c.open ? `${left(c)} to go.\n\n` : ''}Until then, stay unchosen.\n\n— ARSH\n\nYour waitlist number: No. ${no}${base ? `\nLive countdown: ${base}/waitlist` : ''}`;
  const p = (t, extra = '') => `<p style="margin:0 0 18px;${extra}">${esc(t)}</p>`;
  const html = shell({ base, preheader: 'You’ve secured your place on the ARSH waitlist.', body:
    `<h1 style="margin:0 0 24px;font-family:'Arial Narrow',Impact,Helvetica,Arial,sans-serif;font-size:40px;line-height:1.05;font-weight:700;text-transform:uppercase;color:#0D0D0D">An invitation to the unchosen.</h1>
${paras.slice(0, 5).map((t, i) => p(t, i === 0 ? 'font-weight:700;' : i === 4 ? 'font-weight:700;color:#A51D1E;' : '')).join('\n')}
${paras.slice(5).map((t) => p(t)).join('\n')}
${countdownBlock(c)}
<p style="margin:0 0 18px">Until then, stay unchosen.</p>
<p style="margin:0 0 24px;font-weight:700">— ARSH</p>
<p style="margin:0;font-size:12px;letter-spacing:.14em;text-transform:uppercase">Your waitlist number: No. ${no}${base ? ` · <a href="${base}/waitlist" style="color:#0D0D0D">Live countdown</a>` : ''}</p>` });
  return { to: entry.email, subject, text, html };
}

/** Scheduled countdown emails: 't7' (one week), 't1' (the day before), 'open' (it is open). */
export function waitlistReminder(entry, kind, { launchAt = '', base = '' } = {}) {
  const c = countdown(launchAt);
  const hello = entry.name ? `${entry.name},` : 'Hello,';
  const copy = {
    t7: { subject: 'ARSH — one week to go', line: 'One week until your early access begins.' },
    t1: { subject: 'ARSH — tomorrow', line: 'Your early access begins tomorrow.' },
    open: { subject: 'ARSH — your early access has begun', line: 'Your early access has begun. The first collection is open to you.' },
  }[kind];
  const link = kind === 'open' ? `${base}/` : `${base}/waitlist`;
  const text = `${hello}\n\n${copy.line}\n${c && !c.open ? `\n${left(c)} to go · ${when(c.at)}\n` : ''}\n${link}\n\n— ARSH`;
  const html = shell({ base, preheader: copy.line, body:
    `<p style="margin:0 0 8px">${esc(hello)}</p><p style="margin:0">${esc(copy.line)}</p>
${countdownBlock(c)}
<p style="margin:0 0 16px"><a href="${link}" style="color:#0D0D0D;font-weight:700">${kind === 'open' ? 'Enter ARSH' : 'See the live countdown'}</a></p>
<p style="margin:0">— ARSH</p>` });
  return { to: entry.email, subject: copy.subject, text, html };
}

export function waitlistInvite(entry, base) {
  return {
    to: entry.email,
    subject: 'ARSH — the first collection is open',
    text: `${entry.name ? `${entry.name},\n\n` : ''}The first collection is open, and you are invited.\n\n${base}/#collection\n\nUnchosen but still here.\n\n— ARSH`,
  };
}

export function waitlistAlert(entry, to, base) {
  return {
    to,
    subject: `Waitlist No. ${pad(entry.number)} — ${entry.name || entry.email}`,
    text: `${entry.name || '(no name)'} <${entry.email}> joined the waitlist (${entry.source}).\n\n${base}/admin/#/waitlist`,
  };
}

/** The "data bank" copy: every detail of a new signup, to the address chosen in Settings. */
export function waitlistDataBank(entry, to) {
  const rows = [['Number', pad(entry.number)], ['Name', entry.name], ['Email', entry.email], ['Phone', entry.phone], ['City', entry.city],
    ['Interested in', [entry.article, entry.product_name].filter(Boolean).join(' — ')], ['Size', entry.size], ['Heard from', entry.heard_from],
    ['Source', entry.source], ['Joined', new Date(entry.created_at || Date.now()).toISOString()]];
  return { to, subject: `[ARSH data bank] ${pad(entry.number)} — ${entry.email}`, text: rows.map(([k, v]) => `${k}: ${v || '—'}`).join('\n') };
}

/** The whole list as a CSV attachment. */
export function waitlistDataBankExport(csv, count, to) {
  return {
    to,
    subject: `[ARSH data bank] Waitlist export — ${count} ${count === 1 ? 'person' : 'people'}`,
    text: `The full ARSH waitlist (${count} ${count === 1 ? 'entry' : 'entries'}) is attached as a CSV.\n\nSent ${new Date().toISOString()}.`,
    attachments: [{ filename: 'arsh-waitlist.csv', content: Buffer.from(csv, 'utf8').toString('base64') }],
  };
}
