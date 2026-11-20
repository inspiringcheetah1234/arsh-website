// Scheduled waitlist countdown emails. Vercel Cron calls /api/cron/reminders once a day.
// One reminder kind is due at a time: 'open' once the launch time has passed, 't1' in the last 24 h, 't7' in the last 7 days.
// Nobody gets a reminder for a threshold that passed before they joined (their welcome email already showed the countdown),
// and nobody gets the same kind twice (email_events).

import { all, q } from './db.js';
import { sendEmail, waitlistReminder, countdown } from './email.js';

const DAY = 864e5;

export function dueKind(launchAt, now = Date.now()) {
  const c = countdown(launchAt, now);
  if (!c) return null;
  if (c.open) return { kind: 'open', since: new Date(c.at) };
  if (c.ms <= DAY) return { kind: 't1', since: new Date(c.at - DAY) };
  if (c.ms <= 7 * DAY) return { kind: 't7', since: new Date(c.at - 7 * DAY) };
  return null;
}

export async function runReminders({ launchAt, base, limit = 150 }) {
  const due = dueKind(launchAt);
  if (!due) return { kind: null, sent: 0, note: launchAt ? 'nothing due yet' : 'no launch date set' };
  const rows = await all(`SELECT w.* FROM waitlist w
    WHERE w.status = 'waiting' AND w.created_at < $1
      AND NOT EXISTS (SELECT 1 FROM email_events e WHERE e.waitlist_id = w.id AND e.kind = $2)
    ORDER BY w.number LIMIT $3`, [due.since, due.kind, limit]);
  let sent = 0;
  for (const entry of rows) {
    const status = await sendEmail(waitlistReminder(entry, due.kind, { launchAt, base }));
    if (status === 'sent' || status === 'logged') { // a failed send is retried on the next run
      await q('INSERT INTO email_events (waitlist_id, kind) VALUES ($1, $2) ON CONFLICT DO NOTHING', [entry.id, due.kind]);
      sent++;
    }
  }
  return { kind: due.kind, sent, remaining: Math.max(0, rows.length - sent) };
}
