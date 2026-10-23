'use strict';
/* =====================================================================
   Without the ball
   1. Ball winning: tackles, interceptions, recoveries and duels from match
      totals, so it works with Sportmonks and API-Football data too.
   2. After losing the ball: every open-play loss, how quickly the ball came
      back, and whether the opponent got a shot (needs event data).
   3. The moment it was lost: player positions from StatsBomb 360 data.
   ===================================================================== */

const LOSS_KIND = { pass: 'Misplaced pass', duel: 'Tackled or lost a duel', dribble: 'Failed take-on', loss: 'Miscontrol or dispossessed' };
const REGAIN = [['5', 'Within 5 s', '--good'], ['10', '5–10 s', '--c3'], ['20', '10–20 s', '--c1'], ['later', 'After 20 s', '--c4'], ['dead', 'Not in open play', '--rule-2']];
const SHOT_WINDOW = 20; // seconds after winning the ball

/* ---------- Losses ---------- */
// Open-play losses, event by event: a team has the ball and the next team to control it is the
// opponent, without a stoppage in between (a throw-in, goal kick or free kick restart is not a loss).
// Event-level rather than possession-level, so a ball won straight back after the opponent's first
// touch still counts as a loss and a quick win.
function matchLosses(m) {
  if (m._losses) return m._losses;
  const out = (m._losses = []);
  if (!m.events || !m.events.length || !m.poss || !m.poss.length) return out;
  const first = {};
  m.events.forEach((e) => { if (!(e.pos in first)) first[e.pos] = e; });
  const restart = (e) => !!e.sp || (first[e.pos] === e && m.poss[e.pos] && m.poss[e.pos].startType !== 'recovery');
  const C = m.events.filter(isControl);
  for (let i = 0; i < C.length - 1; i++) {
    const e = C[i], w = C[i + 1];
    if (w.team === e.team || w.per !== e.per || e.type === 'shot' || restart(w)) continue;
    let k = i + 2;
    while (k < C.length && C[k].per === e.per && C[k].team !== e.team) k++;
    const r = k < C.length && C[k].per === e.per ? C[k] : null; // the ball back
    const secs = r ? Math.max(0, r.t - w.t) : null, open = !!r && !restart(r);
    let sh = 0, xg = 0, g = 0, f3 = false;
    for (let j = i + 1; j < k; j++) {
      const x = C[j];
      if (x.x >= 80) f3 = true;
      if (x.type === 'shot' && x.t - w.t <= SHOT_WINDOW) { sh++; xg += x.xg || 0; if (x.out === 'goal') g++; }
    }
    const L = {
      m, team: e.team, opp: w.team, e, kind: e.type === 'pass' && !e.ok ? 'pass' : e.type === 'dribble' || e.type === 'loss' ? e.type : 'duel',
      zone: e.x < 40 ? 'own' : e.x < 80 ? 'mid' : 'f3', t: w.t, secs, open,
      bucket: !open ? 'dead' : secs <= 5 ? '5' : secs <= 10 ? '10' : secs <= 20 ? '20' : 'later',
      oppShot: sh > 0, oppXg: xg, oppGoal: g > 0, oppF3: f3,
      regainer: open && secs <= 5 ? r.pl : null,
    };
    if (e.ff) L.fr = frameStats(e);
    out.push(L);
  }
  return out;
}
// Positions at the moment of loss (players in the camera's view only)
function frameStats(e) {
  const s = { behind: 0, oppBehind: 0, near: 0, oppNear: 0, mates: 0, opps: 0 };
  e.ff.forEach(([x, y, c]) => {
    const d = Math.hypot(x - e.x, y - e.y);
    if (c === 1) { s.mates++; if (x < e.x) s.behind++; if (d <= 10) s.near++; }
    else if (c === 0) { s.opps++; if (x < e.x) s.oppBehind++; if (d <= 10) s.oppNear++; }
  });
  return s;
}
const pctOf = (a, b) => (b ? (100 * a) / b : NaN);
const avgOf = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : NaN);
function lossSummary(ms, T) {
  const all = ms.flatMap(matchLosses);
  const L = all.filter((l) => l.team === T), won = all.filter((l) => l.opp === T); // won = the opponent's losses (T won the ball)
  const n = ms.length || 1, secs = L.filter((l) => l.open).map((l) => l.secs).sort((a, b) => a - b), fr = L.filter((l) => l.fr);
  const buckets = Object.fromEntries(REGAIN.map(([k]) => [k, L.filter((l) => l.bucket === k).length]));
  return {
    L, won, n, buckets, frN: fr.length,
    perMatch: L.length / n,
    won5: pctOf(buckets['5'], L.length),
    median: secs.length ? secs[Math.floor(secs.length / 2)] : NaN,
    oppShot: pctOf(L.filter((l) => l.oppShot).length, L.length),
    oppXg: L.reduce((s, l) => s + l.oppXg, 0) / n,
    forShots: won.filter((l) => l.oppShot).length / n,
    forXg: won.reduce((s, l) => s + l.oppXg, 0) / n,
    behind: avgOf(fr.map((l) => l.fr.behind)),
    oppBehind: avgOf(fr.map((l) => l.fr.oppBehind)),
    near: avgOf(fr.map((l) => l.fr.near)),
  };
}
const LOSS_KPIS = [
  { k: 'perMatch', l: 'Open-play losses', u: '/ match', d: 1, dir: -1, tip: 'Times the opponent took the ball in open play, event by event (a ball that goes out of play is not counted, and nor are shots).' },
  { k: 'won5', l: 'Won back within 5 s', u: '%', d: 0, dir: 1, tip: 'Share of losses where the team won the ball back in open play within 5 seconds: a measure of the counter-press.' },
  { k: 'median', l: 'Median time to win it back', u: 's', d: 0, dir: -1, tip: 'Typical time from losing the ball to winning it back in open play.' },
  { k: 'oppShot', l: 'Losses that led to a shot against', u: '%', d: 1, dir: -1, tip: 'Share of losses where the opponent had a shot within 20 seconds, before the ball came back.' },
  { k: 'oppXg', l: 'xG conceded after losing it', u: '/ match', d: 2, dir: -1, tip: 'Expected goals from opponent shots within 20 seconds of taking the ball from this team.' },
  { k: 'forShots', l: 'Shots after winning the ball', u: '/ match', d: 1, dir: 1, tip: 'Shots within 20 seconds of winning the ball from the opponent in open play.' },
  { k: 'behind', l: 'Team-mates behind the ball', u: '', d: 1, dir: 0, need360: true, tip: 'At the moment of loss: team-mates (not the goalkeeper) between the ball and their own goal. 360 data counts only players in the camera’s view.' },
  { k: 'near', l: 'Team-mates within 10 yds', u: '', d: 1, dir: 1, need360: true, tip: 'At the moment of loss: team-mates within 10 yards of the ball, ready to press it straight away.' },
];
function lossLeague() {
  return memo('ll|' + S.venue + '|' + leagueRange(), () => DB.teams.map((t) => ({ id: t.id, s: lossSummary(scoped(t.id, leagueRange()), t.id) })).filter((r) => r.s.L.length));
}
function lossRank(k, dir, T) {
  const rows = lossLeague().filter((r) => has(r.s[k]));
  rows.sort((a, b) => (dir === -1 ? a.s[k] - b.s[k] : b.s[k] - a.s[k]));
  return { rank: rows.findIndex((r) => r.id === T) + 1, of: rows.length, avg: avgOf(rows.map((r) => r.s[k])) };
}

