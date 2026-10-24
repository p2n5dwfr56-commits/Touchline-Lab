'use strict';
/* =====================================================================
   Matchday: food and drink prices at the ground (Aberdeen publishes its
   kiosk menu; other clubs mostly don't). Kept live in the artifact's
   shared store (`db`): matchday/menu holds the current list and
   matchday/history the dated price changes. The owner and editors can
   change prices from the page; everyone else reads them.
   ===================================================================== */

const MD = { db: null, state: 'idle', menu: null, history: null, editing: false, err: '', canWrite: null, unsub: [], menus: {}, hists: {}, idx: [], subs: new Set(), key: 'aberdeen' };
// Each club's menu and price history: Aberdeen's in the original documents, every other club in its own,
// listed in matchday/clubs
const mdPaths = (key) => (key === 'aberdeen' ? { menu: 'matchday/menu', hist: 'matchday/history' } : { menu: 'matchday/menu-' + key, hist: 'matchday/history-' + key });
function mdWatch(key) {
  if (!MD.db || MD.subs.has(key)) return;
  MD.subs.add(key);
  const P = mdPaths(key), again = () => { if (S.tab === 'matchday') render(); };
  MD.unsub.push(MD.db.doc(P.menu).onSnapshot((s) => { MD.menus[key] = s.exists ? s.data() : null; again(); }, () => { if (key === 'aberdeen') { MD.state = 'none'; again(); } }));
  MD.unsub.push(MD.db.doc(P.hist).onSnapshot((s) => { MD.hists[key] = s.exists ? s.data() : null; again(); }, () => {}));
}
const mdKnown = () => ['aberdeen'].concat(MD.idx.map((c) => c.key).filter((k) => k !== 'aberdeen'));
function mdClubKey() {
  const known = mdKnown(), team = fbTeamKey(teamName(S.team));
  if (S.mdClub && known.includes(S.mdClub)) return S.mdClub;
  return known.includes(team) ? team : 'aberdeen';
}
const MD_CATS = ['Food', 'Hot drinks', 'Cold drinks', 'Snacks', 'Other'];
const pounds = (p) => (Number.isFinite(p) ? '£' + (p / 100).toFixed(2) : '–');
const toPence = (s) => { const v = parseFloat(String(s).replace(/[£\s]/g, '')); return Number.isFinite(v) && v >= 0 && v < 1000 ? Math.round(v * 100) : null; };

function mdInit() {
  if (MD.state !== 'idle') return;
  if (!(window.claude && window.claude.use)) { MD.state = 'none'; return; }
  MD.state = 'pending';
  const fail = () => { MD.state = 'none'; if (S.tab === 'matchday') render(); };
  try {
    window.claude.use('db').then(async (db) => {
      if (!db) return fail();
      MD.db = db;
      MD.state = 'ready';
      try { const u = await window.claude.use('user'); MD.canWrite = u ? await u.can('data.write') : null; if (MD.canWrite == null && u) MD.canWrite = (await u.canEdit()) || null; } catch (e) { MD.canWrite = null; }
      // Subscribe once, for the life of the page
      mdWatch('aberdeen');
      MD.unsub.push(db.doc('matchday/clubs').onSnapshot((s) => { MD.idx = (s.exists && s.data().clubs) || []; MD.idx.forEach((c) => mdWatch(c.key)); if (S.tab === 'matchday') render(); }, () => {}));
      if (S.tab === 'matchday') render();
    }, fail);
  } catch (e) { fail(); }
}

async function mdSave(items, meta) {
  const old = (MD.menu && MD.menu.items) || [];
  const now = new Date().toISOString();
  const changes = [];
  items.forEach((it) => {
    const was = old.find((o) => o.id === it.id);
    if (!was) changes.push({ at: now, item: it.name, from: null, to: it.price });
    else if (was.price !== it.price) changes.push({ at: now, item: it.name, from: was.price, to: it.price });
  });
  old.forEach((o) => { if (!items.some((it) => it.id === o.id)) changes.push({ at: now, item: o.name, from: o.price, to: null }); });
  const body = { ...(MD.menu || {}), ...meta, items, updatedAt: now };
  const P = mdPaths(MD.key);
  await MD.db.doc(P.menu).set(body);
  if (changes.length) {
    const prev = (MD.history && MD.history.changes) || [];
    await MD.db.doc(P.hist).set({ changes: prev.concat(changes).slice(-500) });
  }
  // A new club joins the list of clubs with menus
  if (MD.key !== 'aberdeen' && !MD.idx.some((c) => c.key === MD.key)) await MD.db.doc('matchday/clubs').set({ clubs: MD.idx.concat({ key: MD.key, club: body.club || MD.key, ground: body.ground || '' }) });
}

