'use strict';
/* =====================================================================
   Key players
   Rates each player against league players in the same position, per 90
   minutes, in seven areas, then weights the areas by position and the
   result by how much the player has played. Only stats the loaded data
   has are used, so the same tab works with Sportmonks, API-Football,
   StatsBomb, FBref or the demo season.
   ===================================================================== */

const minFor = (a, k) => (a._min && has(a._min[k]) ? a._min[k] : a.min); // multi-season totals: minutes in the seasons that recorded k
const p90 = (k) => (a) => (has(a[k]) ? safe(a[k] * 90, minFor(a, k)) : NaN);
const rate = (n, d) => (a) => (has(a[n]) && has(a[d]) && a[d] > 0 ? (100 * a[n]) / a[d] : NaN);
// k, label, value from the player's totals, direction (1 higher is better), area, and the total shown in leaderboards
const KP_METRICS = [
  { k: 'g', l: 'Goals', f: p90('g'), cat: 'attack', tot: 'g' },
  { k: 'xg', l: 'xG', f: p90('xg'), cat: 'attack', tot: 'xg', d: 1 },
  { k: 'ast', l: 'Assists', f: p90('ast'), cat: 'attack', tot: 'ast' },
  { k: 'sot', l: 'Shots on target', f: p90('sot'), cat: 'attack', tot: 'sot' },
  { k: 'key', l: 'Key passes', f: p90('key'), cat: 'create', tot: 'key' },
  { k: 'bcc', l: 'Big chances created', f: p90('bcc'), cat: 'create', tot: 'bcc' },
  { k: 'xa', l: 'xA', f: p90('xa'), cat: 'create', tot: 'xa', d: 1 },
  { k: 'drbW', l: 'Successful dribbles', f: p90('drbW'), cat: 'create', tot: 'drbW' },
  { k: 'prog', l: 'Progressive passes', f: p90('prog'), cat: 'create', tot: 'prog' },
  { k: 'f3p', l: 'Passes in the final third', f: p90('f3p'), cat: 'create', tot: 'f3p' },
  { k: 'pc', l: 'Passes completed', f: p90('pc'), cat: 'pass', tot: 'pc' },
  { k: 'pct', l: 'Pass completion %', f: rate('pc', 'pa'), cat: 'pass', pct: true },
  { k: 'lbW', l: 'Long balls completed', f: p90('lbW'), cat: 'pass', tot: 'lbW' },
  { k: 'tklW', l: 'Tackles won', f: p90('tklW'), cat: 'defend', tot: 'tklW' },
  { k: 'tkl', l: 'Tackles', f: (a) => (has(a.tklW) ? NaN : p90('tkl')(a)), cat: 'defend', tot: 'tkl' }, // only when tackles won are missing
  { k: 'int', l: 'Interceptions', f: p90('int'), cat: 'defend', tot: 'int' },
  { k: 'rec', l: 'Ball recoveries', f: p90('rec'), cat: 'defend', tot: 'rec' },
  { k: 'clr', l: 'Clearances', f: p90('clr'), cat: 'defend', tot: 'clr' },
  { k: 'blk', l: 'Shots blocked', f: p90('blk'), cat: 'defend', tot: 'blk' },
  { k: 'drbPast', good: 'Rarely dribbled past', l: 'Dribbled past', f: p90('drbPast'), cat: 'defend', dir: -1, tot: 'drbPast' },
  { k: 'duelW', l: 'Duels won', f: p90('duelW'), cat: 'duels', tot: 'duelW' },
  { k: 'duelPct', l: 'Duels won %', f: rate('duelW', 'duel'), cat: 'duels', pct: true },
  { k: 'aerW', l: 'Headers won (aerial duels)', f: p90('aerW'), cat: 'duels', tot: 'aerW' },
  { k: 'aerPct', l: 'Headers won %', f: (a) => (has(a.aerW) && has(a.aerL) && a.aerW + a.aerL >= 5 ? (100 * a.aerW) / (a.aerW + a.aerL) : NaN), cat: 'duels', pct: true },
  { k: 'pLost', good: 'Keeps the ball', l: 'Possession lost per 100 touches', f: rate('pLost', 'touch'), cat: 'secure', dir: -1 },
  { k: 'disp', good: 'Rarely dispossessed', l: 'Dispossessed', f: p90('disp'), cat: 'secure', dir: -1, tot: 'disp' },
  { k: 'err', good: 'Few costly errors', l: 'Errors leading to a shot or goal', f: (a) => (has(a.errSh) ? safe(((a.errSh || 0) + (has(a.errG) ? a.errG : 0)) * 90, minFor(a, 'errSh')) : NaN), cat: 'secure', dir: -1 },
  { k: 'onGD', l: 'Team goal difference while on', f: (a) => (has(a.onG) && has(a.onGA) ? safe((a.onG - a.onGA) * 90, minFor(a, 'onG')) : NaN), cat: 'impact' },
  { k: 'ppm', l: 'Team points per match played', f: (a) => ppmOf(a), cat: 'impact' },
  { k: 'rating', l: 'Average match rating', f: (a) => (a.rtN ? a.rt / a.rtN : NaN), cat: 'impact' },
  { k: 'savePct', l: 'Save %', f: (a) => (a.sota >= 5 ? (100 * a.saves) / a.sota : NaN), cat: 'keep', gk: true },
  { k: 'saves', l: 'Saves', f: p90('saves'), cat: 'keep', gk: true, tot: 'saves' },
  { k: 'gaK', good: 'Few goals conceded', l: 'Goals conceded', f: p90('gaK'), cat: 'keep', gk: true, dir: -1, tot: 'gaK' },
  { k: 'cs', l: 'Clean sheets per match', f: (a) => (has(a.cs) && a.n ? a.cs / a.n : NaN), cat: 'keep', gk: true },
];
const KP_CATS = [['attack', 'Goals'], ['create', 'Creating'], ['pass', 'Passing'], ['defend', 'Defending'], ['duels', 'Duels & headers'], ['secure', 'Ball security'], ['impact', 'Team impact'], ['keep', 'Goalkeeping']];
const KP_WEIGHTS = {
  GK: { keep: 0.55, pass: 0.15, impact: 0.3 },
  DEF: { defend: 0.28, duels: 0.24, pass: 0.14, secure: 0.1, create: 0.06, attack: 0.06, impact: 0.12 },
  MID: { pass: 0.18, create: 0.2, defend: 0.15, duels: 0.13, secure: 0.1, attack: 0.12, impact: 0.12 },
  FWD: { attack: 0.36, create: 0.2, duels: 0.12, secure: 0.08, pass: 0.06, defend: 0.06, impact: 0.12 },
};
const KP_MIN = 270; // minutes before a player counts as a comparison peer
const KP_SHRINK = 270; // few minutes pull a score towards average: weight = min / (min + 270)

