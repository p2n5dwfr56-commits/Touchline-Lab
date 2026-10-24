'use strict';
/* =====================================================================
   Opponents tab: record against each club
   This season comes from the loaded results; all-time records come from
   FBref's "Records vs Opponents" table when it has been pasted in.
   ===================================================================== */

function seasonVs(T) {
  // Results (including fixtures without detail) grouped by opponent
  const out = {};
  // League results and cup ties, following the Competition filter
  const league = S.comp === 'cups' ? [] : (DB.results || DB.matches).filter((m) => m.home === T || m.away === T);
  const cups = S.comp === 'league' ? [] : (DB.cups || []).filter((m) => m.home === T || m.away === T);
  league.concat(cups).sort((a, b) => (a.date || '').localeCompare(b.date || '')).forEach((m) => {
    const O = oppOf(m, T), r = (out[O] = out[O] || { p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, xg: 0, xga: 0, xgN: 0, matches: [] });
    const gf = goalsFor(m, T), ga = goalsAg(m, T), res = result(m, T);
    r.p++; r.gf += gf; r.ga += ga;
    if (res === 'W') r.w++; else if (res === 'D') r.d++; else r.l++;
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
  // Cup opponents from outside the league
  Object.keys(season).forEach((id) => { if (!rows[id] && DB.teamById[id]) rows[id] = { key: id, id, name: teamName(id), nonLeague: true }; });
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
  if (S.opp) { const hc = h2hCard(T, rows[S.opp]); if (hc) grid.append(hc); }

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
        h('td', { class: 'l sub', text: r.next ? fmtDate(r.next.date) + ' · ' + (r.next.venue || (r.next.home ? 'H' : 'A')) + (r.next.round ? ' · ' + compShort(r.next.comp) + ' ' + roundShort(r.next.round) : '') : '' }));
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
      h('div', null, h('b', { text: fmtDate(r.next.date) }), h('span', { text: (r.next.time ? r.next.time + ' · ' : '') + (r.next.venue === 'N' ? 'Neutral venue' : r.next.home ? 'Home' : 'Away') })),
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
        h('span', { class: 'd', text: fmtDate(m.date) + (m.cup ? ' · ' + roundLabel(m) : '') }), h('span', { class: 'res ' + res, text: res }), h('span', null, m.neutral ? 'Neutral' : m.home === T ? 'Home' : 'Away'),
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

/* ---------- Head-to-head history: every loaded season ---------- */
// Every meeting with one club across the loaded seasons: league games (football-data, 1994/95 on) and cup ties
function h2hMeetings(teamKey, oppKey) {
  return memo('h2h|' + teamKey + '|' + oppKey + '|' + allSeasons().length + '|' + (SEASONS.real ? SEASONS.real.matches.length + '|' + (SEASONS.real.cups || []).length : 0), () => {
    const out = [];
    allSeasons().forEach((x) => {
      const db = x.current ? SEASONS.real || x.db : x.db || seasonDB(x.season);
      if (!db || !db.matches) return;
      const find = (k) => db.teams.find((t) => fbTeamKey(t.name) === k) || Object.values(db.teamById || {}).find((t) => fbTeamKey(t.name) === k);
      const Tt = find(teamKey), Ot = find(oppKey);
      if (!Tt || !Ot) return;
      db.matches.concat(db.cups || []).forEach((m) => { if ([m.home, m.away].includes(Tt.id) && [m.home, m.away].includes(Ot.id)) out.push({ season: x.season, m, T: Tt.id, O: Ot.id }); });
    });
    return out.sort((a, b) => (a.m.date || '').localeCompare(b.m.date || ''));
  });
}

function h2hCard(T, r) {
  if (!r) return null;
  const all = h2hMeetings(fbTeamKey(teamName(T)), fbTeamKey(r.name));
  if (!all.length) return null;
  const A = css('--team-a'), B = css('--team-b');
  const seasons = [...new Set(all.map((x) => x.season))].sort().reverse();
  const spans = [['all', 'All']].concat([20, 10, 5].filter((n) => seasons.length > n).map((n) => [String(n), 'Last ' + n + ' seasons']));
  const span = spans.some(([v]) => v === S.h2hSpan) ? S.h2hSpan : 'all';
  const from = span === 'all' ? seasons[seasons.length - 1] : seasons[+span - 1];
  const venue = S.h2hVenue || 'all', comp = S.h2hComp || 'all';
  const hasCupsH = all.some((x) => x.m.cup);
  const L = all.filter((x) => x.season >= from && (venue === 'all' || (venue === 'home' ? !x.m.neutral && x.m.home === x.T : venue === 'away' ? !x.m.neutral && x.m.away === x.T : x.m.neutral)) && (comp === 'all' || (comp === 'cups') === !!x.m.cup));
  const rerender = () => { const y = window.scrollY; render(); window.scrollTo(0, y); };
  const tools = h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } },
    seg(spans, span, (v) => { S.h2hSpan = v; rerender(); }, 'Period'),
    seg([['all', 'Home & away'], ['home', 'Home'], ['away', 'Away']].concat(all.some((x) => x.m.neutral) ? [['neutral', 'Neutral']] : []), venue, (v) => { S.h2hVenue = v; rerender(); }, 'Venue'),
    hasCupsH ? seg([['all', 'All'], ['league', 'League'], ['cups', 'Cups']], comp, (v) => { S.h2hComp = v; rerender(); }, 'Competition') : null);
  const sub = `${L.length} meeting${L.length === 1 ? '' : 's'} · ${from} to ${seasons[0]}` + (venue !== 'all' ? ' · ' + venue : '') + (comp !== 'all' ? ' · ' + comp + ' only' : '');
  const wrap = h('div');
  if (!L.length) { wrap.append(h('p', { class: 'sub', text: 'No meetings for this choice.' })); return card({ title: `${teamName(T)} v ${r.name}: head-to-head history`, span: true, tools }, sub, wrap); }

  const res = L.map((x) => result(x.m, x.T)), n = L.length;
  const w = res.filter((v) => v === 'W').length, d = res.filter((v) => v === 'D').length, l = n - w - d;
  const gf = L.reduce((t, x) => t + goalsFor(x.m, x.T), 0), ga = L.reduce((t, x) => t + goalsAg(x.m, x.T), 0);
  const pc = (v) => Math.round((100 * v) / n) + '%';
  const margin = (x) => goalsFor(x.m, x.T) - goalsAg(x.m, x.T);
  const big = L.slice().sort((a, b) => margin(b) - margin(a) || goalsFor(b.m, b.T) - goalsFor(a.m, a.T))[0], worst = L.slice().sort((a, b) => margin(a) - margin(b) || goalsAg(b.m, b.T) - goalsAg(a.m, a.T))[0];
  const tie = (x) => `${goalsFor(x.m, x.T)}–${goalsAg(x.m, x.T)} ${x.m.neutral ? '(N)' : x.m.home === x.T ? '(H)' : '(A)'}, ${x.season}`;
  const stat = (items) => h('div', { class: 'statline' }, items.map(([v, lab]) => h('div', null, h('b', { text: v }), h('span', { text: lab }))));
  const bar = wdlBar(w, d, l); bar.classList.add('wide');
  wrap.append(stat([[n, 'Played'], [`${w} · ${pc(w)}`, 'Won'], [`${d} · ${pc(d)}`, 'Drawn'], [`${l} · ${pc(l)}`, 'Lost'], [`${gf}–${ga}`, 'Goals'], [`${(gf / n).toFixed(2)} – ${(ga / n).toFixed(2)}`, 'Goals per game']]), bar);
  const cs = L.filter((x) => goalsAg(x.m, x.T) === 0).length, fts = L.filter((x) => goalsFor(x.m, x.T) === 0).length;
  wrap.append(stat([[pc(cs), 'Clean sheets'], [pc(fts), 'Failed to score'], [margin(big) > 0 ? tie(big) : '–', 'Biggest win'], [margin(worst) < 0 ? tie(worst) : '–', 'Heaviest defeat']]));

  const grid = h('div', { class: 'grid', style: { marginTop: '14px' } });
  wrap.append(grid);
  // Results in order, oldest first
  const strip = h('div', { class: 'h2h-strip', role: 'img', 'aria-label': 'Results in order' }, L.map((x, i) => {
    const el = h('span', { class: res[i], tabindex: 0 });
    hover(el, () => [{ v: `${fmtDate(x.m.date)} ${String(x.m.date).slice(0, 4)} · ${x.m.cup ? roundLabel(x.m) : 'League'}`, strong: true }, { v: `${teamName(x.T)} ${goalsFor(x.m, x.T)}–${goalsAg(x.m, x.T)} ${r.name} (${x.m.neutral ? 'neutral' : x.m.home === x.T ? 'home' : 'away'})` + (x.m.pens ? ' · pens' : '') }]);
    return el;
  }));
  grid.append(h('div', { class: 'span' }, h('div', { class: 'eyebrow', style: { marginBottom: '6px' }, text: 'Every result, oldest first' }), strip));

  // Goal timing: when goals were scored and conceded in these meetings
  const tm = L.filter((x) => timedMatch(x.m));
  const W6 = G_WIN.slice(0, 6), cnt = W6.map(() => ({ f: 0, a: 0 }));
  let fAll = 0, aAll = 0;
  tm.forEach((x) => matchGoals(x.m).forEach((g) => { const mine = g.team === x.T; if (mine) fAll++; else aAll++; const k = W6.findIndex((wn) => inWin(g.bm, wn)); if (k >= 0) cnt[k][mine ? 'f' : 'a']++; }));
  const tbox = h('div', null, h('div', { class: 'eyebrow', style: { marginBottom: '6px' }, text: 'When the goals came' }));
  if (tm.length && fAll + aAll) {
    const Wd = 520, Hh = 170, m0 = { l: 26, r: 8, t: 20, b: 24 }, mx = Math.max(1, ...cnt.flatMap((c) => [c.f, c.a]));
    const svg = sv('svg', { viewBox: `0 0 ${Wd} ${Hh}`, width: '100%', role: 'img', 'aria-label': 'Goals by 15-minute period' });
    const bw = (Wd - m0.l - m0.r) / 6, Y = (v) => m0.t + (Hh - m0.t - m0.b) * (1 - v / mx);
    const ax = sv('g', { class: 'axis' });
    ax.append(sv('line', { x1: m0.l, x2: Wd - m0.r, y1: Y(0), y2: Y(0), class: 'baseline' }));
    W6.forEach((wn, i) => ax.append(sv('text', { x: m0.l + bw * i + bw / 2, y: Hh - 6, 'text-anchor': 'middle', text: wn[1] })));
    svg.append(ax);
    cnt.forEach((c, i) => [['f', A, 0], ['a', B, 1]].forEach(([k, col, j]) => {
      const x0 = m0.l + bw * i + bw * 0.14 + j * bw * 0.37, v = c[k];
      const rct = sv('rect', { x: x0, y: Y(v), width: bw * 0.34, height: Math.max(0, Y(0) - Y(v)), fill: col, rx: 2, tabindex: 0 });
      hover(rct, () => [{ v: W6[i][1], strong: true }, { color: col, v: `${v} ${k === 'f' ? 'scored' : 'conceded'}`, l: (k === 'f' ? fAll : aAll) ? Math.round((100 * v) / (k === 'f' ? fAll : aAll)) + '% of ' + (k === 'f' ? 'goals scored' : 'goals conceded') : '' }]);
      svg.append(rct);
      if (v) svg.append(sv('text', { x: x0 + bw * 0.17, y: Y(v) - 3, 'text-anchor': 'middle', class: 'bar-val', text: v }));
    }));
    const late = cnt[5], lastA = aAll ? Math.round((100 * late.a) / aAll) : null, lastF = fAll ? Math.round((100 * late.f) / fAll) : null;
    tbox.append(svg, legend([['Scored', A], ['Conceded', B]]),
      h('p', { class: 'note', text: `From the ${tm.length} meeting${tm.length === 1 ? '' : 's'} with goal times (of ${n}): Sportmonks line-ups from 2023/24 and Wikipedia match reports.` + (lastA != null ? ` ${lastA}% of goals conceded came after 75 minutes` : '') + (lastF != null ? `, and ${lastF}% of goals scored.` : '.') }));
  } else tbox.append(h('p', { class: 'sub', style: { marginTop: 0 }, text: 'No goal times for these meetings yet: they come from Sportmonks (2023/24 on) and Wikipedia match reports.' }));
  grid.append(tbox);

  // Discipline
  const card2 = L.filter((x) => x.m.ts && x.m.ts[x.T] && has(x.m.ts[x.T].yc));
  const dbox = h('div', null, h('div', { class: 'eyebrow', style: { marginBottom: '6px' }, text: 'Discipline' }));
  if (card2.length) {
    const sum = (side, k) => card2.reduce((t, x) => t + (has(x.m.ts[side === 'T' ? x.T : x.O] && x.m.ts[side === 'T' ? x.T : x.O][k]) ? x.m.ts[side === 'T' ? x.T : x.O][k] : 0), 0);
    const rcN = card2.filter((x) => has(x.m.ts[x.T].rc)).length;
    const k = card2.length;
    dbox.append(h('table', { class: 'h2h-disc' }, h('thead', null, h('tr', null, h('th', { class: 'l', text: '' }), h('th', { text: teamName(T) }), h('th', { text: r.name }))),
      h('tbody', null,
        h('tr', null, h('td', { class: 'l', text: 'Yellow cards per game' }), h('td', { text: (sum('T', 'yc') / k).toFixed(2) }), h('td', { text: (sum('O', 'yc') / k).toFixed(2) })),
        rcN ? h('tr', null, h('td', { class: 'l', text: 'Red cards' }), h('td', { text: sum('T', 'rc') + ' (' + (sum('T', 'rc') / rcN).toFixed(2) + ' a game)' }), h('td', { text: sum('O', 'rc') + ' (' + (sum('O', 'rc') / rcN).toFixed(2) + ' a game)' })) : null,
        h('tr', null, h('td', { class: 'l', text: 'Fouls per game' }), h('td', { text: has(card2[0].m.ts[card2[0].T].fls) ? (sum('T', 'fls') / k).toFixed(1) : '–' }), h('td', { text: has(card2[0].m.ts[card2[0].O].fls) ? (sum('O', 'fls') / k).toFixed(1) : '–' })))),
      h('p', { class: 'note', text: `From the ${k} meeting${k === 1 ? '' : 's'} with card counts (of ${n}; football-data.co.uk records cards from 2000/01).` }));
  } else dbox.append(h('p', { class: 'sub', style: { marginTop: 0 }, text: 'No card counts for these meetings (football-data.co.uk records them from 2000/01).' }));
  grid.append(dbox);

  // The meetings, newest first
  const list = h('div', { class: 'mlist h2h-list' }, L.slice().reverse().map((x, i) => {
    const rr = result(x.m, x.T);
    return h('button', { type: 'button', class: 'mrow', title: 'Open the match report', onclick: () => { if (x.season === DB.season || loadSeason(x.season)) { S.tab = 'matches'; S.match = x.m.id; if (x.m.cup && S.comp === 'league') S.comp = 'all'; render(); window.scrollTo({ top: 0 }); } } },
      h('span', { class: 'd', text: fmtDate(x.m.date) + ' ' + String(x.m.date).slice(0, 4) + ' · ' + (x.m.cup ? roundLabel(x.m) : 'League') }), h('span', { class: 'res ' + rr, text: rr }),
      h('span', null, x.m.neutral ? 'Neutral' : x.m.home === x.T ? 'Home' : 'Away'), h('span', { class: 'score', text: goalsFor(x.m, x.T) + '–' + goalsAg(x.m, x.T) + (x.m.pens ? ' p' : '') }), h('span', { class: 'xg', text: x.season }));
  }));
  wrap.append(h('div', { class: 'eyebrow', style: { margin: '16px 0 6px' }, text: 'Meetings, newest first' }), list,
    h('p', { class: 'note', text: 'Match-by-match results start in 1994/95 (football-data.co.uk league files); cup ties come from Wikipedia and Sportmonks where loaded. Older meetings are in the all-time record above when FBref’s Records vs Opponents table is pasted.' }));
  return card({ title: `${teamName(T)} v ${r.name}: head-to-head history`, span: true, tools }, sub, wrap);
}
