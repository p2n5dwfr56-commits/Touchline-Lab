'use strict';
/* =====================================================================
   Opponents tab: record against each club
   This season comes from the loaded results; all-time records come from
   FBref's "Records vs Opponents" table when it has been pasted in.
   ===================================================================== */

function seasonVs(T) {
  // Results (including fixtures without detail) grouped by opponent
  const out = {};
  (DB.results || DB.matches).filter((m) => m.home === T || m.away === T).forEach((m) => {
    const O = oppOf(m, T), r = (out[O] = out[O] || { p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, xg: 0, xga: 0, xgN: 0, matches: [] });
    const gf = goalsFor(m, T), ga = goalsAg(m, T);
    r.p++; r.gf += gf; r.ga += ga;
    if (gf > ga) r.w++; else if (gf === ga) r.d++; else r.l++;
    const s = m.ts && m.ts[T];
    if (s && has(s.xg) && has(s.xga)) { r.xg += s.xg; r.xga += s.xga; r.xgN++; }
    r.matches.push(m);
  });
  return out;
}
function wdlBar(w, d, l) {
  const n = w + d + l;
  if (!n) return h('div', { class: 'wdl empty' });
  const seg = (v, cls, label) => {
    const el = h('div', { class: cls, style: { width: (100 * v) / n + '%' }, tabindex: 0 });
    hover(el, () => [{ v: v + ' ' + label, strong: true }, { v: ((100 * v) / n).toFixed(0) + '% of ' + n + ' matches' }]);
    return el;
  };
  return h('div', { class: 'wdl', role: 'img', 'aria-label': `${w} wins, ${d} draws, ${l} losses` }, seg(w, 'W', w === 1 ? 'win' : 'wins'), seg(d, 'D', d === 1 ? 'draw' : 'draws'), seg(l, 'L', l === 1 ? 'loss' : 'losses'));
}

