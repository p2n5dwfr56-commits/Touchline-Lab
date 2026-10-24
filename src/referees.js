'use strict';
/* =====================================================================
   Ref Watch: cards and results by referee
   A bit of fun, built on the referee named for each league match in the
   football-data.co.uk files (2000/01 on): how many yellows and reds each
   referee shows, how home sides fare, and how your club does with each.
   ===================================================================== */

// "John Rowbotham" and "J Rowbotham" are the same referee: initial and surname
function refKey(name) {
  const w = String(name || '').replace(/[^A-Za-z' .-]/g, ' ').replace(/\./g, ' ').split(/\s+/).filter(Boolean);
  if (!w.length) return '';
  const sur = w.slice(1).join(' ') || w[0];
  return (w.length > 1 ? w[0][0].toUpperCase() + ' ' : '') + sur.replace(/\b\w/g, (c) => c.toUpperCase());
}

// Every league match with a referee and card counts, across the loaded seasons
function refMatches() {
  return memo('refMatches|' + allSeasons().length + '|' + (SEASONS.real ? SEASONS.real.matches.length : 0), () => {
    const out = [], full = {};
    allSeasons().forEach((x) => {
      const db = x.current ? SEASONS.real || x.db : x.db || seasonDB(x.season);
      if (!db || !db.matches) return;
      const nm = (id) => (db.teamById && db.teamById[id] ? db.teamById[id].name : id);
      db.matches.forEach((m) => {
        const raw = m.info && m.info.ref;
        if (!raw || !m.ts || !m.ts[m.home] || !m.ts[m.away]) return;
        const k = refKey(raw);
        if (!k) return;
        if (raw.split(/\s+/)[0].length > 2) full[k] = raw.trim(); // a full first name, for display
        const H = m.ts[m.home], A = m.ts[m.away];
        out.push({ season: x.season, date: m.date, ref: k, home: nm(m.home), away: nm(m.away), hk: fbTeamKey(nm(m.home)), ak: fbTeamKey(nm(m.away)), hg: m.hg, ag: m.ag,
          hy: has(H.yc) ? H.yc : null, ay: has(A.yc) ? A.yc : null, hr: has(H.rc) ? H.rc : null, ar: has(A.rc) ? A.rc : null, hf: has(H.fls) ? H.fls : null, af: has(A.fls) ? A.fls : null });
      });
    });
    return { list: out.sort((a, b) => (a.date || '').localeCompare(b.date || '')), full };
  });
}

function refStats(ms) {
  const n = ms.length, sum = (f) => ms.reduce((t, m) => t + (m[f] || 0), 0), cnt = (f) => ms.filter((m) => m[f] != null).length;
  const ny = cnt('hy'), nr = cnt('hr'), nf = cnt('hf');
  return {
    n, y: ny ? (sum('hy') + sum('ay')) / ny : NaN, r: nr ? (sum('hr') + sum('ar')) / nr : NaN, reds: sum('hr') + sum('ar'),
    hy: ny ? sum('hy') / ny : NaN, ay: ny ? sum('ay') / ny : NaN, f: nf ? (sum('hf') + sum('af')) / nf : NaN,
    homeWin: n ? ms.filter((m) => m.hg > m.ag).length / n : NaN, awayWin: n ? ms.filter((m) => m.hg < m.ag).length / n : NaN,
  };
}

function viewReferees(el) {
  const { list, full } = refMatches();
  el.append(h('div', { class: 'hero' }, h('h1', { text: 'Ref Watch' }), h('div', { class: 'meta' }, h('span', { text: 'Cards, fouls and results by referee · a bit of fun' }))));
  if (!list.length) { el.append(card({ title: 'Ref Watch', span: true }, null, h('p', { class: 'note', style: { marginTop: 0 }, text: 'No referees in the loaded results. football-data.co.uk files name the referee for Scottish Premiership matches from 2000/01; load past seasons in the Data tab.' }))); return; }
  const seasons = [...new Set(list.map((m) => m.season))].sort().reverse();
  const spans = [['3', 'Last 3 seasons'], ['5', 'Last 5'], ['10', 'Last 10'], ['all', 'Since ' + seasons[seasons.length - 1].slice(0, 4)]].filter(([v]) => v === 'all' || seasons.length > +v);
  const span = spans.some(([v]) => v === S.refSpan) ? S.refSpan : spans[0][0];
  const from = span === 'all' ? seasons[seasons.length - 1] : seasons[+span - 1];
  const L = list.filter((m) => m.season >= from);
  const minN = span === '3' ? 8 : span === '5' ? 12 : 20;
  const lg = refStats(L);
  const name = (k) => full[k] || k;
  const rerender = () => { const y = window.scrollY; render(); window.scrollTo(0, y); };
  const tools = seg(spans, span, (v) => { S.refSpan = v; rerender(); }, 'Seasons');

  // Referees, most cards first
  const byRef = {};
  L.forEach((m) => (byRef[m.ref] = byRef[m.ref] || []).push(m));
  const refs = Object.entries(byRef).map(([k, ms]) => ({ k, ms, st: refStats(ms) })).filter((r) => r.st.n >= minN);
  const sortKey = S.refSort || 'y';
  const sorters = { y: (a, b) => b.st.y - a.st.y, r: (a, b) => b.st.r - a.st.r, n: (a, b) => b.st.n - a.st.n, home: (a, b) => b.st.homeWin - a.st.homeWin };
  refs.sort(sorters[sortKey] || sorters.y);
  const grid = h('div', { class: 'grid' });
  el.append(h('div', { class: 'kpis' }, [
    ['Matches with a referee', L.length, `${from} to ${seasons[0]}`],
    ['Yellow cards a game', fmt(lg.y, 2), 'both teams, league average'],
    ['Red cards a game', fmt(lg.r, 2), `${lg.reds} in all`],
    ['Home wins', Math.round(100 * lg.homeWin) + '%', `away wins ${Math.round(100 * lg.awayWin)}%`],
  ].map(([l, v, r]) => h('div', { class: 'kpi' }, h('div', { class: 'eyebrow', text: l }), h('div', { class: 'v', text: v }), h('div', { class: 'r', text: r })))), grid);

  const strict = refs.slice().sort((a, b) => b.st.y - a.st.y)[0], lenient = refs.slice().sort((a, b) => a.st.y - b.st.y)[0], redKing = refs.slice().sort((a, b) => b.st.r - a.st.r)[0];
  if (refs.length >= 3) grid.append(card({ title: 'The awards', span: true }, `Referees with ${minN}+ league matches in the period`, h('div', { class: 'statline' },
    [[name(strict.k), `Quickest to the notebook · ${strict.st.y.toFixed(2)} yellows a game`], [name(lenient.k), `Most forgiving · ${lenient.st.y.toFixed(2)} yellows a game`], [name(redKing.k), `Fondest of a red · ${redKing.st.r.toFixed(2)} a game (${redKing.st.reds} in ${redKing.st.n})`]]
      .map(([v, l]) => h('div', null, h('b', { text: v }), h('span', { text: l }))))));

  grid.append(card({ title: 'Every referee', span: true, tools: h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } }, tools, seg([['y', 'Yellows'], ['r', 'Reds'], ['n', 'Matches'], ['home', 'Home wins']], sortKey, (v) => { S.refSort = v; rerender(); }, 'Sort')) },
    `League matches ${from} to ${seasons[0]} · referees with ${minN}+ matches · bars against the league average`,
    h('div', { class: 'tbl-wrap' }, h('table', null,
      h('thead', null, h('tr', null, ['Referee', 'Matches', 'Yellows / game', '', 'Home / away yellows', 'Reds / game', 'Reds', 'Fouls / game', 'Home win %'].map((t, i) => h('th', { class: i === 0 || i === 3 ? 'l' : '', text: t })))),
      h('tbody', null, refs.map((r) => h('tr', { class: S.refSel === r.k ? 'focus' : '', onclick: () => { S.refSel = S.refSel === r.k ? null : r.k; rerender(); } },
        h('td', { class: 'l' }, h('b', { text: name(r.k) })), h('td', { text: r.st.n }), h('td', null, h('b', { text: fmt(r.st.y, 2) })),
        h('td', { class: 'l' }, h('span', { class: 'ref-bar' }, h('i', { style: { width: Math.min(100, (50 * r.st.y) / lg.y) + '%', background: r.st.y > lg.y ? 'var(--bad)' : 'var(--good)' } }), h('em'))),
        h('td', { text: `${fmt(r.st.hy, 2)} / ${fmt(r.st.ay, 2)}` }), h('td', { text: fmt(r.st.r, 2) }), h('td', { text: r.st.reds }), h('td', { text: fmt(r.st.f, 1) }), h('td', { text: Math.round(100 * r.st.homeWin) + '%' })))))),
    h('p', { class: 'note', text: `The middle line of each bar is the league average (${fmt(lg.y, 2)} yellows a game). Referees from football-data.co.uk (none listed for 2012/13); names are matched on initial and surname. Click a referee for their record with each club.` })));

  if (S.refSel && byRef[S.refSel]) grid.append(refDetail(S.refSel, byRef[S.refSel], name, lg));
  refClub(grid, L, name, minN);
}