// League peers per position: every player's per-90 value for every metric
function kpPeers() {
  return memo('kpPeers|' + S.venue + '|' + leagueRange(), () => {
    const out = { GK: {}, DEF: {}, MID: {}, FWD: {} };
    Object.values(DB.players).forEach((p) => {
      const a = aggPlayer(scoped(p.team, leagueRange()), p.id);
      if (!(a.min >= KP_MIN) || !out[p.group]) return;
      KP_METRICS.forEach((mt) => { const v = mt.f(a); if (has(v)) (out[p.group][mt.k] = out[p.group][mt.k] || []).push(v); });
    });
    Object.values(out).forEach((g) => Object.values(g).forEach((xs) => xs.sort((x, y) => x - y)));
    return out;
  });
}
function kpPct(sorted, v, dir) {
  if (!sorted || sorted.length < 5 || !has(v)) return NaN;
  let lo = 0, eq = 0;
  sorted.forEach((x) => { if (x < v) lo++; else if (x === v) eq++; });
  const p = (100 * (lo + eq / 2)) / sorted.length;
  return dir === -1 ? 100 - p : p;
}
function kpAssess(p, ms, teamMin) { return kpScore(p, aggPlayer(ms, p.id), kpPeers()[p.group] || {}, teamMin); }
function kpScore(p, a, peers, teamMin, period) {
  const w = a.min / (a.min + KP_SHRINK);
  const metrics = KP_METRICS.filter((mt) => !!mt.gk === (p.group === 'GK') || mt.cat === 'impact' || (p.group === 'GK' && mt.cat === 'pass')).map((mt) => {
    const v = mt.f(a), raw = kpPct(peers[mt.k], v, mt.dir || 1);
    return { mt, v, raw, pct: has(raw) ? 50 + (raw - 50) * w : NaN };
  }).filter((x) => has(x.pct));
  const cats = {};
  KP_CATS.forEach(([c]) => { const xs = metrics.filter((x) => x.mt.cat === c); if (xs.length) cats[c] = xs.reduce((s, x) => s + x.pct, 0) / xs.length; });
  const wts = KP_WEIGHTS[p.group] || KP_WEIGHTS.MID;
  let sw = 0, sum = 0;
  Object.entries(wts).forEach(([c, wt]) => { if (has(cats[c])) { sum += cats[c] * wt; sw += wt; } });
  const perf = sw ? sum / sw : NaN;
  const share = teamMin ? Math.min(1, a.min / teamMin) : 0;
  // Over several seasons playing time weighs more: influence over a decade needs the minutes, not one good spell
  const k = period ? 0.2 + 0.8 * Math.sqrt(share) : 0.4 + 0.6 * share;
  return { p, a, metrics, cats, perf, share, areas: Object.keys(cats).length, imp: has(perf) ? perf * k : NaN };
}