/* ---------- Ball winning from match totals ---------- */
function againstAgg(ms, T) { const a = blankTeam(); ms.forEach((m) => { const O = oppOf(m, T); if (m.ts[O]) addInto(a, m.ts[O]); }); return a; }
const winsOf = (a) => (has(a.tkl) && has(a.int) ? a.tkl + a.int + (has(a.rec) ? a.rec : 0) : NaN);
const BW_COLS = [
  { k: 'wins', l: 'Ball wins', f: (a) => safe(winsOf(a), a.n), d: 1, dir: 1, tip: 'Tackles + interceptions + ball recoveries per match (recoveries where the data has them).' },
  { k: 'tkl', l: 'Tkl', f: (a) => safe(a.tkl, a.n), d: 1, dir: 1, tip: 'Tackles per match' },
  { k: 'int', l: 'Int', f: (a) => safe(a.int, a.n), d: 1, dir: 1, tip: 'Interceptions per match' },
  { k: 'rec', l: 'Rec', f: (a) => safe(a.rec, a.n), d: 1, dir: 1, tip: 'Ball recoveries per match' },
  { k: 'duel', l: 'Duel %', f: (a) => 100 * safe(a.duelW, a.duel), d: 0, dir: 1, tip: 'Share of duels won' },
  { k: 'fls', l: 'Fouls', f: (a) => safe(a.fls, a.n), d: 1, dir: 0, tip: 'Fouls committed per match' },
  { k: 'oppPass', l: 'Opp pass %', f: (a, o) => 100 * safe(o.pc, o.pa), d: 1, dir: -1, tip: 'Opponents’ pass completion in matches against this team. Lower means passing against them is harder.' },
  { k: 'opd', l: 'Opp passes / def. action', f: (a, o) => safe(o.pa, (has(a.tkl) ? a.tkl : 0) + (has(a.int) ? a.int : 0) + (has(a.fls) ? a.fls : 0)), d: 1, dir: -1, tip: 'Opponent passes per tackle, interception or foul, anywhere on the pitch. A rough pressing measure for data without locations (PPDA proper counts only the opponent’s half).' },
];
function bwLeague() {
  return memo('bw|' + S.venue + '|' + leagueRange(), () => DB.teams.map((t) => { const ms = scoped(t.id, leagueRange()); return { team: t, a: aggTeam(ms, t.id), o: againstAgg(ms, t.id) }; }).filter((r) => r.a.n));
}

