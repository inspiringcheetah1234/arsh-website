// Transactional email. With RESEND_API_KEY set, sends through Resend; otherwise it only records to email_log
// (visible in the admin under Settings → Email log), so nothing leaves the machine in development.

import { q } from './db.js';

const money = (n, c = 'PKR') => `${c} ${Number(n).toLocaleString('en-PK')}`;

export async function sendEmail({ to, subject, text }) {
  let status = 'logged';
  const key = process.env.RESEND_API_KEY;
  if (key && to) {
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: process.env.EMAIL_FROM || 'ARSH BY HZK <orders@example.com>', to: [to], subject, text }),
      });
      status = res.ok ? 'sent' : `failed ${res.status}`;
    } catch (err) {
      status = `failed ${err.message}`.slice(0, 120);
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
export function waitlistWelcome(entry) {
  const no = String(entry.number).padStart(4, '0');
  return {
    to: entry.email,
    subject: `ARSH — you are No. ${no}`,
    text: `${entry.name ? `${entry.name},\n\n` : ''}Received. You are No. ${no} on the list.\n\nWe write once, when the first collection opens.\n\nARSH BY HZK\nLahore, Pakistan`,
  };
}

export function waitlistInvite(entry, base) {
  return {
    to: entry.email,
    subject: 'ARSH — the first collection is open',
    text: `${entry.name ? `${entry.name},\n\n` : ''}The first collection is open, and you are invited.\n\n${base}/#collection\n\nUnchosen but still here.\n\nARSH BY HZK`,
  };
}

export function waitlistAlert(entry, to, base) {
  return {
    to,
    subject: `Waitlist No. ${String(entry.number).padStart(4, '0')} — ${entry.name || entry.email}`,
    text: `${entry.name || '(no name)'} <${entry.email}> joined the waitlist (${entry.source}).\n\n${base}/admin/#/waitlist`,
  };
}