// One referee: cards for and against each club, and how each club fares
function refDetail(k, ms, name, lg) {
  const st = refStats(ms), clubs = {};
  ms.forEach((m) => [[m.hk, m.home, m.hy, m.ay, m.hr, m.hg - m.ag], [m.ak, m.away, m.ay, m.hy, m.ar, m.ag - m.hg]].forEach(([ck, cn, y, oy, r, gd]) => {
    const c = (clubs[ck] = clubs[ck] || { name: cn, n: 0, y: 0, oy: 0, r: 0, pts: 0, w: 0, d: 0, l: 0 });
    c.n++; c.y += y || 0; c.oy += oy || 0; c.r += r || 0; c.pts += gd > 0 ? 3 : gd === 0 ? 1 : 0; c[gd > 0 ? 'w' : gd === 0 ? 'd' : 'l']++;
  }));
  const rows = Object.values(clubs).filter((c) => c.n >= 3).sort((a, b) => b.n - a.n);
  return card({ title: name(k), span: true }, `${st.n} league matches · ${fmt(st.y, 2)} yellows and ${fmt(st.r, 2)} reds a game (league ${fmt(lg.y, 2)} and ${fmt(lg.r, 2)}) · clubs with 3+ games`, h('div', { class: 'tbl-wrap' }, h('table', null,
    h('thead', null, h('tr', null, ['Club', 'Games', 'W-D-L', 'Points / game', 'Yellows for / game', 'Yellows for opponents', 'Reds'].map((t, i) => h('th', { class: i === 0 ? 'l' : '', text: t })))),
    h('tbody', null, rows.map((c) => h('tr', { style: { cursor: 'default' } }, h('td', { class: 'l' }, h('b', { text: c.name })), h('td', { text: c.n }), h('td', { text: `${c.w}-${c.d}-${c.l}` }),
      h('td', { text: (c.pts / c.n).toFixed(2) }), h('td', { text: (c.y / c.n).toFixed(2) }), h('td', { text: (c.oy / c.n).toFixed(2) }), h('td', { text: c.r })))))));
}

