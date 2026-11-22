// Admin → Waitlist: list, filter, search, notes, status, bulk invite, CSV export.
// Everything user-supplied goes in through h() as text, never as HTML.

const pad = (n) => String(n).padStart(4, '0');

export async function viewWaitlist(ctx, qs) {
  const { h, api, page, toast, fail, when, day, pill } = ctx;
  const status = qs.get('status') || '';
  const q = qs.get('q') || '';
  const pageNo = Number(qs.get('page')) || 1;
  const d = await api(`/api/admin/waitlist?${new URLSearchParams({ status, q, page: pageNo })}`);
  const go = (patch) => { location.hash = `#/waitlist?${new URLSearchParams({ status, q, ...patch })}`; };
  const reload = () => viewWaitlist(ctx, qs);

  // ---------------------------------------------------------------- selection + invite
  const selected = new Set();
  const inviteBtn = h('button', { class: 'btn', type: 'button', disabled: true }, 'Invite selected');
  const refreshInvite = () => {
    inviteBtn.disabled = selected.size === 0;
    inviteBtn.textContent = selected.size ? `Invite selected (${selected.size})` : 'Invite selected';
  };
  const bankBtn = h('button', { class: 'btn btn--ghost', type: 'button' }, 'Email list to data bank');
  bankBtn.addEventListener('click', async () => {
    if (!confirm('Email the full waitlist as a CSV to the data bank address set in Settings?')) return;
    bankBtn.disabled = true;
    try {
      const r = await api('/api/admin/waitlist/databank', { method: 'POST' });
      toast(r.status === 'sent' ? `Sent ${r.count} entries to ${r.to}` : r.status === 'logged' ? `Not sent: email is not configured yet (saved in the email log)` : `Email ${r.status}`);
    } catch (err) { fail(err); } finally { bankBtn.disabled = false; }
  });
  // ---------------------------------------------------------------- write to the list
  const subjectIn = h('input', { id: 'bc-subject', maxlength: '150', placeholder: 'Subject' });
  const messageIn = h('textarea', { id: 'bc-message', rows: '9', maxlength: '8000', placeholder: 'Write your message. Leave a blank line between paragraphs. Use {name} for their first name.' });
  const audienceIn = h('select', { id: 'bc-audience' }, h('option', { value: 'waiting' }, 'People still waiting'), h('option', { value: 'all' }, 'Everyone (waiting and invited)'));
  const testIn = h('input', { id: 'bc-test', type: 'email', placeholder: 'Your email, for a test copy' });
  let bcId = null;
  const bcStatus = h('p', { class: 'ui muted', role: 'status', 'aria-live': 'polite' });
  const testBtn = h('button', { class: 'btn btn--ghost', type: 'button' }, 'Send me a test');
  const sendBtn = h('button', { class: 'btn', type: 'button' }, 'Send to the list');
  const field = (label, id, el) => h('div', { class: 'f' }, h('label', { for: id }, label), el);
  const composer = h('div', { class: 'card', style: 'margin-bottom:1.5rem;display:none;gap:1rem' },
    h('h2', { class: 'ui' }, 'Email the waitlist'),
    field('To', 'bc-audience', audienceIn), field('Subject', 'bc-subject', subjectIn), field('Message', 'bc-message', messageIn),
    h('div', { class: 'row' }, testIn, testBtn), bcStatus, h('div', { class: 'row' }, sendBtn));
  const content = () => ({ subject: subjectIn.value.trim(), message: messageIn.value.trim() });
  testBtn.addEventListener('click', async () => {
    testBtn.disabled = true; bcStatus.textContent = '';
    try {
      const r = await api('/api/admin/waitlist/broadcast', { method: 'POST', body: { ...content(), test: true, to: testIn.value.trim() } });
      bcStatus.textContent = r.status === 'sent' ? `Test sent to ${r.to}.` : r.status === 'logged' ? 'Not sent: email is not configured yet (saved in the email log).' : `Email ${r.status}`;
    } catch (err) { fail(err); } finally { testBtn.disabled = false; }
  });
  sendBtn.addEventListener('click', async () => {
    const id = bcId || (bcId = Date.now().toString(36)); // kept until a send fully succeeds, so a retry only reaches people who missed it
    const body = { ...content(), audience: audienceIn.value, id };
    sendBtn.disabled = true; bcStatus.textContent = '';
    try {
      const { count } = await api('/api/admin/waitlist/broadcast', { method: 'POST', body: { ...body, dryRun: true } });
      if (!count) { bcStatus.textContent = 'Nobody to send to.'; return; }
      if (!confirm(`Send "${body.subject}" to ${count} ${count === 1 ? 'person' : 'people'} now? This cannot be undone.`)) return;
      let sent = 0, failed = 0;
      for (let guard = 0; guard < 400; guard++) {
        bcStatus.textContent = `Sending… ${sent} of ${count}`;
        const r = await api('/api/admin/waitlist/broadcast', { method: 'POST', body });
        sent += r.sent; failed = r.failed;
        if (!r.remaining || !r.sent) break;
      }
      if (!failed) bcId = null;
      bcStatus.textContent = failed ? `Sent ${sent} of ${count}. ${failed} failed; press Send again to retry only those.` : `Sent to ${sent} ${sent === 1 ? 'person' : 'people'}.`;
      toast(`Emailed ${sent} of ${count}`);
    } catch (err) { fail(err); } finally { sendBtn.disabled = false; }
  });
  const composeBtn = h('button', { class: 'btn', type: 'button' }, 'Email the list');
  composeBtn.addEventListener('click', () => { const open = composer.style.display === 'none'; composer.style.display = open ? 'grid' : 'none'; if (open) subjectIn.focus(); });

  const resetBtn = h('button', { class: 'btn btn--ghost', type: 'button' }, 'Reset list to 0');
  resetBtn.addEventListener('click', async () => {
    const password = prompt('This permanently deletes EVERY waitlist entry and restarts numbering at 0001. It cannot be undone. Export the CSV first if you need it.\n\nEnter the reset password to continue.');
    if (!password) return;
    resetBtn.disabled = true;
    try {
      const r = await api('/api/admin/waitlist/reset', { method: 'POST', body: { password } });
      toast(`Waitlist reset (${r.deleted} removed)`);
      reload();
    } catch (err) { fail(err); } finally { resetBtn.disabled = false; }
  });
  inviteBtn.addEventListener('click', async () => {
    const n = selected.size;
    if (!n || !confirm(`Send the invitation email to ${n} ${n === 1 ? 'person' : 'people'}? They are marked as invited.`)) return;
    inviteBtn.disabled = true;
    try {
      const r = await api('/api/admin/waitlist/invite', { method: 'POST', body: { ids: [...selected] } });
      toast(`${r.invited} invited${r.skipped ? `, ${r.skipped} skipped` : ''}`);
      reload();
    } catch (err) { fail(err); refreshInvite(); }
  });

  // ---------------------------------------------------------------- detail dialog
  const open = (entry) => {
    const statusSel = h('select', { id: 'wl-st' }, ['waiting', 'invited', 'removed'].map((s) => h('option', { value: s, selected: s === entry.status }, s)));
    const note = h('textarea', { id: 'wl-note', rows: 3, placeholder: 'Internal note (only staff see this)' }, entry.note);
    const dlg = h('dialog', { class: 'dlg', 'aria-labelledby': 'wl-dlg-title' });
    const close = () => { dlg.close(); dlg.remove(); };
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); close(); });
    const save = async () => {
      try {
        await api(`/api/admin/waitlist/${entry.id}`, { method: 'PATCH', body: { status: statusSel.value, note: note.value } });
        toast('Saved');
        close();
        reload();
      } catch (err) { fail(err); }
    };
    const del = async () => {
      if (!confirm(`Delete ${entry.name || entry.email} from the waitlist for good? Use this for "please remove me" requests.`)) return;
      try { await api(`/api/admin/waitlist/${entry.id}`, { method: 'DELETE' }); toast('Deleted'); close(); reload(); } catch (err) { fail(err); }
    };
    dlg.append(h('div', { class: 'dlg__body' },
      h('div', { class: 'row', style: 'justify-content:space-between' },
        h('h2', { id: 'wl-dlg-title', style: 'margin:0' }, `No. ${pad(entry.number)}`), h('button', { type: 'button', class: 'link', onclick: close }, 'Close')),
      h('p', { class: 'dlg__name' }, entry.name || '—'),
      h('dl', { class: 'kv' },
        h('dt', {}, 'Email'), h('dd', {}, h('a', { href: `mailto:${entry.email}` }, entry.email)),
        entry.phone ? [h('dt', {}, 'Phone'), h('dd', {}, h('a', { href: `tel:${entry.phone.replace(/\s/g, '')}` }, entry.phone))] : null,
        entry.city ? [h('dt', {}, 'City'), h('dd', {}, entry.city)] : null,
        h('dt', {}, 'Interested'), h('dd', {}, entry.interest ? `${entry.interest}${entry.size ? `, size ${entry.size}` : ''}` : entry.article ? `${entry.article} — ${entry.product_name}${entry.size ? `, size ${entry.size}` : ''}` : entry.size ? `Size ${entry.size}` : 'Anything'),
        entry.heard_from ? [h('dt', {}, 'Heard via'), h('dd', {}, entry.heard_from)] : null,
        h('dt', {}, 'Source'), h('dd', {}, entry.source),
        h('dt', {}, 'Joined'), h('dd', {}, when(entry.created_at)),
        entry.invited_at ? [h('dt', {}, 'Invited'), h('dd', {}, when(entry.invited_at))] : null,
        entry.has_order ? [h('dt', {}, 'Customer'), h('dd', {}, 'Has placed an order')] : null),
      h('label', { class: 'f' }, 'Status', statusSel),
      h('label', { class: 'f' }, 'Note', note),
      h('div', { class: 'row' },
        h('button', { class: 'btn', type: 'button', onclick: save }, 'Save'),
        h('button', { class: 'btn btn--danger', type: 'button', style: 'margin-left:auto', onclick: del }, 'Delete'))));
    document.body.append(dlg);
    dlg.showModal();
  };

  // ---------------------------------------------------------------- list
  const tick = (entry) => {
    if (entry.status !== 'waiting') return h('td', {});
    const box = h('input', { type: 'checkbox', 'aria-label': `Select ${entry.name || entry.email}` });
    box.addEventListener('change', () => { box.checked ? selected.add(entry.id) : selected.delete(entry.id); refreshInvite(); });
    return h('td', { style: 'width:2.5rem', onclick: (e) => e.stopPropagation() }, box);
  };
  const waitingIds = d.entries.filter((e) => e.status === 'waiting').map((e) => e.id);
  const all = h('input', { type: 'checkbox', 'aria-label': 'Select everyone waiting on this page', disabled: !waitingIds.length });
  all.addEventListener('change', () => {
    selected.clear();
    if (all.checked) waitingIds.forEach((id) => selected.add(id));
    document.querySelectorAll('.wl-table tbody input[type=checkbox]').forEach((b) => { b.checked = all.checked; });
    refreshInvite();
  });

  const table = d.entries.length
    ? h('div', { class: 'table-wrap' }, h('table', { class: 'wl-table' },
      h('thead', {}, h('tr', {}, h('th', {}, all), h('th', {}, 'No.'), h('th', {}, 'Name'), h('th', {}, 'Contact'), h('th', {}, 'City'), h('th', {}, 'Interested'), h('th', {}, 'Joined'), h('th', {}, 'Status'))),
      h('tbody', {}, d.entries.map((e) => h('tr', { class: 'click', tabindex: 0, onclick: () => open(e), onkeydown: (ev) => { if (ev.key === 'Enter') open(e); } },
        tick(e),
        h('td', { class: 'mono' }, pad(e.number)),
        h('td', {}, e.name || h('span', { class: 'muted' }, '—')),
        h('td', {}, h('div', {}, e.email), e.phone ? h('div', { class: 'muted' }, e.phone) : null),
        h('td', {}, e.city || ''),
        h('td', {}, e.article ? `${e.article}${e.size ? ` · ${e.size}` : ''}` : e.size ? `· ${e.size}` : 'Anything'),
        h('td', { class: 'muted' }, day(e.created_at)),
        h('td', {}, pill(e.status), e.has_order ? [' ', pill('paid', 'customer')] : null))))))
    : h('div', { class: 'table-wrap' }, h('p', { class: 'empty' }, q || status ? 'Nobody matches.' : 'Nobody on the list yet.'));

  const search = h('form', { class: 'row', role: 'search', onsubmit: (e) => { e.preventDefault(); go({ q: e.target.q.value.trim(), page: 1 }); } },
    h('label', { class: 'sr-only', for: 'wq' }, 'Search the waitlist'),
    h('input', { id: 'wq', name: 'q', value: q, placeholder: 'Name, email, phone, city', style: 'max-width:20rem' }),
    h('button', { class: 'btn btn--ghost', type: 'submit' }, 'Search'));
  const tabs = h('div', { class: 'tabs', role: 'group', 'aria-label': 'Filter by status' },
    ['', 'waiting', 'invited', 'removed'].map((s) => h('button', { type: 'button', 'aria-pressed': String(s === status), onclick: () => go({ status: s, page: 1 }) }, s || 'All')));
  const kpi = (label, value) => h('div', { class: 'kpi' }, h('span', { class: 'ui muted' }, label), h('b', {}, value));

  page('Waitlist',
    [composeBtn, h('a', { class: 'btn btn--ghost', href: `/api/admin/waitlist/export?status=${encodeURIComponent(status)}` }, 'Export CSV'), bankBtn, resetBtn, inviteBtn],
    composer,
    h('div', { class: 'kpis' }, kpi('Waiting', d.counts.waiting), kpi('Invited', d.counts.invited), kpi('Last 7 days', d.counts.last7), kpi('Total', d.counts.total)),
    h('div', { class: 'row', style: 'justify-content:space-between;margin-bottom:.5rem' }, tabs, search),
    table,
    h('div', { class: 'row', style: 'margin-top:1rem' },
      pageNo > 1 ? h('button', { class: 'btn btn--ghost btn--sm', onclick: () => go({ page: pageNo - 1 }) }, 'Newer') : null,
      d.more ? h('button', { class: 'btn btn--ghost btn--sm', onclick: () => go({ page: pageNo + 1 }) }, 'Older') : null));
}