function viewKey(el) {
  const T = S.team, ms = scoped(T);
  if (!DB.hasPlayers) return missingNote('Key players', 'Player stats', el);
  const opts = kpPeriodOptions();
  const nSeasons = opts.some(([v]) => v === S.kpPeriod) ? +S.kpPeriod : 1;
  let rows, peerN, all, sub, cover = null;
  // A player from earlier seasons opens in the last season they played for the club
  const open = (pl) => {
    const pid = typeof pl === 'string' ? pl : pl.id;
    if (!DB.players[pid] && !(pl.season && pl.season !== DB.season && loadSeason(pl.season) && DB.players[pid])) return;
    S.tab = 'players'; S.player = pid; render(); window.scrollTo({ top: 0 });
  };
  const profTitle = (pl) => 'Open ' + pl.name + (pl.season && !DB.players[pl.id] ? ' (profile from ' + pl.season + ', their last season here)' : '');
  if (nSeasons > 1) {
    const P = kpPeriod(T, nSeasons);
    rows = P.rows; peerN = P.peerN; all = P.rows; cover = P.seasons;
    sub = `${P.seasons[P.seasons.length - 1].season} to ${P.seasons[0].season} · ${P.seasons.length} seasons · league matches`;
  } else {
    const teamMin = ms.length * 90;
    rows = Object.values(DB.players).filter((p) => p.team === T).map((p) => kpAssess(p, ms, teamMin)).filter((r) => r.a.min >= 90 && has(r.perf));
    peerN = Object.values(kpPeers()).reduce((s, g) => Math.max(s, ...Object.values(g).map((xs) => xs.length)), 0);
    all = Object.values(DB.players).filter((p) => p.team === T).map((p) => ({ p, a: aggPlayer(ms, p.id) })).filter((x) => x.a.min > 0);
    sub = rangeLabel() + ' · ' + ms.length + (ms.length === 1 ? ' match' : ' matches');
  }
  el.append(h('div', { class: 'hero' }, h('h1', { text: teamName(T) }), h('div', { class: 'meta' }, h('span', { text: sub + ' · key players' }))));
  if (opts.length > 1) el.append(h('div', { class: 'kp-period' }, h('span', { class: 'eyebrow', text: 'Over' }), seg(opts, String(nSeasons), (v) => { S.kpPeriod = v; render(); }, 'Period')));
  if (cover) {
    const basic = cover.filter((x) => !x.detail).map((x) => x.season);
    el.append(h('p', { class: 'note', style: { margin: '-6px 0 14px' }, text: `Totals across ${cover.map((x) => seasonShort(x.season)).join(', ')}, compared with every league player over the same seasons.` + (basic.length ? ` ${basic.join(' and ')} ${basic.length > 1 ? 'have' : 'has'} only minutes, goals, assists, cards and goals conceded, so other stats count the detailed seasons only.` : '') + ' Players are matched by club and name, so a player listed under a different spelling in another season counts as two.' }));
  }
  if (!rows.length) { el.append(card({ title: 'Key players', span: true }, null, h('p', { class: 'note', style: { marginTop: 0 }, text: 'No player has 90 minutes with enough stats to rate yet.' }))); return; }
  rows.sort((x, y) => y.imp - x.imp);

  // Top five
  el.append(h('div', { class: 'mvp-row' }, rows.slice(0, 5).map((r, i) => {
    const wts = KP_WEIGHTS[r.p.group] || KP_WEIGHTS.MID; // strengths from the areas that matter most for the position
    const best = r.metrics.filter((x) => x.pct >= 60 && (wts[x.mt.cat] || 0) >= 0.1).sort((x, y) => y.pct - x.pct).slice(0, 3);
    const tile = h('button', { type: 'button', class: 'mvp', onclick: () => open(r.p), title: profTitle(r.p) },
      h('div', { class: 'eyebrow', text: '#' + (i + 1) + ' · ' + (r.p.role || r.p.group) }),
      h('div', { class: 'mvp-name', text: r.p.name }),
      h('div', { class: 'mvp-score' }, h('b', { text: Math.round(r.imp) }), h('span', { text: 'importance' })),
      h('div', { class: 'mvp-bar' }, h('i', { style: { width: Math.round(100 * r.share) + '%' } })),
      h('div', { class: 'sub', text: `${Math.round(100 * r.share)}% of minutes · performance ${Math.round(r.perf)}` + (r.seasons ? ` · ${r.seasons} season${r.seasons > 1 ? 's' : ''}` : '') }),
      h('ul', null, best.map((x) => h('li', { text: `${x.mt.good || x.mt.l}: ${ordinal(Math.round(x.raw))} percentile` }))));
    return tile;
  })));

  const grid = h('div', { class: 'grid' });
  el.append(grid);

  // Ranking table with area scores
  const cats = KP_CATS.filter(([c]) => rows.some((r) => has(r.cats[c])));
  const cell = (v) => {
    if (!has(v)) return h('td', { class: 'sub', text: '–' });
    const t = clamp((v - 50) / 50, -1, 1);
    const col = t >= 0 ? `rgba(${rgbOf(css('--good')).join(',')},${(0.12 + 0.5 * t).toFixed(2)})` : `rgba(${rgbOf(css('--bad')).join(',')},${(0.12 - 0.5 * t).toFixed(2)})`;
    return h('td', { style: { background: Math.abs(t) < 0.1 ? 'transparent' : col }, text: Math.round(v) });
  };
  grid.append(card({ title: 'Squad ranking', span: true }, `Importance = performance × playing time · area scores are percentiles against league players in the same position (50 = average) · click a player for the full profile`,
    h('div', { class: 'tbl-wrap' }, h('table', { class: 'kp-table' },
      h('thead', null, h('tr', null, h('th', { text: '#' }), h('th', { class: 'l', text: 'Player' }), h('th', { text: 'Pos' }), cover ? h('th', { text: 'Seasons' }) : null, h('th', { text: 'Min %' }), h('th', { text: 'Importance' }), h('th', { text: 'Performance' }), cats.map(([, l]) => h('th', { text: l })))),
      h('tbody', null, rows.map((r, i) => h('tr', { onclick: () => open(r.p), title: profTitle(r.p) },
        h('td', { text: i + 1 }), h('td', { class: 'l', text: r.p.name }), h('td', { class: 'sub', text: r.p.role || r.p.group }), cover ? h('td', { text: r.seasons }) : null, h('td', { text: Math.round(100 * r.share) }),
        h('td', null, h('b', { text: Math.round(r.imp) })), h('td', { title: r.areas < 4 ? 'Rated on goals and results only (seasons before detailed stats)' : null, text: Math.round(r.perf) + (r.areas < 4 ? ' *' : '') }), cats.map(([c]) => cell(r.cats[c]))))))),
    h('p', { class: 'note', text: `Compared with ${peerN ? 'up to ' + peerN : 'the'} league players per position with ${cover ? KP_MIN_PERIOD : KP_MIN}+ minutes. Players with few minutes are pulled towards average (50) so a good half-hour does not top the list. Importance multiplies performance by ${cover ? '(0.2 + 0.8 × √share of the team’s minutes over the period), so long-serving regulars count for more' : '(0.4 + 0.6 × share of the team’s minutes), so regulars count for more'}.` + (rows.some((r) => r.areas < 4) ? ' * Rated on goals, discipline and team results only: those seasons have no detailed stats.' : '') })));

  // Leaderboards: what the user asked for, as totals and per 90
  const hasTklW = rows.some((r) => has(r.a.tklW));
  const boards = KP_METRICS.filter((mt) => mt.tot && !mt.gk && mt.dir !== -1 && !(mt.k === 'tkl' && hasTklW) && rows.some((r) => has(r.a[mt.tot]) && r.a[mt.tot] > 0));
  const order = ['g', 'ast', 'tklW', 'tkl', 'pc', 'duelW', 'aerW', 'key', 'bcc', 'int', 'rec', 'xg', 'xa', 'sot', 'clr', 'blk', 'drbW', 'prog', 'f3p', 'lbW'];
  boards.sort((x, y) => order.indexOf(x.k) - order.indexOf(y.k));
  grid.append(card({ title: 'Squad leaders', span: true }, (cover ? sub : rangeLabel()) + ' · totals, with per 90 minutes in brackets', h('div', { class: 'grid three' }, boards.map((mt) => {
    const top = all.filter((x) => has(x.a[mt.tot]) && x.a[mt.tot] > 0).sort((x, y) => y.a[mt.tot] - x.a[mt.tot]).slice(0, 3);
    const dp = mt.d || 0;
    return h('div', null, h('div', { class: 'eyebrow', text: mt.l }), h('ol', { class: 'kp-list' }, top.map((x) => h('li', null,
      h('a', { href: '#players', onclick: (e) => { e.preventDefault(); open(x.p); }, title: profTitle(x.p), text: x.p.name }),
      h('span', { class: 'sub', text: ` ${x.a[mt.tot].toFixed(dp)} (${safe(x.a[mt.tot] * 90, minFor(x.a, mt.tot)).toFixed(2)})` })))));
  }))));

  if (!cover) improvement(grid, T, ms);

  // Results with and without (starts from line-ups)
  if (!cover && DB.hasLineups && ms.length >= 4) {
    const pts = (m) => { const f = goalsFor(m, T), g = goalsAg(m, T); return f > g ? 3 : f === g ? 1 : 0; };
    const rw = rows.map((r) => {
      const st = ms.filter((m) => (m.lineups[T] || []).some((l) => l.pid === r.p.id)), not = ms.filter((m) => !st.includes(m));
      return { r, st: st.length, not: not.length, a: st.length ? st.reduce((s, m) => s + pts(m), 0) / st.length : NaN, b: not.length ? not.reduce((s, m) => s + pts(m), 0) / not.length : NaN };
    }).filter((x) => x.st >= 2 && x.not >= 2).sort((x, y) => (y.a - y.b) - (x.a - x.b));
    if (rw.length) grid.append(card({ title: 'Results with and without', span: true }, 'Team points per match when the player starts and when he does not · small samples, so read as a hint, not proof',
      h('div', { class: 'tbl-wrap' }, h('table', null, h('thead', null, h('tr', null, ['Player', 'Starts', 'Pts / match when starting', 'Other matches', 'Pts / match otherwise', 'Difference'].map((c, j) => h('th', { class: j === 0 ? 'l' : '', text: c })))),
        h('tbody', null, rw.map((x) => h('tr', { onclick: () => open(x.r.p.id) }, h('td', { class: 'l', text: x.r.p.name }), h('td', { text: x.st }), h('td', { text: fmt(x.a, 2) }), h('td', { text: x.not }), h('td', { text: fmt(x.b, 2) }), h('td', null, h('b', { text: signed(x.a - x.b, 2) })))))))));
  }

  // Method
  const used = KP_CATS.filter(([c]) => rows.some((r) => has(r.cats[c]))).map(([c, l]) => `${l}: ${KP_METRICS.filter((mt) => mt.cat === c && rows.some((r) => r.metrics.some((x) => x.mt === mt))).map((mt) => mt.l.toLowerCase()).join(', ')}`);
  grid.append(card({ title: 'How the scores work', span: true }, null, h('div', { class: 'prose' },
    h('p', null, 'Each player is compared with league players in the same position (goalkeepers, defenders, midfielders, forwards), per 90 minutes, on the stats this data has. A percentile of 80 means better than 80% of them. Each area’s score is the average of its percentiles.'),
    h('ul', null, used.map((u) => h('li', { text: u }))),
    h('p', null, 'Performance weights the areas by position: defenders mostly on defending and duels, midfielders on passing, creating and defending, forwards on goals and creating, goalkeepers on saves and goals conceded. Team impact (goal difference while on, points per match, match rating) counts for every position.'),
    h('p', null, 'What it cannot see: off-the-ball work, positioning, pressing without a tackle, and the quality of chances (no player xG in this data). Treat it as a summary of the numbers, not a verdict.'))));
}