function viewPress(el) {
  const T = S.team, ms = scoped(T), A = css('--team-a');
  el.append(h('div', { class: 'hero' }, h('h1', { text: teamName(T) }), h('div', { class: 'meta' }, h('span', { text: rangeLabel() + ' · ' + ms.length + (ms.length === 1 ? ' match' : ' matches') + ' · without the ball' }))));
  const grid = h('div', { class: 'grid' });
  el.append(grid);
  if (DB.hasEvents) pressEvents(el, grid, T, ms, A);
  else grid.append(lossNote());
  ballWinning(grid, T, ms, A);
}

// Shown when the data has no event locations
function lossNote() {
  const body = [h('p', { class: 'note', style: { marginTop: 0 }, text: `Where the ball is lost, how quickly it comes back, and where the players were at that moment need event data with pitch locations. ${DB.label} has ${dataHas()}, so only the ball-winning numbers below are available.` })];
  if (SAMPLE) body.push(h('div', { class: 'saved', style: { marginTop: '10px' } }, h('div', null, h('b', { text: 'Try it on real matches' }), h('div', { class: 'sub', text: SAMPLE.label + ', from StatsBomb’s free data, with player positions at every loss of the ball.' })),
    h('button', { class: 'btn', type: 'button', text: 'Open the sample', onclick: () => { loadSample(); S.tab = 'press'; render(); window.scrollTo({ top: 0 }); } })));
  body.push(h('p', { class: 'note' }, 'More StatsBomb competitions: run ', h('code', { text: 'node tools/fetch-statsbomb.mjs --list' }), ', then drop the saved file into the Data tab.'));
  return card({ title: 'After losing the ball', span: true }, null, ...body);
}