// Your club and the referees: the "conspiracy" table
function refClub(grid, L, name, minN) {
  const key = fbTeamKey(teamName(S.team)), mine = L.filter((m) => m.hk === key || m.ak === key);
  if (mine.length < 10) return;
  const side = (m) => (m.hk === key ? { y: m.hy, oy: m.ay, r: m.hr, or: m.ar, gd: m.hg - m.ag } : { y: m.ay, oy: m.hy, r: m.ar, or: m.hr, gd: m.ag - m.hg });
  const agg = (ms) => { const n = ms.length, s = ms.map(side), pts = s.reduce((t, x) => t + (x.gd > 0 ? 3 : x.gd === 0 ? 1 : 0), 0), ny = s.filter((x) => x.y != null).length;
    return { n, ppg: n ? pts / n : NaN, y: ny ? s.reduce((t, x) => t + (x.y || 0), 0) / ny : NaN, oy: ny ? s.reduce((t, x) => t + (x.oy || 0), 0) / ny : NaN, r: s.reduce((t, x) => t + (x.r || 0), 0), or: s.reduce((t, x) => t + (x.or || 0), 0), w: s.filter((x) => x.gd > 0).length, d: s.filter((x) => x.gd === 0).length, l: s.filter((x) => x.gd < 0).length }; };
  const all = agg(mine);
  const by = {};
  mine.forEach((m) => (by[m.ref] = by[m.ref] || []).push(m));
  const min = Math.max(4, Math.round(minN / 3));
  const rows = Object.entries(by).map(([k, ms]) => ({ k, a: agg(ms) })).filter((r) => r.a.n >= min);
  // "Conspiracy score": more cards for us, fewer for them, fewer points than usual
  rows.forEach((r) => { r.score = (r.a.y - all.y) - (r.a.oy - all.oy) - (r.a.ppg - all.ppg); });
  rows.sort((a, b) => b.score - a.score);
  if (!rows.length) return;
  const worst = rows[0], best = rows[rows.length - 1];
  grid.append(card({ title: `${teamName(S.team)} and the referees`, span: true }, `${all.n} league matches in the period · ${all.ppg.toFixed(2)} points and ${fmt(all.y, 2)} yellows a game overall · referees with ${min}+ ${teamName(S.team)} games`,
    h('div', { class: 'statline' },
      h('div', null, h('b', { text: name(worst.k) }), h('span', { text: `The one to fear · ${worst.a.ppg.toFixed(2)} pts a game, ${fmt(worst.a.y, 2)} yellows for us vs ${fmt(worst.a.oy, 2)} for them` })),
      h('div', null, h('b', { text: name(best.k) }), h('span', { text: `The lucky charm · ${best.a.ppg.toFixed(2)} pts a game, ${fmt(best.a.y, 2)} yellows for us vs ${fmt(best.a.oy, 2)} for them` }))),
    h('div', { class: 'tbl-wrap' }, h('table', null,
      h('thead', null, h('tr', null, ['Referee', 'Games', 'W-D-L', 'Points / game', 'Our yellows / game', 'Their yellows / game', 'Our reds', 'Their reds', 'Conspiracy meter'].map((t, i) => h('th', { class: i === 0 || i === 8 ? 'l' : '', text: t, title: t === 'Conspiracy meter' ? 'Extra yellows for us, minus extra yellows for them, minus extra points, compared with our average with every referee' : null })))),
      h('tbody', null, rows.map((r) => {
        const v = Math.max(-1, Math.min(1, r.score / 1.5));
        return h('tr', { style: { cursor: 'default' } }, h('td', { class: 'l' }, h('b', { text: name(r.k) })), h('td', { text: r.a.n }), h('td', { text: `${r.a.w}-${r.a.d}-${r.a.l}` }),
          h('td', { class: r.a.ppg < all.ppg ? 'neg' : '', text: r.a.ppg.toFixed(2) }), h('td', { text: fmt(r.a.y, 2) }), h('td', { text: fmt(r.a.oy, 2) }), h('td', { text: r.a.r }), h('td', { text: r.a.or }),
          h('td', { class: 'l' }, h('span', { class: 'ref-meter', title: r.score > 0.3 ? 'Suspicious…' : r.score < -0.3 ? 'One of ours' : 'Nothing to see here' }, h('i', { style: { left: (50 + 45 * v) + '%', background: v > 0.2 ? 'var(--bad)' : v < -0.2 ? 'var(--good)' : 'var(--muted)' } })), h('span', { class: 'sub', text: r.score > 0.3 ? ' suspicious…' : r.score < -0.3 ? ' one of ours' : ' nothing to see' })));
      }))),
    h('p', { class: 'note', text: 'For fun: a handful of games per referee is a small sample, referees are appointed to matches for reasons (big games get senior referees), and cards follow the fouls. The meter adds our extra yellows, subtracts theirs and subtracts any extra points, each compared with our average with every referee.' }))));
}
