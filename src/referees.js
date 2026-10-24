'use strict';
/* =====================================================================
   Ref Watch: cards and results by referee
   A bit of fun, built on the referee named for each league match in the
   football-data.co.uk files (2000/01 on): how many yellows and reds each
   referee shows, how home sides fare, and how your club does with each.
   ===================================================================== */

// "John Rowbotham" and "J Rowbotham" are the same referee: initial and surname
function refKey(name) {
  const w = String(name || '').normalize('NFC').replace(/[^\p{L}' .-]/gu, ' ').replace(/\./g, ' ').split(/\s+/).filter(Boolean);
  if (!w.length) return '';
  const sur = w.slice(1).join(' ') || w[0];
  return (w.length > 1 ? w[0][0].toUpperCase() + ' ' : '') + sur.replace(/(^|[\s'-])(\p{L})/gu, (a, b, c) => b + c.toUpperCase());
}

// Penalties awarded per match (from Sportmonks events, 2008/09 on), keyed by date and both clubs
function penIndex() {
  return memo('penIndex', () => {
    const ix = {};
    const P = (SNAP && SNAP.penalties) || {};
    (P.m || []).forEach(([d, h, a, ph, pa]) => { ix[d + '|' + fbTeamKey(h) + '|' + fbTeamKey(a)] = [ph, pa]; });
    ix.seasons = new Set(P.seasons || []);
    return ix;
  });
}
const shiftDay = (d, n) => new Date(Date.parse(d + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10);
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
        const hk = fbTeamKey(nm(m.home)), ak = fbTeamKey(nm(m.away)), PI = penIndex();
        // Seasons with penalty records: a match not listed had no penalty
        const pens = !PI.seasons.has(x.season) ? null : (m.date ? [0, -1, 1].map((n) => PI[shiftDay(m.date.slice(0, 10), n) + '|' + hk + '|' + ak]).find(Boolean) : null) || [0, 0];
        out.push({ season: x.season, date: m.date, ref: k, home: nm(m.home), away: nm(m.away), hk, ak, hg: m.hg, ag: m.ag, hp: pens ? pens[0] : null, ap: pens ? pens[1] : null,
          hy: has(H.yc) ? H.yc : null, ay: has(A.yc) ? A.yc : null, hr: has(H.rc) ? H.rc : null, ar: has(A.rc) ? A.rc : null, hf: has(H.fls) ? H.fls : null, af: has(A.fls) ? A.fls : null });
      });
    });
    // A surname on its own ("Beaton") is the initialled referee of that surname who took most matches, when he took
    // at least 70% of them
    const n = {};
    out.forEach((m) => { n[m.ref] = (n[m.ref] || 0) + 1; });
    const canon = {};
    Object.keys(n).filter((k) => !k.includes(' ')).forEach((sur) => {
      const c = Object.keys(n).filter((k) => k.includes(' ') && k.split(' ').slice(1).join(' ') === sur).sort((a, b) => n[b] - n[a]);
      const tot = c.reduce((t, k) => t + n[k], 0);
      if (c.length && n[c[0]] >= 0.7 * tot) canon[sur] = c[0];
    });
    out.forEach((m) => { if (canon[m.ref]) m.ref = canon[m.ref]; });
    return { list: out.sort((a, b) => (a.date || '').localeCompare(b.date || '')), full, canon };
  });
}

function refStats(ms) {
  const n = ms.length, sum = (f) => ms.reduce((t, m) => t + (m[f] || 0), 0), cnt = (f) => ms.filter((m) => m[f] != null).length;
  const ny = cnt('hy'), nr = cnt('hr'), nf = cnt('hf'), np = cnt('hp');
  return {
    np, p: np ? (sum('hp') + sum('ap')) / np : NaN, pens: sum('hp') + sum('ap'), hpen: sum('hp'), apen: sum('ap'),
    n, y: ny ? (sum('hy') + sum('ay')) / ny : NaN, r: nr ? (sum('hr') + sum('ar')) / nr : NaN, reds: sum('hr') + sum('ar'),
    hy: ny ? sum('hy') / ny : NaN, ay: ny ? sum('ay') / ny : NaN, f: nf ? (sum('hf') + sum('af')) / nf : NaN,
    homeWin: n ? ms.filter((m) => m.hg > m.ag).length / n : NaN, awayWin: n ? ms.filter((m) => m.hg < m.ag).length / n : NaN,
  };
}