function viewOpponents(el) {
  const T = S.team;
  const season = seasonVs(T);
  const recs = (DB.records && DB.records[T]) || [];
  const today = new Date().toISOString().slice(0, 10);
  const upcoming = ((DB.fixtures && DB.fixtures[T]) || []).filter((f) => f.date >= today);
  const table = leagueTable(DB, null);
  const pos = Object.fromEntries(table.map((r) => [r.team.id, r]));

  // One row per opponent: league clubs, plus every club in the all-time records when asked
  const rows = {};
  const keyOf = (id, name) => id || 'name:' + fbTeamKey(name);
  DB.teams.filter((t) => t.id !== T).forEach((t) => (rows[t.id] = { key: t.id, id: t.id, name: t.name }));
  recs.forEach((r) => {
    const k = keyOf(r.oppId, r.name);
    if (!rows[k]) { if (S.oppScope !== 'all') return; rows[k] = { key: k, id: null, name: r.name }; }
    rows[k].all = r;
  });
  Object.values(rows).forEach((r) => {
    if (r.id) r.season = season[r.id];
    r.next = upcoming.find((f) => (r.id ? f.oppId === r.id : fbTeamKey(f.opp) === fbTeamKey(r.name)));
  });
  let list = Object.values(rows);
  const pct = (r) => { const a = r.all || null, s = r.season; if (a && a.mp) return (a.w + a.d / 2) / a.mp; if (s && s.p) return (s.w + s.d / 2) / s.p; return -1; };
  const sorts = {
    next: (a, b) => (a.next ? a.next.date : '9999').localeCompare(b.next ? b.next.date : '9999') || a.name.localeCompare(b.name),
    name: (a, b) => a.name.localeCompare(b.name),
    best: (a, b) => pct(b) - pct(a) || a.name.localeCompare(b.name),
    worst: (a, b) => pct(a) - pct(b) || a.name.localeCompare(b.name),
    played: (a, b) => ((b.all && b.all.mp) || 0) - ((a.all && a.all.mp) || 0) || a.name.localeCompare(b.name),
  };
  list.sort(sorts[S.oppSort] || sorts.next);

  if (!S.opp || !rows[S.opp]) S.opp = (list.find((r) => r.next) || list[0] || {}).key || null;
  el.append(h('div', { class: 'hero' }, h('h1', { text: teamName(T) }), h('div', { class: 'meta' }, h('span', { text: 'Record against each opponent' }))));
  const grid = h('div', { class: 'grid' });
  el.append(grid);
  if (S.opp) grid.append(matchupCard(T, rows[S.opp], pos));

  // The table
  const hasAll = recs.length > 0, hasXg = Object.values(season).some((s) => s.xgN);
  const tools = h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } },
    seg([['next', 'Next up'], ['best', 'Best record'], ['worst', 'Worst record'], ['name', 'A–Z']].concat(hasAll ? [['played', 'Most played']] : []), S.oppSort, (v) => { S.oppSort = v; render(); }, 'Sort'),
    hasAll ? seg([['league', 'League clubs'], ['all', 'All clubs']], S.oppScope, (v) => { S.oppScope = v; render(); }, 'Clubs') : null);
  const th = (t, cls, title) => h('th', { class: cls || '', title: title || null, text: t });
  const t = h('table', { class: 'opp-table' },
    h('thead', null,
      h('tr', null, th('', 'l'), h('th', { colspan: hasXg ? 6 : 5, class: 'grp', text: 'This season' }), hasAll ? h('th', { colspan: 6, class: 'grp', text: 'All-time' }) : null, th('')),
      h('tr', null, th('Opponent', 'l'), th('P'), th('W-D-L'), th('GF-GA'), th('Pts'), hasXg ? th('xGD', '', 'xG for minus xG against') : null, th('Pos', '', 'Opponent’s league position'),
        hasAll ? [th('P'), th('W'), th('D'), th('L'), th('Win %', '', 'Wins as a share of matches played'), th('Record', 'l')] : null, th('Next', 'l'))),
    h('tbody', null, list.map((r) => {
      const s = r.season, a = r.all, p = r.id && pos[r.id];
      return h('tr', { class: r.key === S.opp ? 'focus' : '', onclick: () => { S.opp = r.key; render(); window.scrollTo({ top: 0, behavior: 'smooth' }); } },
        h('td', { class: 'l' }, r.name),
        h('td', { text: s ? s.p : '–' }), h('td', { text: s ? `${s.w}-${s.d}-${s.l}` : '–' }), h('td', { text: s ? `${s.gf}-${s.ga}` : '–' }), h('td', { text: s ? 3 * s.w + s.d : '–' }),
        hasXg ? h('td', { text: s && s.xgN ? signed(s.xg - s.xga) : '–' }) : null,
        h('td', { class: 'sub', text: p ? ordinal(p.pos) : '' }),
        hasAll ? (a ? [h('td', { text: a.mp }), h('td', { text: fmt(a.w, 0) }), h('td', { text: fmt(a.d, 0) }), h('td', { text: fmt(a.l, 0) }), h('td', { text: has(a.w) ? ((100 * a.w) / a.mp).toFixed(0) + '%' : '–' }), h('td', { class: 'l' }, wdlBar(a.w || 0, a.d || 0, a.l || 0))] : [h('td', { text: '–' }), h('td'), h('td'), h('td'), h('td'), h('td')]) : null,
        h('td', { class: 'l sub', text: r.next ? fmtDate(r.next.date) + ' · ' + (r.next.home ? 'H' : 'A') : '' }));
    })));
  grid.append(card({ title: 'Head-to-head records', span: true, tools }, `${teamName(T)} against every ${S.oppScope === 'all' ? 'club played' : 'club in this league'} · click a row for the full matchup`,
    h('div', { class: 'tbl-wrap' }, t),
    legend([['Win', css('--good')], ['Draw', css('--muted')], ['Loss', css('--bad')]]),
    hasAll ? h('p', { class: 'note', text: 'All-time figures: FBref.com. This season: ' + DB.label + '.' }) : recordsHint(T)));
}

function recordsHint(T) {
  if (DB.source === 'demo') return h('p', { class: 'note', text: 'This is the synthetic demo season. Load a real season and paste FBref’s Records vs Opponents table in the Data tab to see all-time head-to-head records.' });
  const p = h('p', { class: 'note' }, 'For all-time records, open the team’s ',
    h('a', { href: 'https://fbref.com/en/squads/8bbab7cf/history/vs_opp/Aberdeen-Records-vs-Opponents', target: '_blank', rel: 'noopener', text: 'Records vs Opponents page on FBref' }),
    ', use Share & Export → Get table as CSV, and paste it into the FBref box in the Data tab with ' + teamName(T) + ' selected.');
  return p;
}