function viewMatchday(el) {
  mdInit();
  // The club shown: picked here, else the team at the top if it has a menu, else Aberdeen
  MD.key = mdClubKey();
  MD.menu = MD.menus[MD.key] || null; MD.history = MD.hists[MD.key] || null;
  const club = MD.menu && MD.menu.club ? MD.menu.club : MD.key === 'aberdeen' ? 'Aberdeen' : (MD.idx.find((c) => c.key === MD.key) || {}).club || teamName(S.team);
  const known = mdKnown();
  const picker = known.length > 1 ? h('select', { 'aria-label': 'Club', onchange: (e) => { S.mdClub = e.target.value; MD.editing = false; render(); } },
    known.map((k) => h('option', { value: k, selected: k === MD.key, text: (MD.menus[k] && MD.menus[k].club) || (MD.idx.find((c) => c.key === k) || {}).club || k }))) : null;
  el.append(h('div', { class: 'hero' }, h('h1', { text: 'Matchday' }), h('div', { class: 'meta' }, h('span', { text: 'Food and drink prices at ' + ((MD.menu && MD.menu.ground) || club) }), picker)));
  if (MD.state === 'pending') { el.append(card({ title: 'Matchday prices', span: true }, null, h('p', { class: 'note', style: { marginTop: 0 }, text: 'Loading the latest prices…' }))); return; }
  if (MD.state === 'none') { el.append(card({ title: 'Matchday prices', span: true }, null, h('p', { class: 'note', style: { marginTop: 0 }, text: 'The price list is kept live on claude.ai. Open this page there (or in the Claude app) to see it.' }))); return; }
  const m = MD.menu;
  const items = ((m && m.items) || []).slice();
  if (!items.length && !MD.editing) {
    el.append(card({ title: 'Matchday prices', span: true }, null, h('p', { class: 'note', style: { marginTop: 0 }, text: 'No prices yet.' }),
      MD.canWrite !== false ? h('button', { class: 'btn', type: 'button', text: 'Add prices', onclick: () => { MD.editing = true; render(); } }) : null));
    return;
  }
  const grid = h('div', { class: 'grid' });
  el.append(grid);
  const byCat = (list) => MD_CATS.map((c) => [c, list.filter((it) => (MD_CATS.includes(it.category) ? it.category : 'Other') === c)]).filter(([, l]) => l.length);
  const when = m && m.updatedAt ? new Date(m.updatedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
  const checked = m && m.checkedAt ? new Date(m.checkedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '';

  if (MD.editing) { grid.append(mdEditor(items, m, club)); return; }

  // The menu
  const hist = (MD.history && MD.history.changes) || [];
  const lastChange = (name) => hist.slice().reverse().find((c) => c.item === name && c.from != null && c.to != null);
  const menuCard = card({ title: club + ' matchday menu', span: true, tools: MD.canWrite !== false ? h('button', { class: 'btn ghost', type: 'button', text: 'Edit prices', onclick: () => { MD.editing = true; MD.err = ''; render(); } }) : null },
    `${m && m.source ? m.source : ''}${when ? ' · updated ' + when : ''}`,
    h('div', { class: 'md-cats' }, byCat(items).map(([c, list]) => h('div', null, h('div', { class: 'eyebrow', style: { marginBottom: '6px' }, text: c }),
      h('table', { class: 'md-table' }, h('tbody', null, list.map((it) => { const ch = lastChange(it.name); return h('tr', { style: { cursor: 'default' } }, h('td', { class: 'l', text: it.name }),
        h('td', null, h('b', { text: pounds(it.price) }), ch ? h('span', { class: 'sub', title: `Was ${pounds(ch.from)} until ${new Date(ch.at).toLocaleDateString('en-GB')}`, text: ` ${ch.to > ch.from ? '▲' : '▼'} ${pounds(Math.abs(ch.to - ch.from))}` }) : null)); })))))),
    h('p', { class: 'note', text: (m && m.checkedAt ? `Checked against the club’s published menu on ${checked}.` : 'Not yet checked against the club’s own website.') + (m && m.note ? ' ' + m.note : '') }));
  grid.append(menuCard);

  // A few useful sums
  const find = (re) => items.find((it) => re.test(it.name));
  const pie = find(/^(pittodrie|scotch|mince)?\s*pie$/i) || find(/pie/i), bov = find(/bovril/i), tea = find(/\b(tea|coffee)\b/i), water = find(/water/i);
  const combos = [
    pie && bov ? ['A pie and a Bovril', pie.price + bov.price, `${pie.name} + ${bov.name}`] : null,
    pie && tea && tea !== bov ? ['A pie and a tea', pie.price + tea.price, `${pie.name} + ${tea.name}`] : null,
    pie && water ? ['A pie and a water', pie.price + water.price, `${pie.name} + ${water.name}`] : null,
  ].filter(Boolean);
  if (combos.length) grid.append(card('At half-time', 'What the classics cost', h('div', { class: 'statline' }, combos.map(([l, v, sub]) => h('div', { title: sub }, h('b', { text: pounds(v) }), h('span', { text: l }))))));

  // Price changes
  const real = hist.filter((c) => c.from != null && c.to != null).slice().reverse();
  grid.append(card('Price changes', real.length ? 'Every change made to the list, newest first' : 'Changes will appear here when prices are updated', real.length ? h('div', { class: 'mlist' }, real.slice(0, 30).map((c) => h('div', { class: 'mrow', style: { cursor: 'default', gridTemplateColumns: 'auto 1fr auto' } },
    h('span', { class: 'd', text: new Date(c.at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) }), h('span', { text: c.item }), h('span', { text: `${pounds(c.from)} → ${pounds(c.to)}` })))) : null));
  mdCompare(grid);
}

function mdEditor(items, m, club) {
  let rows = items.length ? items.map((it) => ({ ...it })) : [{ id: 'i' + Date.now(), name: '', price: null, category: 'Food' }];
  const st = h('div', { class: 'status', role: 'status', text: MD.err || '' });
  if (MD.err) st.className = 'status err';
  const body = h('tbody');
  const draw = () => {
    body.replaceChildren(...rows.map((r, i) => h('tr', { style: { cursor: 'default' } },
      h('td', { class: 'l' }, h('input', { type: 'text', value: r.name, 'aria-label': 'Item', placeholder: 'Item', oninput: (e) => { r.name = e.target.value; } })),
      h('td', null, h('input', { type: 'text', inputmode: 'decimal', value: r.price == null ? '' : (r.price / 100).toFixed(2), 'aria-label': 'Price in pounds', placeholder: '0.00', style: { width: '80px' }, oninput: (e) => { r._p = e.target.value; } })),
      h('td', null, h('select', { 'aria-label': 'Category', onchange: (e) => { r.category = e.target.value; } }, MD_CATS.map((c) => h('option', { value: c, selected: (r.category || 'Other') === c, text: c })))),
      h('td', null, h('button', { class: 'btn ghost', type: 'button', style: { padding: '3px 10px' }, text: 'Remove', onclick: () => { rows.splice(i, 1); draw(); } })))));
  };
  draw();
  const source = h('input', { type: 'text', value: (m && m.source) || '', placeholder: 'e.g. Aberdeen FC published menu, 2026', style: { width: '100%' } });
  const checked = h('input', { type: 'checkbox', checked: !!(m && m.checkedAt) });
  const save = async () => {
    const out = [];
    for (const r of rows) {
      const name = String(r.name || '').trim();
      if (!name) continue;
      const p = r._p != null ? toPence(r._p) : r.price;
      if (p == null) { MD.err = `Enter a price for ${name} (e.g. 4.20).`; st.className = 'status err'; st.textContent = MD.err; return; }
      out.push({ id: r.id, name, price: p, category: r.category || 'Other' });
    }
    if (!out.length) { st.className = 'status err'; st.textContent = 'Add at least one item.'; return; }
    st.className = 'status'; st.textContent = 'Saving…';
    try {
      await mdSave(out, { source: source.value.trim(), checkedAt: checked.checked ? (m && m.checkedAt) || new Date().toISOString() : null, club: (m && m.club) || club, ground: (m && m.ground) || '' });
      MD.editing = false; MD.err = ''; render();
    } catch (e) {
      MD.canWrite = e && e.code === 'invalid_argument' ? false : MD.canWrite;
      MD.err = e && e.code === 'invalid_argument' ? 'Only the owner and editors of this page can change the prices.' : e && e.code === 'quota_exceeded' ? 'The page’s storage is full.' : 'Could not save just now. Try again.';
      st.className = 'status err'; st.textContent = MD.err;
    }
  };
  return card({ title: 'Edit prices', span: true }, 'Changes are saved for everyone who opens this page, with a dated record of each price change',
    h('div', { class: 'tbl-wrap' }, h('table', { class: 'md-edit' }, h('thead', null, h('tr', null, ['Item', 'Price (£)', 'Category', ''].map((c, i) => h('th', { class: i === 0 ? 'l' : '', text: c })))), body)),
    h('div', { style: { display: 'flex', gap: '8px', margin: '10px 0', flexWrap: 'wrap' } }, h('button', { class: 'btn ghost', type: 'button', text: 'Add item', onclick: () => { rows.push({ id: 'i' + Date.now() + rows.length, name: '', price: null, category: 'Food' }); draw(); } })),
    h('div', { class: 'field' }, h('label', { text: 'Source' }), source),
    h('label', { style: { display: 'flex', gap: '8px', alignItems: 'center', margin: '10px 0', fontSize: '14px' } }, checked, 'Checked against the club’s own published menu'),
    h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } }, h('button', { class: 'btn', type: 'button', text: 'Save', onclick: save }), h('button', { class: 'btn ghost', type: 'button', text: 'Cancel', onclick: () => { MD.editing = false; MD.err = ''; render(); } })), st);
}