function viewReferees(el) {
  const { list, full } = refMatches();
  el.append(h('div', { class: 'hero' }, h('h1', { text: 'Ref Watch' }), h('div', { class: 'meta' }, h('span', { text: 'Cards and penalties by referee · a bit of fun' }))));
  if (!list.length) { el.append(card({ title: 'Ref Watch', span: true }, null, h('p', { class: 'note', style: { marginTop: 0 }, text: 'No referees in the loaded results. football-data.co.uk files name the referee for Scottish Premiership matches from 2000/01; load past seasons in the Data tab.' }))); return; }
  const seasons = [...new Set(list.map((m) => m.season))].sort().reverse();
  // Current referees (a league match this season or last) or retired ones; each over their whole league career here
  const recent = new Set(seasons.slice(0, 2)), last = {};
  list.forEach((m) => { if (!last[m.ref] || m.season > last[m.ref]) last[m.ref] = m.season; });
  const who = S.refWho === 'retired' ? 'retired' : 'current';
  const L = list.filter((m) => recent.has(last[m.ref]) === (who === 'current'));
  const inL = [...new Set(L.map((m) => m.season))].sort();
  const from = inL[0] || seasons[seasons.length - 1];
  seasons[0] = inL[inL.length - 1] || seasons[0];
  const minN = who === 'current' ? 10 : 30;
  const lg = refStats(L);
  const name = (k) => full[k] || k;
  const rerender = () => { const y = window.scrollY; render(); window.scrollTo(0, y); };
  const tools = seg([['current', 'Current referees'], ['retired', 'Retired referees']], who, (v) => { S.refWho = v; S.refSel = null; rerender(); }, 'Referees');

  // Referees, most cards first
  const byRef = {};
  L.forEach((m) => (byRef[m.ref] = byRef[m.ref] || []).push(m));
  const refs = Object.entries(byRef).map(([k, ms]) => ({ k, ms, st: refStats(ms) })).filter((r) => r.st.n >= minN);
  const sortKey = S.refSort || 'y';
  const sorters = { y: (a, b) => b.st.y - a.st.y, r: (a, b) => b.st.r - a.st.r, p: (a, b) => (b.st.np >= 10 ? b.st.p : -1) - (a.st.np >= 10 ? a.st.p : -1), n: (a, b) => b.st.n - a.st.n };
  refs.sort(sorters[sortKey] || sorters.y);
  const grid = h('div', { class: 'grid' });
  el.append(h('div', { class: 'kpis' }, [
    [who === 'current' ? 'Matches by current referees' : 'Matches by retired referees', L.length, `${from} to ${seasons[0]} (league)`],
    ['Yellow cards a game', fmt(lg.y, 2), 'both teams, average for these referees'],
    ['Red cards a game', fmt(lg.r, 2), `${lg.reds} in all`],
    ['Penalties a game', lg.np ? fmt(lg.p, 2) : '–', lg.np ? `${lg.pens} in ${lg.np} matches with penalty records` : 'no penalty records for these seasons'],
  ].map(([l, v, r]) => h('div', { class: 'kpi' }, h('div', { class: 'eyebrow', text: l }), h('div', { class: 'v', text: v }), h('div', { class: 'r', text: r })))), grid);

  const strict = refs.slice().sort((a, b) => b.st.y - a.st.y)[0], lenient = refs.slice().sort((a, b) => a.st.y - b.st.y)[0], redKing = refs.slice().sort((a, b) => b.st.r - a.st.r)[0];
  const penRefs = refs.filter((r) => r.st.np >= Math.max(5, minN / 2)), penKing = penRefs.slice().sort((a, b) => b.st.p - a.st.p)[0];
  if (refs.length >= 3) grid.append(card({ title: 'The awards', span: true }, `Referees with ${minN}+ league matches in the period`, h('div', { class: 'statline' },
    [[name(strict.k), `Quickest to the notebook · ${strict.st.y.toFixed(2)} yellows a game`], [name(lenient.k), `Most forgiving · ${lenient.st.y.toFixed(2)} yellows a game`], [name(redKing.k), `Fondest of a red · ${redKing.st.r.toFixed(2)} a game (${redKing.st.reds} in ${redKing.st.n})`]].concat(penKing ? [[name(penKing.k), `Points to the spot · ${penKing.st.p.toFixed(2)} penalties a game (${penKing.st.pens} in ${penKing.st.np})`]] : [])
      .map(([v, l]) => h('div', null, h('b', { text: v }), h('span', { text: l }))))));

  const anyPen = refs.some((r) => r.st.np);
  // The measure chosen above is the highlighted column, with a bar against the average for these referees
  const M = [['y', 'Yellows a game', (r) => r.st.y, lg.y], ['r', 'Reds a game', (r) => r.st.r, lg.r]].concat(anyPen ? [['p', 'Penalties a game', (r) => (r.st.np >= 10 ? r.st.p : NaN), lg.p]] : []);
  const focusM = M.find(([k]) => k === sortKey);
  const cellFor = ([k, , f, avg], r) => {
    const v = f(r);
    if (!has(v)) return h('td', { text: '–', title: k === 'p' ? (r.st.np ? `Only ${r.st.np} matches with penalty records` : 'No penalty records') : '' });
    const tip = k === 'p' ? `${r.st.pens} penalties in ${r.st.np} matches with records` : k === 'r' ? `${r.st.reds} red cards in ${r.st.n} matches` : '';
    if (!focusM || focusM[0] !== k) return h('td', { text: fmt(v, 2), title: tip || null });
    return h('td', { class: 'l ref-focus', title: tip || null }, h('b', { text: fmt(v, 2), style: { display: 'inline-block', width: '3em' } }),
      h('span', { class: 'ref-bar', title: `Average ${fmt(avg, 2)}` }, h('i', { style: { width: Math.min(100, (50 * v) / (avg || 1)) + '%', background: v > avg ? 'var(--bad)' : 'var(--good)' } }), h('em')));
  };
  grid.append(card({ title: 'Every referee', span: true, tools: h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } }, tools, seg([['y', 'Yellows'], ['r', 'Reds']].concat(anyPen ? [['p', 'Penalties']] : [], [['n', 'Matches']]), sortKey, (v) => { S.refSort = v; rerender(); }, 'Sort by')) },
    `${who === 'current' ? 'Referees who took a league match this season or last' : 'Referees with no league match in the last two seasons'} · whole careers since 2000/01 · ${minN}+ matches · click a referee for their record with each club`,
    h('div', { class: 'tbl-wrap' }, h('table', { class: 'ref-table' },
      h('thead', null, h('tr', null, h('th', { class: 'l', text: 'Referee' }), h('th', { class: sortKey === 'n' ? 'ref-focus' : '', text: 'Matches' + (sortKey === 'n' ? ' ▼' : '') }),
        M.map(([k, t]) => h('th', { class: k === sortKey ? 'l ref-focus' : '', text: t + (k === sortKey ? ' ▼' : '') })))),
      h('tbody', null, refs.map((r) => h('tr', { class: S.refSel === r.k ? 'focus' : '', onclick: () => { S.refSel = S.refSel === r.k ? null : r.k; rerender(); } },
        h('td', { class: 'l' }, h('b', { text: name(r.k) })), h('td', { class: sortKey === 'n' ? 'ref-focus' : '' }, sortKey === 'n' ? h('b', { text: r.st.n }) : String(r.st.n)),
        M.map((m) => cellFor(m, r))))))),
    h('p', { class: 'note', text: (focusM ? `Bars: red is above the average for these referees (${fmt(focusM[3], focusM[0] === 'y' ? 2 : 2)} ${focusM[1].toLowerCase()}, the line in the middle), green below. ` : '') + 'Card counts rose over the years, so compare current referees with each other. Penalties include missed ones, from match records for 2008/09 onwards (shown with 10+ matches of records). Referees named by football-data.co.uk (none for 2012/13).' })));

  if (S.refSel && byRef[S.refSel]) grid.append(refDetail(S.refSel, byRef[S.refSel], name, lg));
  refClub(grid, L, name, minN);
  refCups(grid, name, who, last, recent);
  penaltyTable(grid);
}