function matchupCard(T, r, pos) {
  const A = css('--team-a'), B = css('--team-b');
  const s = r.season, a = r.all, p = r.id && pos[r.id];
  const wrap = h('div', { class: 'grid three' });
  // Next meeting and current form
  const next = h('div', null, h('div', { class: 'eyebrow', style: { marginBottom: '6px' }, text: 'Next meeting' }));
  if (r.next) {
    next.append(h('div', { class: 'statline' },
      h('div', null, h('b', { text: fmtDate(r.next.date) }), h('span', { text: (r.next.time ? r.next.time + ' · ' : '') + (r.next.home ? 'Home' : 'Away') })),
      h('div', null, h('b', { text: r.next.comp || '–' }), h('span', { text: 'Competition' }))));
  } else next.append(h('p', { class: 'sub', style: { marginTop: 0 }, text: DB.fixtures && DB.fixtures[T] ? 'No more meetings in the fixture list.' : 'Paste FBref’s Scores & Fixtures table in the Data tab to see upcoming meetings.' }));
  if (p) {
    const form = (DB.results || DB.matches).filter((m) => m.home === r.id || m.away === r.id).slice(-5).map((m) => result(m, r.id));
    next.append(h('div', { class: 'eyebrow', style: { margin: '10px 0 6px' }, text: r.name + ' now' }),
      h('div', { class: 'meta', style: { display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' } },
        h('span', { text: `${ordinal(p.pos)} · ${p.a.pts} pts` }), h('span', { class: 'form', 'aria-label': 'Last five results' }, form.map((x) => h('span', { class: x, text: x })))));
    next.append(h('div', { style: { marginTop: '12px' } }, h('button', { class: 'btn ghost', type: 'button', text: `Compare ${teamName(T)} and ${r.name}`, onclick: () => { S.cmp = r.id; S.cmpMode = 'teams'; S.tab = 'compare'; render(); window.scrollTo({ top: 0 }); } })));
  }
  wrap.append(next);

  // This season's meetings
  const ms = s ? s.matches : [];
  wrap.append(h('div', null, h('div', { class: 'eyebrow', style: { marginBottom: '6px' }, text: 'This season' + (s ? ` · ${s.w}W ${s.d}D ${s.l}L` : '') }),
    ms.length ? h('div', { class: 'mlist' }, ms.map((m) => {
      const res = result(m, T), st = m.ts && m.ts[T];
      return h('button', { type: 'button', class: 'mrow', onclick: () => { S.tab = 'matches'; S.match = m.id; render(); window.scrollTo({ top: 0 }); }, title: 'Open the match report' },
        h('span', { class: 'd', text: fmtDate(m.date) }), h('span', { class: 'res ' + res, text: res }), h('span', null, m.home === T ? 'Home' : 'Away'),
        h('span', { class: 'score', text: goalsFor(m, T) + '–' + goalsAg(m, T) }), h('span', { class: 'xg', text: st && has(st.xg) ? st.xg.toFixed(1) + ' – ' + st.xga.toFixed(1) + ' xG' : '' }));
    })) : h('p', { class: 'sub', style: { marginTop: 0 }, text: r.id ? 'Not played yet this season.' : 'Not in this season’s league.' })));

  // All-time
  const all = h('div', null, h('div', { class: 'eyebrow', style: { marginBottom: '6px' }, text: 'All-time' }));
  if (a) {
    const bar = wdlBar(a.w || 0, a.d || 0, a.l || 0);
    bar.classList.add('wide');
    all.append(h('div', { class: 'statline' }, [[a.mp, 'Played'], [fmt(a.w, 0), 'Won'], [fmt(a.d, 0), 'Drawn'], [fmt(a.l, 0), 'Lost']].concat(has(a.gf) ? [[`${a.gf}–${a.ga}`, 'Goals']] : []).map(([v, l]) => h('div', null, h('b', { text: v }), h('span', { text: l })))),
      bar,
      h('p', { class: 'note', text: has(a.w) ? `${teamName(T)} win ${((100 * a.w) / a.mp).toFixed(0)}% of meetings and lose ${((100 * a.l) / a.mp).toFixed(0)}%.` : '' }));
  } else all.append(h('p', { class: 'sub', style: { marginTop: 0 }, text: (DB.records && DB.records[T]) ? 'No all-time record for this club in the FBref table.' : 'Paste FBref’s Records vs Opponents table in the Data tab to see the all-time record.' }));
  wrap.append(all);

  return card({ title: `${teamName(T)} v ${r.name}`, span: true }, p ? `${r.name} are ${ordinal(p.pos)} in the league` : 'Head-to-head', wrap);
}