/* ---------- Several seasons ---------- */
const KP_MIN_PERIOD = 600;
// Seasons with player stats, newest first, from the season on screen back
function kpPlayerSeasons() {
  return allSeasons().filter((x) => x.season <= (DB.season || '9999')).filter((x) => (x.current ? x.db.hasPlayers : x.entry.layers.length || x.entry.summary));
}
function kpPeriodOptions() {
  if (!DB.season || !(DB === SEASONS.real || DB.pastSeason)) return [];
  const n = kpPlayerSeasons().length;
  if (n < 2) return [];
  const o = [['1', 'This season']];
  [3, 5, 8, 10].forEach((k) => { if (k < n) o.push([String(k), k + ' seasons']); });
  o.push([String(n), (n > 10 ? 'All ' : '') + n + ' seasons' + (n > 10 ? '' : ' (all)')]);
  return o.filter((x, i, a) => a.findIndex((y) => y[0] === x[0]) === i);
}
// Every league player's totals summed over n seasons, keyed by club + name
function kpPeriod(T, n) {
  const seasons = kpPlayerSeasons().slice(0, n);
  return memo('kpPeriod|' + seasons.map((x) => x.season).join(',') + '|' + fbTeamKey(teamName(T)), () => {
    const players = {}, teamMin = {};
    const keep = aggPlayer.season;
    const cover = seasons.map((x) => {
      const db = x.current ? x.db : seasonDB(x.season);
      aggPlayer.season = db.seasonPS || null;
      const tk = (id) => fbTeamKey(db.teamById[id] ? db.teamById[id].name : id);
      db.matches.forEach((m) => [m.home, m.away].forEach((id) => (teamMin[tk(id)] = (teamMin[tk(id)] || 0) + 90)));
      let detail = false;
      Object.values(db.players).forEach((p) => {
        const a = aggPlayer(db.matches, p.id);
        if (!(a.min > 0) || !db.teamById[p.team]) return;
        if (has(a.pa)) detail = true;
        const pre = 'pl-' + p.team + '-', key = tk(p.team) + '|' + (p.id.startsWith(pre) ? p.id.slice(pre.length) : playerKey('', p.name).slice(4));
        const m = (players[key] = players[key] || { p: { id: p.id, name: p.name, group: p.group, role: p.role, team: tk(p.team), season: x.season }, a: { n: 0, min: 0, st: 0, _min: {} }, seasons: 0 });
        m.seasons++;
        Object.entries(a).forEach(([k, v]) => {
          if (k === 'ppm' || typeof v !== 'number' || !has(v)) return; // ppm is a rate; the rest are totals
          m.a[k] = (k in m.a ? m.a[k] : 0) + v;
          if (k !== 'n' && k !== 'min' && k !== 'st') m.a._min[k] = (m.a._min[k] || 0) + a.min;
        });
      });
      return { season: x.season, detail };
    });
    aggPlayer.season = keep;
    // Older seasons shorten first names ("A. Rooney"): fold those into the one full name at the club
    // with the same initial and surname
    const words = (n) => String(n || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z\s.]/g, '').split(/[\s.]+/).filter(Boolean);
    Object.entries(players).forEach(([k, x]) => {
      const w = words(x.p.name);
      if (!(w.length === 2 && w[0].length === 1 && /\.\s/.test(x.p.name))) return;
      const hits = Object.entries(players).filter(([k2, y]) => k2 !== k && y.p.team === x.p.team && (() => { const v = words(y.p.name); return v.length >= 2 && v[0].length > 1 && v[0][0] === w[0] && v[v.length - 1] === w[1]; })());
      if (hits.length !== 1) return;
      const [, y] = hits[0];
      Object.entries(x.a).forEach(([f, v]) => { if (f === '_min') Object.entries(v).forEach(([f2, mv]) => (y.a._min[f2] = (y.a._min[f2] || 0) + mv)); else if (typeof v === 'number') y.a[f] = (y.a[f] || 0) + v; });
      y.seasons += x.seasons;
      delete players[k];
    });
    const peers = { GK: {}, DEF: {}, MID: {}, FWD: {} };
    Object.values(players).forEach((x) => {
      if (!(x.a.min >= KP_MIN_PERIOD) || !peers[x.p.group]) return;
      KP_METRICS.forEach((mt) => { const v = mt.f(x.a); if (has(v)) (peers[x.p.group][mt.k] = peers[x.p.group][mt.k] || []).push(v); });
    });
    Object.values(peers).forEach((g) => Object.values(g).forEach((xs) => xs.sort((a, b) => a - b)));
    const tkT = fbTeamKey(teamName(T)), tMin = teamMin[tkT] || 1;
    const rows = Object.values(players).filter((x) => x.p.team === tkT && x.a.min >= 270).map((x) => ({ ...kpScore(x.p, x.a, peers[x.p.group] || {}, tMin, true), seasons: x.seasons })).filter((r) => has(r.perf));
    const peerN = Object.values(peers).reduce((s, g) => Math.max(s, ...Object.values(g).map((xs) => xs.length)), 0);
    return { rows, peerN, seasons: cover };
  });
}