function pressEvents(el, grid, T, ms, A) {
  const s = lossSummary(ms, T);
  if (!s.L.length) { grid.append(card({ title: 'After losing the ball', span: true }, null, h('p', { class: 'note', style: { marginTop: 0 }, text: 'No open-play losses found in these matches.' }))); return; }
  const kp = LOSS_KPIS.filter((k) => has(s[k.k]) && (!k.need360 || s.frN));
  el.insertBefore(h('div', { class: 'kpis' }, kp.map((k) => {
    const rk = lossRank(k.k, k.dir, T);
    const tile = h('div', { class: 'kpi', tabindex: 0 }, h('div', { class: 'eyebrow', text: k.l + (k.u === '/ match' ? ' / match' : '') }), h('div', { class: 'v' }, fmt(s[k.k], k.d), k.u && k.u !== '/ match' ? h('small', { text: k.u }) : null),
      rk.of >= 3 ? h('div', { class: 'r' }, k.dir === 0 ? `league avg ${fmt(rk.avg, k.d)}` : [h('b', { text: ordinal(rk.rank) }), ` of ${rk.of} · avg ${fmt(rk.avg, k.d)}`]) : h('div', { class: 'r', text: 'No league comparison' }));
    hover(tile, () => [{ v: k.l, strong: true }, { v: k.tip }]);
    return tile;
  })), grid);

  // Loss map
  const losses = s.L;
  const key = (l) => l.m.id + '|' + l.e.id;
  const withFr = losses.filter((l) => l.fr);
  let sel = losses.find((l) => key(l) === S.loss) || null;
  const good = css('--good'), bad = css('--bad'), mute = css('--muted');
  const colOf = (l) => (l.oppShot ? bad : l.bucket === '5' ? good : mute);
  const p = pitch();
  p.svg.setAttribute('aria-label', losses.length + ' losses of the ball');
  losses.slice().sort((a, b) => (a.oppShot - b.oppShot) || (a.bucket === '5') - (b.bucket === '5')).forEach((l) => {
    const c = colOf(l), on = sel && key(sel) === key(l);
    const dot = sv('circle', { cx: l.e.x, cy: l.e.y, r: on ? 1.9 : 1.15, fill: c, 'fill-opacity': c === mute ? 0.45 : 0.85, stroke: on ? css('--ink') : 'none', 'stroke-width': 0.5, tabindex: 0, style: 'cursor:pointer' });
    hover(dot, () => lossTip(l, T));
    dot.addEventListener('click', () => { S.loss = key(l); render(); });
    p.marks.append(dot);
  });
  const zones = [['own', 'Own third'], ['mid', 'Middle third'], ['f3', 'Final third']].map(([z, lab]) => {
    const zl = losses.filter((l) => l.zone === z);
    return h('tr', { style: { cursor: 'default' } }, h('td', { class: 'l', text: lab }), h('td', { text: fmt(zl.length / s.n, 1) }), h('td', { text: fmt(pctOf(zl.filter((l) => l.bucket === '5').length, zl.length), 0) + '%' }), h('td', { text: fmt(pctOf(zl.filter((l) => l.oppShot).length, zl.length), 0) + '%' }));
  });
  grid.append(card('Where the ball is lost', `${losses.length} open-play losses · ${teamName(T)} attacking right${withFr.length ? ' · click a dot to see the players at that moment' : ''}`,
    p.svg, legend([['Won back within 5 s', good], ['Led to a shot against', bad], ['Other', mute]]),
    h('div', { class: 'tbl-wrap' }, h('table', { style: { marginTop: '10px' } }, h('thead', null, h('tr', null, h('th', { class: 'l', text: 'Zone' }), h('th', { text: 'Per match' }), h('th', { text: 'Won back ≤5 s' }), h('th', { text: 'Shot against' }))), h('tbody', null, zones)))));

  // Time to win it back
  const lg = lossLeague(), lgTot = {};
  REGAIN.forEach(([k]) => (lgTot[k] = lg.reduce((sum, r) => sum + pctOf(r.s.buckets[k], r.s.L.length), 0) / (lg.length || 1)));
  const tot = losses.length;
  const bar = (vals, label) => h('div', { class: 'phase-row', style: { marginBottom: '12px' } }, h('div', { class: 'eyebrow', text: label }),
    h('div', { class: 'stackbar' }, REGAIN.map(([k, l, c]) => {
      const v = vals[k];
      const seg = h('div', { class: k === 'dead' || k === '10' ? 'dk' : '', style: { width: v + '%', background: css(c) }, tabindex: 0, text: v >= 9 ? Math.round(v) + '%' : '' });
      hover(seg, () => [{ v: v.toFixed(1) + '%', strong: true }, { v: k === 'dead' ? 'Not won back in open play (the ball went out, a foul, or the half ended)' : 'Won back ' + l.toLowerCase() }]);
      return seg;
    })));
  const mine = Object.fromEntries(REGAIN.map(([k]) => [k, pctOf(s.buckets[k], tot)]));
  const byKind = Object.entries(LOSS_KIND).map(([k, l]) => { const kl = losses.filter((x) => x.kind === k); return { l, n: kl.length, w5: pctOf(kl.filter((x) => x.bucket === '5').length, kl.length) }; }).filter((r) => r.n);
  grid.append(card('How quickly it comes back', 'Time from losing the ball to winning it back in open play', bar(mine, teamName(T)), lg.length > 1 ? bar(lgTot, 'League average') : null,
    legend(REGAIN.map(([, l, c]) => [l, css(c)])),
    h('div', { class: 'tbl-wrap' }, h('table', { style: { marginTop: '12px' } }, h('thead', null, h('tr', null, h('th', { class: 'l', text: 'How it was lost' }), h('th', { text: 'Losses' }), h('th', { text: 'Won back ≤5 s' }))),
      h('tbody', null, byKind.map((r) => h('tr', { style: { cursor: 'default' } }, h('td', { class: 'l', text: r.l }), h('td', { text: r.n }), h('td', { text: fmt(r.w5, 0) + '%' }))))))));

  // The moment it was lost (360)
  if (withFr.length) {
    const list = S.lossShow === 'all' ? withFr : withFr.filter((l) => l.oppShot).length ? withFr.filter((l) => l.oppShot) : withFr;
    if (!sel || !sel.fr || !list.includes(sel)) sel = list[0];
    const i = list.indexOf(sel);
    const step = (d) => { S.loss = key(list[(i + d + list.length) % list.length]); render(); };
    const tools = h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' } },
      seg([['shot', 'Led to a shot'], ['all', 'All losses']], S.lossShow === 'all' ? 'all' : 'shot', (v) => { S.lossShow = v; S.loss = null; render(); }, 'Which losses'),
      h('div', { class: 'seg' }, h('button', { type: 'button', 'aria-label': 'Previous', onclick: () => step(-1), text: '‹' }), h('button', { type: 'button', 'aria-label': 'Next', onclick: () => step(1), text: '›' })));
    grid.append(card({ title: 'The moment it was lost', tools }, `${i + 1} of ${list.length} · StatsBomb 360 positions · ${teamName(T)} attacking right`, frameView(sel, T), frameCaption(sel, T)));
    grid.append(card('Players behind the ball', 'Team-mates between the ball and their own goal when it was lost, and what happened next', restTable(withFr)));
  }

  // Players
  const pls = {};
  losses.forEach((l) => { const r = (pls[l.e.pl] = pls[l.e.pl] || { l: 0, sh: 0, w: 0 }); r.l++; if (l.oppShot) r.sh++; });
  s.L.forEach((l) => { if (l.regainer && DB.players[l.regainer] && DB.players[l.regainer].team === T) (pls[l.regainer] = pls[l.regainer] || { l: 0, sh: 0, w: 0 }).w++; });
  const rows = Object.entries(pls).map(([pid, r]) => ({ pid, ...r, min: aggPlayer(ms, pid).min })).filter((r) => DB.players[r.pid] && r.min > 0);
  rows.sort((a, b) => b.w / b.min - a.w / a.min || b.w - a.w);
  const p90 = (v, min) => fmt((90 * v) / min, 2);
  grid.append(card({ title: 'Players', span: true }, 'Who loses the ball, and who wins it straight back (first to win it within 5 s of a team-mate losing it) · sorted by quick wins per 90',
    h('div', { class: 'tbl-wrap' }, h('table', null,
      h('thead', null, h('tr', null, ['Player', 'Min', 'Losses', 'Per 90', 'Shot against', 'Quick wins', 'Per 90'].map((c, j) => h('th', { class: j === 0 ? 'l' : '', text: c })))),
      h('tbody', null, rows.slice(0, 25).map((r) => h('tr', { onclick: () => { S.tab = 'players'; S.player = r.pid; render(); window.scrollTo({ top: 0 }); }, title: 'Open ' + DB.players[r.pid].name },
        h('td', { class: 'l', text: DB.players[r.pid].name }), h('td', { text: r.min }), h('td', { text: r.l }), h('td', { text: p90(r.l, r.min) }), h('td', { text: r.sh }), h('td', null, h('b', { text: r.w })), h('td', { text: p90(r.w, r.min) }))))))));
}
function lossTip(l, T) {
  const pl = DB.players[l.e.pl];
  const what = l.bucket === 'dead' ? 'Not won back in open play' : 'Won back after ' + l.secs + ' s';
  return [{ v: LOSS_KIND[l.kind], strong: true }, { v: (pl ? pl.name : 'Unknown') + ' · ' + Math.floor(l.t / 60 + 1) + "'" }, { v: what + (l.oppShot ? ' · opponent shot (' + l.oppXg.toFixed(2) + ' xG)' + (l.oppGoal ? ', goal' : '') : '') }, { v: matchLabel(l.m, T) }];
}
function frameView(l, T) {
  const p = pitch();
  const A = css('--team-a'), B = css('--team-b'), surf = css('--surface');
  // Pass or carry direction, for context
  if (l.e.ex != null) p.marks.append(sv('line', { x1: l.e.x, y1: l.e.y, x2: l.e.ex, y2: l.e.ey, stroke: css('--ink-2'), 'stroke-width': 0.45, 'stroke-dasharray': '1.2 1', opacity: 0.8 }));
  l.e.ff.slice().sort((a, b) => a[2] - b[2]).forEach(([x, y, c]) => {
    const mate = c >= 1 && c <= 3, col = mate ? A : B;
    p.marks.append(sv('circle', { cx: x, cy: y, r: c === 2 ? 1.9 : 1.5, fill: col, stroke: c === 3 || c === 4 ? css('--ink') : surf, 'stroke-width': c === 3 || c === 4 ? 0.5 : 0.35 }));
  });
  p.marks.append(sv('circle', { cx: l.e.x, cy: l.e.y, r: 0.75, fill: '#fff', stroke: '#111', 'stroke-width': 0.3 }));
  return h('div', null, p.svg, legend([[teamName(T), A], [teamName(l.opp), B], ['Ball', '#fff']]));
}
function frameCaption(l, T) {
  const pl = DB.players[l.e.pl], f = l.fr;
  const next = l.oppShot ? `${teamName(l.opp)} had a shot (${l.oppXg.toFixed(2)} xG${l.oppGoal ? ', goal' : ''})` : l.bucket === '5' ? `Won back after ${l.secs} s` + (l.regainer && DB.players[l.regainer] ? ' by ' + DB.players[l.regainer].name : '') : l.bucket === 'dead' ? 'Not won back in open play' : `Won back after ${l.secs} s`;
  return h('div', { class: 'statline', style: { marginTop: '10px' } },
    [[Math.floor(l.t / 60 + 1) + "'", matchLabel(l.m, T)], [LOSS_KIND[l.kind], pl ? pl.name : ''], [f.behind + ' v ' + f.oppBehind, 'Behind the ball'], [f.near + ' v ' + f.oppNear, 'Within 10 yds'], [next, 'What happened next']]
      .map(([v, k]) => h('div', null, h('b', { style: { fontSize: typeof v === 'string' && v.length > 8 ? '15px' : null }, text: v }), h('span', { text: k }))));
}
function restTable(withFr) {
  const bands = [['0–2', (n) => n <= 2], ['3–4', (n) => n === 3 || n === 4], ['5–6', (n) => n === 5 || n === 6], ['7+', (n) => n >= 7]];
  const rows = bands.map(([l, f]) => { const ls = withFr.filter((x) => f(x.fr.behind)); return { l, n: ls.length, w5: pctOf(ls.filter((x) => x.bucket === '5').length, ls.length), sh: pctOf(ls.filter((x) => x.oppShot).length, ls.length) }; });
  const nearRows = [['0', (n) => n === 0], ['1', (n) => n === 1], ['2', (n) => n === 2], ['3+', (n) => n >= 3]].map(([l, f]) => { const ls = withFr.filter((x) => f(x.fr.near)); return { l, n: ls.length, w5: pctOf(ls.filter((x) => x.bucket === '5').length, ls.length), sh: pctOf(ls.filter((x) => x.oppShot).length, ls.length) }; });
  const tbl = (head, rs) => h('table', { style: { marginBottom: '12px' } }, h('thead', null, h('tr', null, h('th', { class: 'l', text: head }), h('th', { text: 'Losses' }), h('th', { text: 'Won back ≤5 s' }), h('th', { text: 'Shot against' }))),
    h('tbody', null, rs.map((r) => h('tr', { style: { cursor: 'default' } }, h('td', { class: 'l', text: r.l }), h('td', { text: r.n }), h('td', { text: r.n ? fmt(r.w5, 0) + '%' : '–' }), h('td', { text: r.n ? fmt(r.sh, 0) + '%' : '–' })))));
  return h('div', null, h('div', { class: 'tbl-wrap' }, tbl('Team-mates behind the ball', rows)), h('div', { class: 'tbl-wrap' }, tbl('Team-mates within 10 yds', nearRows)),
    h('p', { class: 'note', text: `${withFr.length} losses with 360 positions. StatsBomb 360 records only the players in the broadcast camera’s view, so deep defenders far from the ball are sometimes missing and “behind the ball” counts run low.` }));
}