// One referee: cards for and against each club, and how each club fares
function refDetail(k, ms, name, lg) {
  const st = refStats(ms), clubs = {};
  ms.forEach((m) => [[m.hk, m.home, m.hy, m.ay, m.hp, m.ap, m.hg - m.ag], [m.ak, m.away, m.ay, m.hy, m.ap, m.hp, m.ag - m.hg]].forEach(([ck, cn, y, oy, p, op, gd]) => {
    const c = (clubs[ck] = clubs[ck] || { name: cn, n: 0, y: 0, oy: 0, p: 0, op: 0, np: 0, pts: 0, w: 0, d: 0, l: 0 });
    c.n++; c.y += y || 0; c.oy += oy || 0; if (p != null) { c.np++; c.p += p; c.op += op || 0; } c.pts += gd > 0 ? 3 : gd === 0 ? 1 : 0; c[gd > 0 ? 'w' : gd === 0 ? 'd' : 'l']++;
  }));
  const rows = Object.values(clubs).filter((c) => c.n >= 3).sort((a, b) => b.n - a.n);
  return card({ title: name(k), span: true }, `${st.n} league matches · ${fmt(st.y, 2)} yellows, ${fmt(st.r, 2)} reds${st.np ? ` and ${fmt(st.p, 2)} penalties` : ''} a game (league ${fmt(lg.y, 2)}, ${fmt(lg.r, 2)}${lg.np ? `, ${fmt(lg.p, 2)}` : ''}) · clubs with 3+ games`, h('div', { class: 'tbl-wrap' }, h('table', null,
    h('thead', null, h('tr', null, ['Club', 'Games', 'Points a game', 'Their yellows a game', 'Penalties for / against'].map((t, i) => h('th', { class: i === 0 ? 'l' : '', text: t })))),
    h('tbody', null, rows.map((c) => h('tr', { style: { cursor: 'default' } }, h('td', { class: 'l' }, h('b', { text: c.name })), h('td', { text: c.n }),
      h('td', { text: (c.pts / c.n).toFixed(2) }), h('td', { text: (c.y / c.n).toFixed(2) }), h('td', { text: c.np ? `${c.p} / ${c.op}` : '–' })))))));
}