// The same things at each club with a menu: the cheapest price in each row is marked
function mdCompare(grid) {
  const clubs = mdKnown().map((k) => ({ k, m: MD.menus[k] })).filter((c) => c.m && (c.m.items || []).length);
  if (clubs.length < 2) return;
  const ROWS = [['Pie (Scotch or the club’s own)', /^(scotch|pittodrie|mince)\s*pie$|^pie$/i], ['Steak pie', /steak/i], ['Macaroni pie', /macaroni/i], ['Hot dog', /hot ?dog/i], ['Tea', /\btea\b/i], ['Coffee', /coffee/i], ['Bovril', /bovril/i], ['Bottled water', /water/i], ['Cola / soft drink', /coca|coke|soft drink/i], ['Chocolate / sweets', /chocolate(?! hot)|sweets/i]];
  const priceOf = (m, re) => { const it = (m.items || []).filter((x) => re.test(x.name) && !/hot chocolate|meal deal/i.test(x.name)); return it.length ? Math.min(...it.map((x) => x.price)) : null; };
  const rows = ROWS.map(([l, re]) => ({ l, p: clubs.map((c) => priceOf(c.m, re)) })).filter((r) => r.p.filter((v) => v != null).length >= 2);
  if (!rows.length) return;
  grid.append(card({ title: 'Across the clubs', span: true }, 'The same things at each club with a menu here · cheapest in bold', h('div', { class: 'tbl-wrap' }, h('table', null,
    h('thead', null, h('tr', null, h('th', { class: 'l', text: '' }), clubs.map((c) => h('th', { text: c.m.club || c.k })))),
    h('tbody', null, rows.map((r) => { const lo = Math.min(...r.p.filter((v) => v != null));
      return h('tr', { style: { cursor: 'default' } }, h('td', { class: 'l', text: r.l }), r.p.map((v) => h('td', null, v == null ? '–' : v === lo ? h('b', { text: pounds(v) }) : pounds(v)))); })))),
    h('p', { class: 'note', text: 'Where a club lists one price for tea, coffee and Bovril, it counts for each. Matching is by item name, so similar items can differ in size.' })));
}