/* ---------- Season improvement ---------- */
// Per-match values need per-match player stats (Sportmonks, API-Football, StatsBomb, demo)
const IMP_MIN = 30; // minutes in a match before it counts
const IMP_METRICS = [
  { k: 'rating', l: 'Match rating', f: (s) => (s.rtN ? s.rt / s.rtN : NaN), d: 2 },
  { k: 'wins', l: 'Ball wins /90', f: (s) => (has(s.tkl) && has(s.int) ? ((s.tkl + s.int + (has(s.rec) ? s.rec : 0)) * 90) / s.min : NaN), d: 1 },
  { k: 'pc', l: 'Passes completed /90', f: (s) => (has(s.pc) ? (s.pc * 90) / s.min : NaN), d: 1 },
  { k: 'pct', l: 'Pass completion %', f: (s) => (has(s.pc) && s.pa >= 5 ? (100 * s.pc) / s.pa : NaN), d: 1 },
  { k: 'duel', l: 'Duels won %', f: (s) => (has(s.duelW) && s.duel >= 3 ? (100 * s.duelW) / s.duel : NaN), d: 1 },
  { k: 'aerW', l: 'Headers won /90', f: (s) => (has(s.aerW) ? (s.aerW * 90) / s.min : NaN), d: 2 },
  { k: 'key', l: 'Key passes /90', f: (s) => (has(s.key) ? (s.key * 90) / s.min : NaN), d: 2 },
  { k: 'sh', l: 'Shots /90', f: (s) => (has(s.sh) ? (s.sh * 90) / s.min : NaN), d: 2 },
];
function impSeries(ms, pid, mt) {
  return ms.map((m) => { const s = m.ps[pid]; return s && s.min >= IMP_MIN ? { m, v: mt.f(s) } : null; }).filter((x) => x && has(x.v));
}
const step10 = (v) => (Math.abs(v - Math.round(v)) < 1e-6 ? 0 : Math.abs(v * 10 - Math.round(v * 10)) < 1e-6 ? 1 : 2);
function rolling(vals, k = 3) { return vals.map((_, i) => { const w = vals.slice(Math.max(0, i - k + 1), i + 1); return w.reduce((a, b) => a + b, 0) / w.length; }); }