// Your club and the referees: the "conspiracy" table
function refClub(grid, L, name, minN) {
  const key = fbTeamKey(teamName(S.team)), mine = L.filter((m) => m.hk === key || m.ak === key);
  if (mine.length < 10) return;
  const side = (m) => (m.hk === key ? { y: m.hy, oy: m.ay, p: m.hp, op: m.ap, gd: m.hg - m.ag } : { y: m.ay, oy: m.hy, p: m.ap, op: m.hp, gd: m.ag - m.hg });
  const agg = (ms) => { const n = ms.length, s = ms.map(side), pts = s.reduce((t, x) => t + (x.gd > 0 ? 3 : x.gd === 0 ? 1 : 0), 0), ny = s.filter((x) => x.y != null).length, ps = s.filter((x) => x.p != null);
    return { n, ppg: n ? pts / n : NaN, y: ny ? s.reduce((t, x) => t + (x.y || 0), 0) / ny : NaN, oy: ny ? s.reduce((t, x) => t + (x.oy || 0), 0) / ny : NaN, np: ps.length, p: ps.reduce((t, x) => t + x.p, 0), op: ps.reduce((t, x) => t + (x.op || 0), 0), w: s.filter((x) => x.gd > 0).length, d: s.filter((x) => x.gd === 0).length, l: s.filter((x) => x.gd < 0).length }; };
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
      h('div', null, h('b', { text: name(worst.k) }), h('span', { text: `The one to fear · ${worst.a.ppg.toFixed(2)} pts a game, ${fmt(worst.a.y, 1)} yellows for us vs ${fmt(worst.a.oy, 1)} for them` + (worst.a.np ? `, penalties ${worst.a.p}–${worst.a.op}` : '') })),
      h('div', null, h('b', { text: name(best.k) }), h('span', { text: `The lucky charm · ${best.a.ppg.toFixed(2)} pts a game, ${fmt(best.a.y, 1)} yellows for us vs ${fmt(best.a.oy, 1)} for them` + (best.a.np ? `, penalties ${best.a.p}–${best.a.op}` : '') }))),
    h('div', { class: 'tbl-wrap' }, h('table', null,
      h('thead', null, h('tr', null, ['Referee', 'Games', 'Points a game', 'Yellows: us / them', 'Penalties: us / them', 'Conspiracy meter'].map((t, i) => h('th', { class: i === 0 || i === 5 ? 'l' : '', text: t, title: t === 'Conspiracy meter' ? 'Extra yellows for us, minus extra yellows for them, minus extra points, compared with our average with every referee' : null })))),
      h('tbody', null, rows.map((r) => {
        const v = Math.max(-1, Math.min(1, r.score / 1.5));
        return h('tr', { style: { cursor: 'default' } }, h('td', { class: 'l' }, h('b', { text: name(r.k) })), h('td', { text: r.a.n }),
          h('td', { class: r.a.ppg < all.ppg ? 'neg' : '', text: r.a.ppg.toFixed(2) }), h('td', { text: `${fmt(r.a.y, 1)} / ${fmt(r.a.oy, 1)}` }), h('td', { text: r.a.np ? `${r.a.p} / ${r.a.op}` : '–' }),
          h('td', { class: 'l' }, h('span', { class: 'ref-meter', title: r.score > 0.3 ? 'Suspicious…' : r.score < -0.3 ? 'One of ours' : 'Nothing to see here' }, h('i', { style: { left: (50 + 45 * v) + '%', background: v > 0.2 ? 'var(--bad)' : v < -0.2 ? 'var(--good)' : 'var(--muted)' } })), h('span', { class: 'sub', text: r.score > 0.3 ? ' suspicious…' : r.score < -0.3 ? ' one of ours' : ' nothing to see' })));
      }))),
    h('p', { class: 'note', text: 'For fun: a handful of games per referee is a small sample, referees are appointed to matches for reasons (big games get senior referees), and cards follow the fouls. The meter adds our extra yellows, subtracts theirs and subtracts any extra points, each compared with our average with every referee.' }))));
}