/* ---------- Ball winning (totals) ---------- */
function ballWinning(grid, T, ms, A) {
  const a = aggTeam(ms, T), o = againstAgg(ms, T);
  if (!has(winsOf(a))) {
    grid.append(card({ title: 'Ball winning', span: true }, null, h('p', { class: 'note', style: { marginTop: 0 }, text: `Tackles, interceptions and recoveries are not in this data. ${DB.label} has ${dataHas()}. Add the Sportmonks download (Data tab) for every club’s defensive numbers.` })));
    return;
  }
  const L = bwLeague();
  const cols = BW_COLS.filter((c) => has(c.f(a, o)) && L.filter((r) => has(c.f(r.a, r.o))).length >= 2);
  const sortK = cols.some((c) => c.k === S.bwSort) ? S.bwSort : 'wins';
  const sc = cols.find((c) => c.k === sortK);
  const rows = L.map((r) => ({ ...r, v: sc.f(r.a, r.o) })).sort((x, y) => (sc.dir === -1 ? x.v - y.v : y.v - x.v));
  const head = h('tr', null, h('th', { text: '#' }), h('th', { class: 'l', text: 'Team' }), cols.map((c) => {
    const th = h('th', { class: 'sortable' + (c.k === sortK ? ' sorted' : ''), tabindex: 0, text: c.l, onclick: () => { S.bwSort = c.k; render(); } });
    hover(th, () => [{ v: c.l, strong: true }, { v: c.tip }]);
    return th;
  }));
  grid.append(card({ title: 'Ball winning', span: true }, `${rangeLabel()} · per match · click a column to rank by it`, h('div', { class: 'tbl-wrap' }, h('table', null, h('thead', null, head),
    h('tbody', null, rows.map((r, i) => h('tr', { class: r.team.id === T ? 'focus' : '', onclick: () => { S.team = r.team.id; render(); }, title: 'Show ' + r.team.name },
      h('td', { text: i + 1 }), h('td', { class: 'l', text: r.team.name }), cols.map((c) => h('td', null, c.k === sortK ? h('b', { text: fmt(c.f(r.a, r.o), c.d) }) : fmt(c.f(r.a, r.o), c.d)))))))),
    h('p', { class: 'note', text: 'Ball wins = tackles + interceptions + recoveries. High numbers can mean a team presses hard, or simply that it spends a lot of time without the ball, so read them next to possession and the opponent pass figures.' })));

  // By match: ball wins for and against
  const ok = ms.filter((m) => has(winsOf(m.ts[T])));
  if (ok.length >= 2) {
    const c = card('Ball wins by match', `${teamName(T)} and their opponents · tackles + interceptions + recoveries`);
    const box = h('div');
    c.append(box);
    grid.append(c);
    const B = css('--ink-2');
    lineChart(box, {
      labels: ok.map((m) => roundLabel(m)),
      series: [{ name: teamName(T), color: A, values: ok.map((m) => winsOf(m.ts[T])) }, { name: 'Opponent', color: B, dash: '5 4', values: ok.map((m) => (has(winsOf(m.ts[oppOf(m, T)])) ? winsOf(m.ts[oppOf(m, T)]) : 0)) }],
      yFmt: (v) => v.toFixed(0),
      tipFor: (i) => { const m = ok[i], O = oppOf(m, T); return [{ v: matchLabel(m, T) }, { v: `${result(m, T)} ${goalsFor(m, T)}–${goalsAg(m, T)}`, strong: true }, { color: A, v: fmt(winsOf(m.ts[T]), 0), l: teamName(T) }, { color: B, v: fmt(winsOf(m.ts[O]), 0), l: teamName(O) }, has(m.ts[O].pa) && m.ts[O].pa ? { v: `Opponent pass completion ${fmt(100 * safe(m.ts[O].pc, m.ts[O].pa), 0)}%` } : null].filter(Boolean); },
    });
    c.append(legend([[teamName(T), A, 'line'], ['Opponent', B, 'line line-dash']]));
  }

  // Players: ball-winners per 90, with league percentile among outfield players
  if (!DB.hasPlayers) return;
  const pool = memo('bwpool|' + S.venue + '|' + leagueRange(), () => Object.values(DB.players).filter((p) => p.group !== 'GK').map((p) => {
    const pa = aggPlayer(scoped(p.team, leagueRange()), p.id);
    return { p, v: pa.min >= 270 ? safe(winsOf(pa) * 90, pa.min) : NaN };
  }).filter((x) => has(x.v)).map((x) => x.v).sort((x, y) => x - y));
  const pctile = (v) => (pool.length >= 10 && has(v) ? Math.round((100 * pool.filter((x) => x < v).length) / pool.length) : null);
  const pls = Object.values(DB.players).filter((p) => p.team === T && p.group !== 'GK').map((p) => ({ p, a: aggPlayer(ms, p.id) })).filter((x) => x.a.min >= 90 && has(winsOf(x.a)));
  if (!pls.length) return;
  const per = (v, min) => safe(v * 90, min);
  pls.sort((x, y) => per(winsOf(y.a), y.a.min) - per(winsOf(x.a), x.a.min));
  const hasRec = pls.some((x) => has(x.a.rec)), hasDuel = pls.some((x) => has(x.a.duel) && x.a.duel);
  const headers = ['Player', 'Min', 'Ball wins /90', 'League pct', 'Tkl /90', 'Int /90'].concat(hasRec ? ['Rec /90'] : [], hasDuel ? ['Duel %'] : [], ['Fouls /90']);
  grid.append(card({ title: 'Ball-winners', span: true }, `${teamName(T)} outfield players with 90+ minutes · league percentile among outfield players with 270+ minutes`,
    h('div', { class: 'tbl-wrap' }, h('table', null, h('thead', null, h('tr', null, headers.map((c, j) => h('th', { class: j === 0 ? 'l' : '', text: c })))),
      h('tbody', null, pls.map(({ p, a: pa }) => {
        const w = per(winsOf(pa), pa.min), pc = pctile(w);
        return h('tr', { onclick: () => { S.tab = 'players'; S.player = p.id; render(); window.scrollTo({ top: 0 }); }, title: 'Open ' + p.name },
          h('td', { class: 'l', text: p.name }), h('td', { text: pa.min }), h('td', null, h('b', { text: fmt(w, 2) })), h('td', { text: pc == null ? '–' : ordinal(pc) }),
          h('td', { text: fmt(per(pa.tkl, pa.min), 2) }), h('td', { text: fmt(per(pa.int, pa.min), 2) }), hasRec ? h('td', { text: fmt(per(pa.rec, pa.min), 2) }) : null,
          hasDuel ? h('td', { text: pa.duel ? fmt((100 * pa.duelW) / pa.duel, 0) : '–' }) : null, h('td', { text: fmt(per(pa.fls, pa.min), 2) }));
      }))))));
}

/* ---------- Built-in StatsBomb sample (builds made with --with-snapshot) ---------- */
const SAMPLE = typeof SAMPLE_EVENTS !== 'undefined' ? SAMPLE_EVENTS : null;
let SAMPLE_DB = null;
function eventsDB(b) {
  const db = prepareDB(JSON.parse(JSON.stringify(b.db)));
  db.source = 'sample';
  db.label = 'StatsBomb · ' + b.label;
  return db;
}
function loadSample() {
  if (!SAMPLE) return false;
  DB = SAMPLE_DB = SAMPLE_DB || eventsDB(SAMPLE);
  cache.clear();
  const sco = DB.teams.find((t) => /scotland/i.test(t.name));
  S.team = sco ? sco.id : DB.teams[0].id;
  S.cmp = (DB.teams.find((t) => t.id !== S.team) || DB.teams[0]).id;
  S.range = 'season'; S.player = null; S.match = null; S.pA = S.pB = null; S.form = null; S.opp = null; S.loss = null; S.comp = 'league';
  return true;
}