function improvement(el, T, allMs) {
  const ms = allMs.filter((m) => Object.keys(m.ps || {}).length);
  const pids = Object.values(DB.players).filter((p) => p.team === T && ms.some((m) => m.ps[p.id] && m.ps[p.id].min >= IMP_MIN));
  const mets = IMP_METRICS.filter((mt) => pids.some((p) => impSeries(ms, p.id, mt).length >= 4));
  if (ms.length < 4 || !mets.length) return;
  const mt = mets.find((x) => x.k === S.impMetric) || mets[0];
  // Early vs recent: first half of a player's qualifying matches against the second half
  const rows = pids.map((p) => {
    const ser = impSeries(ms, p.id, mt);
    if (ser.length < 4) return null;
    const half = Math.floor(ser.length / 2), early = avgOf(ser.slice(0, half).map((x) => x.v)), late = avgOf(ser.slice(-half).map((x) => x.v));
    return { p, ser, early, late, d: late - early };
  }).filter(Boolean).sort((a, b) => b.d - a.d);
  if (!rows.length) return;
  const sel = rows.find((r) => r.p.id === S.impPlayer) || rows[0];
  const tools = seg(mets.map((x) => [x.k, x.l]), mt.k, (v) => { S.impMetric = v; render(); }, 'Stat');
  const maxD = Math.max(...rows.map((r) => Math.abs(r.d)), 1e-6);
  const good = css('--good'), bad = css('--bad');
  const bars = h('div', { class: 'delta-bars' }, rows.map((r) => {
    const w = (50 * Math.abs(r.d)) / maxD;
    const row = h('button', { type: 'button', class: 'delta-row' + (r === sel ? ' on' : ''), onclick: () => { S.impPlayer = r.p.id; render(); } },
      h('span', { class: 'delta-name', text: r.p.name }),
      h('span', { class: 'delta-track' }, h('i', { style: { left: r.d >= 0 ? '50%' : 50 - w + '%', width: w + '%', background: r.d >= 0 ? good : bad } })),
      h('span', { class: 'delta-val', text: signed(r.d, mt.d) }));
    hover(row, () => [{ v: r.p.name, strong: true }, { v: `${mt.l}: ${fmt(r.early, mt.d)} in his first ${Math.floor(r.ser.length / 2)} matches → ${fmt(r.late, mt.d)} in his last ${Math.floor(r.ser.length / 2)}` }, { v: r.ser.length + ' matches with ' + IMP_MIN + '+ minutes' }]);
    return row;
  }));
  el.append(card({ title: 'Season improvement', span: true, tools }, `${mt.l}: average in each player’s first half of matches against his most recent half · players with 4+ matches of ${IMP_MIN}+ minutes · click a player for his trend`, bars,
    h('p', { class: 'note', text: 'Like the lap-time gains in F1 coverage: green bars are players getting better, red getting worse. With only a handful of matches each, one very good or bad game moves a bar a lot, and opponents differ, so treat small changes as noise.' })));

  // Trend chart: the selected player, match by match, against the team average for the same stat
  const c = card(`${sel.p.name}: ${mt.l.toLowerCase()} through the season`, 'Dots are single matches · line is the 3-match rolling average · dashed line is the team average for players with 30+ minutes in that match');
  const box = h('div');
  c.append(box);
  el.append(c);
  const teamAvg = (m) => avgOf(Object.entries(m.ps).filter(([id, s]) => DB.players[id] && DB.players[id].team === T && s.min >= IMP_MIN).map(([, s]) => mt.f(s)).filter(has));
  const vals = sel.ser.map((x) => x.v), roll = rolling(vals), A = css('--team-a'), B = css('--ink-2');
  lineChart(box, {
    labels: sel.ser.map((x) => roundLabel(x.m)),
    series: [{ name: '3-match average', color: A, values: roll, points: vals }, { name: 'Team average', color: B, dash: '5 4', values: sel.ser.map((x) => (has(teamAvg(x.m)) ? teamAvg(x.m) : 0)) }],
    yFmt: (v) => v.toFixed(step10(v)), zero: false,
    tipFor: (i) => { const x = sel.ser[i]; return [{ v: matchLabel(x.m, T) }, { v: `${result(x.m, T)} ${goalsFor(x.m, T)}–${goalsAg(x.m, T)} · ${x.m.ps[sel.p.id].min} min`, strong: true }, { color: A, v: fmt(x.v, mt.d), l: 'this match' }, { color: A, v: fmt(roll[i], mt.d), l: '3-match average' }, { color: B, v: fmt(teamAvg(x.m), mt.d), l: 'team average' }]; },
  });
  const first = avgOf(vals.slice(0, Math.floor(vals.length / 2))), last = avgOf(vals.slice(-Math.floor(vals.length / 2)));
  c.append(legend([['3-match average', A, 'line'], ['Single match', A + '55'], ['Team average', B, 'line line-dash']]),
    h('div', { class: 'statline', style: { marginTop: '10px' } }, [[fmt(first, mt.d), 'Early matches'], [fmt(last, mt.d), 'Recent matches'], [signed(last - first, mt.d), 'Change'], [vals.length, 'Matches']].map(([v, l]) => h('div', null, h('b', { text: v }), h('span', { text: l })))));
}