// The selected club's cup ties by referee (Wikipedia match reports: referee, score, scorers and, where listed, cards)
function refCups(grid, name, who, last, recent) {
  const key = fbTeamKey(teamName(S.team));
  const ties = [];
  allSeasons().forEach((x) => {
    const db = x.current ? SEASONS.real || x.db : x.db || seasonDB(x.season);
    if (!db || !db.cups) return;
    const t = db.teams.find((z) => fbTeamKey(z.name) === key);
    if (!t) return;
    const nm = (id) => (db.teamById && db.teamById[id] ? db.teamById[id].name : id);
    db.cups.forEach((m) => {
      if (!(m.home === t.id || m.away === t.id) || !m.info || !m.info.ref) return;
      const O = m.home === t.id ? m.away : m.home, wc = m.wikiCards || null, ws = m.wikiScorers || null;
      const pens = (id) => (ws && ws[id] ? ws[id].filter((g) => /\(p\)/.test(g)).length : null);
      ties.push({ season: x.season, date: m.date, ref: refKey(m.info.ref), res: result(m, t.id), opp: nm(O), round: roundLabel(m), score: `${goalsFor(m, t.id)}–${goalsAg(m, t.id)}${m.pens ? ' p' : ''}`,
        y: wc && wc[t.id] ? wc[t.id].y : null, oy: wc && wc[O] ? wc[O].y : null, r: wc && wc[t.id] ? wc[t.id].r : null, or: wc && wc[O] ? wc[O].r : null, p: pens(t.id), op: pens(O) });
    });
  });
  if (ties.length < 5) return;
  ties.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  // A report giving the surname only ("McLean") is the league referee of that surname, when there is just one
  const { canon } = refMatches();
  ties.forEach((t) => { if (canon[t.ref]) t.ref = canon[t.ref]; });
  // The same current/retired split as the league tables (a referee seen only in cup ties counts by his last tie)
  const lastAny = { ...last };
  ties.forEach((t) => { if (!lastAny[t.ref] || t.season > lastAny[t.ref]) lastAny[t.ref] = t.season; });
  const mine = ties.filter((t) => recent.has(lastAny[t.ref]) === (who === 'current'));
  const by = {};
  mine.forEach((t) => (by[t.ref] = by[t.ref] || []).push(t));
  const rows = Object.entries(by).map(([k, l]) => {
    const w = l.filter((t) => t.res === 'W').length, d = l.filter((t) => t.res === 'D').length, cards = l.filter((t) => t.y != null);
    return { k, l, w, d, lo: l.length - w - d, y: cards.reduce((s, t) => s + t.y, 0), oy: cards.reduce((s, t) => s + t.oy, 0), r: cards.reduce((s, t) => s + t.r, 0), or: cards.reduce((s, t) => s + t.or, 0), nc: cards.length, p: l.reduce((s, t) => s + (t.p || 0), 0), op: l.reduce((s, t) => s + (t.op || 0), 0) };
  }).sort((a, b) => b.l.length - a.l.length || a.k.localeCompare(b.k));
  if (!rows.length) return;
  grid.append(card({ title: `${teamName(S.team)} in cup ties`, span: true }, `${mine.length} cup ties with ${who === 'current' ? 'current' : 'retired'} referees · Scottish Cup, League Cup, Europe and others · from Wikipedia match reports (2010/11 on)`,
    h('div', { class: 'tbl-wrap' }, h('table', null,
      h('thead', null, h('tr', null, ['Referee', 'Ties', 'W-D-L', 'Win %', 'Cards: us / them', 'Penalties scored: us / them', 'Last tie'].map((t, i) => h('th', { class: i === 0 || i === 6 ? 'l' : '', text: t })))),
      h('tbody', null, rows.map((r) => { const lt = r.l[r.l.length - 1];
        return h('tr', { style: { cursor: 'default' } }, h('td', { class: 'l' }, h('b', { text: name(r.k) })), h('td', { text: r.l.length }), h('td', { text: `${r.w}-${r.d}-${r.lo}` }),
          h('td', { class: r.w / r.l.length < 0.4 ? 'neg' : '', text: Math.round((100 * r.w) / r.l.length) + '%' }),
          h('td', { title: r.nc ? `Yellows ${r.y} / ${r.oy}, reds ${r.r} / ${r.or}, in ${r.nc} ties with cards listed` : 'No cards listed for these ties', text: r.nc ? `${r.y + r.r} / ${r.oy + r.or}` : '–' }),
          h('td', { text: `${r.p} / ${r.op}` }), h('td', { class: 'l sub', text: `${fmtDate(lt.date)} ${String(lt.date).slice(0, 4)} · ${lt.round} v ${lt.opp} ${lt.score} (${lt.res})` }));
      })))),
    h('p', { class: 'note', text: 'Cup ties are counted as won or lost on penalties where a shootout decided them. Cards only where the match report lists them (about a third of ties); penalties are those scored, as the reports rarely record misses.' })));
}

// Penalties awarded for and against each club in a season (all league matches with penalty records, 2008/09 on)
function penaltyTable(grid) {
  const PI = penIndex();
  if (!PI.seasons || !PI.seasons.size) return;
  const per = memo('penTable|' + allSeasons().length + '|' + (SEASONS.real ? SEASONS.real.matches.length : 0), () => {
    const out = {};
    allSeasons().forEach((x) => {
      if (!PI.seasons.has(x.season)) return;
      const db = x.current ? SEASONS.real || x.db : x.db || seasonDB(x.season);
      if (!db || !db.matches) return;
      const nm = (id) => (db.teamById && db.teamById[id] ? db.teamById[id].name : id);
      const T = (out[x.season] = {});
      db.matches.forEach((m) => {
        if (!m.date) return;
        const hk = fbTeamKey(nm(m.home)), ak = fbTeamKey(nm(m.away));
        const p = [0, -1, 1].map((n) => PI[shiftDay(m.date.slice(0, 10), n) + '|' + hk + '|' + ak]).find(Boolean) || [0, 0];
        [[hk, nm(m.home), p[0], p[1]], [ak, nm(m.away), p[1], p[0]]].forEach(([k, n, f, a]) => { const r = (T[k] = T[k] || { name: n, n: 0, f: 0, a: 0 }); r.n++; r.f += f; r.a += a; });
      });
    });
    return out;
  });
  const seasons = Object.keys(per).sort().reverse();
  if (!seasons.length) return;
  const pick = S.penSeason === 'all' || seasons.includes(S.penSeason) ? S.penSeason : seasons[0];
  // One season, or every season added up
  const rowsOf = (sel) => {
    if (sel !== 'all') return Object.entries(per[sel]).map(([k, r]) => ({ k, ...r }));
    const agg = {};
    seasons.forEach((s2) => Object.entries(per[s2]).forEach(([k, r]) => { const a = (agg[k] = agg[k] || { k, name: r.name, n: 0, f: 0, a: 0, seasons: 0 }); a.n += r.n; a.f += r.f; a.a += r.a; a.seasons++; }));
    return Object.values(agg);
  };
  const rows = rowsOf(pick).sort((a, b) => b.f - a.f || a.a - b.a || a.name.localeCompare(b.name));
  const key = fbTeamKey(teamName(S.team)), tot = rows.reduce((t, r) => t + r.f, 0);
  const sel = h('select', { 'aria-label': 'Season', onchange: (e) => { S.penSeason = e.target.value; const y = window.scrollY; render(); window.scrollTo(0, y); } },
    h('option', { value: 'all', selected: pick === 'all', text: `All seasons (${seasons[seasons.length - 1]} on)` }), seasons.map((s2) => h('option', { value: s2, selected: s2 === pick, text: s2 })));
  grid.append(card({ title: 'Penalties by club', span: true, tools: sel }, `${pick === 'all' ? 'Every season since ' + seasons[seasons.length - 1] : pick} · league matches · penalties awarded (scored or missed) · ${tot} in all`,
    h('div', { class: 'tbl-wrap' }, h('table', null,
      h('thead', null, h('tr', null, ['Club'].concat(pick === 'all' ? ['Seasons'] : [], ['Played', 'Penalties for', 'Penalties against', 'Difference', 'For a game', 'Against a game']).map((t, i) => h('th', { class: i === 0 ? 'l' : '', text: t })))),
      h('tbody', null, rows.map((r) => h('tr', { class: r.k === key ? 'focus' : '', style: { cursor: 'default' } },
        h('td', { class: 'l' }, h('b', { text: r.name })), pick === 'all' ? h('td', { text: r.seasons }) : null, h('td', { text: r.n }),
        h('td', null, h('b', { text: r.f })), h('td', { text: r.a }), h('td', { class: r.f - r.a < 0 ? 'neg' : '', text: signed(r.f - r.a, 0) }),
        h('td', { text: (r.f / r.n).toFixed(2) }), h('td', { text: (r.a / r.n).toFixed(2) })))))),
    h('p', { class: 'note', text: 'From Sportmonks match events (2008/09 on), counted for the club awarded the penalty, whether scored or missed. Penalty shootouts are not included.' })));
}
