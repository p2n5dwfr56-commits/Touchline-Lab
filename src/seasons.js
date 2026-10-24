'use strict';
/* =====================================================================
   Seasons
   Past seasons come from football-data.co.uk files (results, shots,
   corners, cards, odds) and, where downloaded, Sportmonks files (line-ups,
   events and player stats). Built-in ones ship with snapshot builds; ones
   you drop in are saved in this browser. Picking a past season shows it in
   every tab; the Seasons tab compares them.
   ===================================================================== */

const SEASONS = { list: [], real: null };
const SEASON_DB = {};
// "2025/2026" (Sportmonks) or "2025/26" -> "2025/26"
const seasonKey = (s) => { const m = String(s || '').match(/(\d{4})\s*[/-]\s*(\d{2,4})/); return m ? m[1] + '/' + m[2].slice(-2) : ''; };
const seasonShort = (s) => (s ? s.slice(2, 4) + '/' + s.slice(-2) : '');

async function refreshSeasons() {
  const m = {};
  ((SNAP && SNAP.past) || []).forEach((x) => (m[x.season] = { season: x.season, primary: x.primary, layers: x.layers || [], summary: x.summary || null, src: 'built-in' }));
  const saved = await pastGet();
  Object.entries(saved).forEach(([k, v]) => {
    const base = m[k] || { season: k, primary: [], layers: [] };
    const names = new Set((v.layers || []).map((l) => l.name));
    m[k] = { season: k, summary: base.summary || null, primary: v.primary && v.primary.length ? v.primary : base.primary, layers: base.layers.filter((l) => !names.has(l.name)).concat(v.layers || []), src: v.primary && v.primary.length ? 'saved' : base.src, savedLayers: (v.layers || []).length, saved: true };
  });
  SEASONS.list = Object.values(m).filter((x) => x.primary && x.primary.length).sort((a, b) => b.season.localeCompare(a.season));
}
// Built once per season and kept, so switching back and forth is instant
function seasonDB(season) {
  if (SEASON_DB[season]) return SEASON_DB[season];
  const e = SEASONS.list.find((x) => x.season === season);
  if (!e) return null;
  const { db } = importFootballData(e.primary.map((f) => ({ name: f.name, rows: fdParseCSV(f.text) })));
  if (!db.matches.length) return null;
  prepareDB(db);
  e.layers.forEach((l) => { try { const b = JSON.parse(l.text); if (smIsBundle(b)) attachSportmonks(db, b); else if (afCupLeague([{ data: b }])) attachApiFootballCups(db, [{ name: l.name, data: b }]); } catch (err) { /* skip a damaged file */ } });
  // Built-in older seasons carry player season totals instead of every match
  if (e.summary && !e.layers.length) {
    db.seasonPS = {};
    Object.entries(e.summary).forEach(([id, x]) => { if (!db.teamById[x.team]) return; db.players[id] = { id, team: x.team, name: x.name, group: x.group, role: x.role, num: x.num }; db.seasonPS[id] = x.a; });
    db.hasPlayers = Object.keys(db.players).length > 0;
    db.seasonSrc = 'Sportmonks season totals';
  }
  db.pastSeason = true; db.transient = true;
  return (SEASON_DB[season] = db);
}
// The current season's real data, remembered whenever it is on screen
function noteReal() {
  if (DB && !DB.transient && DB.source !== 'demo' && DB.source !== 'sample' && DB.season) SEASONS.real = DB;
}
function allSeasons() {
  const out = [];
  if (SEASONS.real) out.push({ season: SEASONS.real.season, db: SEASONS.real, current: true });
  SEASONS.list.forEach((e) => { if (!SEASONS.real || e.season !== SEASONS.real.season) out.push({ season: e.season, entry: e }); });
  return out.sort((a, b) => b.season.localeCompare(a.season));
}
function loadSeason(season) {
  const db = SEASONS.real && SEASONS.real.season === season ? SEASONS.real : seasonDB(season);
  if (!db) return false;
  const keepName = DB && DB.teamById && DB.teamById[S.team] ? fbTeamKey(DB.teamById[S.team].name) : 'aberdeen';
  DB = db;
  cache.clear();
  const t = DB.teams.find((x) => fbTeamKey(x.name) === keepName) || DB.teams.find((x) => /aberdeen/i.test(x.name)) || DB.teams[0];
  S.team = t.id; S.cmp = (DB.teams.find((x) => x.id !== S.team) || DB.teams[0]).id;
  S.range = 'season'; S.player = null; S.match = null; S.pA = S.pB = null; S.form = null; S.opp = null; S.loss = null; S.impPlayer = null; S.comp = 'league';
  return true;
}
function seasonSelect() {
  const all = allSeasons();
  if (all.length < 2 || !(DB === SEASONS.real || DB.pastSeason)) return null;
  return h('div', { class: 'field' }, h('label', { for: 'f-season', text: 'Season' }),
    h('select', { id: 'f-season', onchange: (e) => { if (loadSeason(e.target.value)) render(); } },
      all.map((x) => h('option', { value: x.season, selected: x.season === DB.season, text: x.season + (x.current ? ' (now)' : '') }))));
}

/* ---------- Seasons tab ---------- */
function seasonRow(db, key) {
  const t = db.teams.find((x) => fbTeamKey(x.name) === key);
  if (!t) return null;
  const table = leagueTable(db, null), r = table.find((x) => x.team.id === t.id);
  const ms = db.matches.filter((m) => m.home === t.id || m.away === t.id).sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  const a = aggTeam(ms, t.id);
  let pts = 0;
  const race = ms.map((m) => (pts += result(m, t.id) === 'W' ? 3 : result(m, t.id) === 'D' ? 1 : 0));
  return { db, t, pos: r ? r.pos : null, of: table.length, a, race, players: Object.keys(db.players || {}).length > 0 && !db.seasonSrc, champ: table[0] && table[0].team.name };
}
function viewSeasons(el) {
  const key = fbTeamKey(teamName(S.team));
  const all = allSeasons();
  const H = ((SEASONS.real && SEASONS.real.fbHistory) || DB.fbHistory || {})[key] || null; // FBref club history, when pasted
  const W = CLUBHIST[key] || null; // Wikipedia's list of the club's seasons, when loaded
  if (all.length < 2 && !H && !W) {
    el.append(card({ title: 'Seasons', span: true }, null, h('p', { class: 'note', style: { marginTop: 0 }, text: 'Only one season is loaded. Add earlier seasons in the Data tab (football-data.co.uk files, free) to compare them here.' })));
    return;
  }
  const rows = memo('seasons|' + key + '|' + all.length + '|' + (SEASONS.real ? SEASONS.real.matches.length : 0) + '|' + (H ? Object.keys(H.league).length : 0) + '|' + (W ? Object.keys(W.seasons).length : 0), () => {
    const out = all.map((x) => ({ ...x, r: seasonRow(x.db || seasonDB(x.season), key) })).filter((x) => x.r);
    // Older seasons from FBref's club history: results only
    if (H) Object.entries(H.league).forEach(([season, f]) => {
      if (out.some((x) => x.season === season) || f.mp == null) return;
      out.push({ season, fbOnly: true, r: { pos: f.pos, of: null, race: [], players: false, champ: null, a: { n: f.mp, w: f.w, d: f.d, l: f.l, g: f.gf, ga: f.ga, pts: f.pts, mxp: NaN, sh: NaN, sha: NaN, xg: NaN, xga: NaN } } });
    });
    // Older still, from Wikipedia's list of the club's seasons: record, position, cups, top scorer
    if (W) Object.values(W.seasons).forEach((w) => {
      if (out.some((x) => x.season === w.season)) return;
      if (w.pld == null) { out.push({ season: w.season, histOnly: 'Wikipedia', noteRow: w.note || w.division }); return; }
      out.push({ season: w.season, histOnly: 'Wikipedia', div: w.division, r: { pos: parseInt(w.pos, 10) || null, of: null, race: [], players: false, champ: parseInt(w.pos, 10) === 1 ? teamName(S.team) : null, a: { n: w.pld, w: w.w, d: w.d, l: w.l, g: w.gf, ga: w.ga, pts: w.pts, mxp: NaN, sh: NaN, sha: NaN, xg: NaN, xga: NaN } } });
    });
    return out.sort((a, b) => b.season.localeCompare(a.season));
  });
  el.append(h('div', { class: 'hero' }, h('h1', { text: teamName(S.team) }), h('div', { class: 'meta' }, h('span', { text: rows.filter((x) => !x.noteRow).length + ' league seasons' + (rows.length ? ' · ' + rows[rows.length - 1].season + ' to ' + rows[0].season : '') }))));
  if (!rows.length) { el.append(card({ title: 'Seasons', span: true }, null, h('p', { class: 'note', text: teamName(S.team) + ' is not in the other seasons loaded.' }))); return; }
  const grid = h('div', { class: 'grid' });
  el.append(grid);
  const A = css('--team-a');
  const asc = rows.filter((x) => !x.noteRow).slice().reverse();
  const lrows = rows.filter((x) => !x.noteRow);

  // Table
  const showMkt = lrows.some((x) => has(x.r.a.mxp)), showXg = lrows.some((x) => has(x.r.a.xg));
  const hl = (x) => (H && H.league[x.season]) || null, hs = (x) => (H && H.summary[x.season]) || null, hw = (x) => (W && W.seasons[x.season]) || null;
  const att = (v) => (v == null ? '–' : v < 500 ? 'closed doors' : v.toLocaleString('en-GB'));
  const attOf = (x) => { const a = ATT[x.season] && ATT[x.season][key]; const f = hl(x); return a ? att(a.att) : f ? att(f.att) : '–'; };
  const scorerOf = (x) => { const f = hl(x), w = hw(x); return f && f.scorer ? f.scorer : w && w.scorers ? w.scorers + (w.goals != null ? ' - ' + w.goals : '') : '–'; };
  const ppg3 = (a) => safe(3 * a.w + a.d, a.n); // 3 points for a win in every era, so seasons compare
  const hasHist = !!(H || W);
  const head = ['Season', 'Pos', 'P', 'W', 'D', 'L', 'GF', 'GA', 'GD', 'Pts', 'PPG'].concat(showMkt ? ['Mkt xPts / g'] : [], ['Shots / g', 'Shots ag / g'], showXg ? ['xG / g', 'xGA / g'] : [], hasHist ? ['Top league scorer', 'Avg attendance'] : [], W ? ['Scottish Cup', 'League Cup'] : [], hasHist ? ['In Europe'] : [], H ? ['Qualified for'] : [], ['Champions', '']);
  const ncol = head.length;
  grid.append(card({ title: 'Season by season', span: true }, `${teamName(S.team)} in the league · positions follow the split after 33 rounds · click a season to open it in every tab`,
    h('div', { class: 'tbl-wrap' }, h('table', null, h('thead', null, h('tr', null, head.map((c, i) => h('th', { class: i === 0 || i === head.length - 2 ? 'l' : '', text: c })))),
      h('tbody', null, rows.map((x) => {
        if (x.noteRow) return h('tr', { style: { cursor: 'default' } }, h('td', { class: 'l' }, h('b', { text: x.season })), h('td', { class: 'l sub', colspan: ncol - 1, text: x.noteRow }));
        const a = x.r.a, g = (v, d) => fmt(safe(v, a.n), d);
        const f = hl(x), su = hs(x), w = hw(x);
        const lower = x.div && !/prem|spl|div(ision)? ?(1|a|one)\b|sco div 1/i.test(x.div) ? ' (' + x.div.replace(/^sco\s*/i, '') + ')' : '';
        const old = x.fbOnly || x.histOnly;
        return h('tr', { class: x.season === DB.season ? 'focus' : '', style: old ? { cursor: 'default' } : null, onclick: old ? null : () => { if (loadSeason(x.season)) { S.tab = 'overview'; render(); window.scrollTo({ top: 0 }); } }, title: old ? x.season + ' (from ' + (x.histOnly || 'FBref') + ': league record only)' : 'Open ' + x.season },
          h('td', { class: 'l' }, h('b', { text: x.season }), x.current ? h('span', { class: 'sub', text: ' now' }) : old ? h('span', { class: 'sub', text: lower || '' }) : null), h('td', null, h('b', { text: x.r.pos ? ordinal(x.r.pos) : '–' })),
          h('td', { text: a.n }), h('td', { text: a.w }), h('td', { text: a.d }), h('td', { text: a.l }), h('td', { text: a.g }), h('td', { text: a.ga }), h('td', { text: signed(a.g - a.ga, 0) }), h('td', null, h('b', { text: a.pts })), h('td', { text: fmt(ppg3(a), 2) }),
          showMkt ? h('td', { text: g(a.mxp, 2) }) : null, h('td', { text: g(a.sh, 1) }), h('td', { text: g(a.sha, 1) }), showXg ? [h('td', { text: g(a.xg, 2) }), h('td', { text: g(a.xga, 2) })] : null,
          hasHist ? [h('td', { class: 'l', text: scorerOf(x) }), h('td', { text: attOf(x) })] : null,
          W ? [h('td', { class: 'sub', text: w ? w.scottishCup || '' : '' }), h('td', { class: 'sub', text: w ? w.leagueCup || '' : '' })] : null,
          hasHist ? h('td', { class: 'l sub', text: su && su.europe ? su.europe : w && w.europe ? w.europe : '' }) : null,
          H ? h('td', { class: 'l sub', text: f && f.notes ? f.notes.replace(/^→\s*/, '') : '' }) : null,
          h('td', { class: 'l sub', text: (x.r.champ || '') + (x.current && x.r.champ ? ' (leading)' : '') }), h('td', { class: 'sub', text: x.r.players ? 'players' : '' }));
      })))),
    h('p', { class: 'note', text: 'Seasons marked “players” also have line-ups and player stats (from Sportmonks). Past seasons from football-data.co.uk have no xG. 2019/20 ended early (Covid), so it has fewer matches.' + (hasHist ? ' Top scorers, cup runs and European runs are from FBref’s club history and Wikipedia’s list of the club’s seasons; attendances from your attendance CSV. Seasons before 1994/95 have the league record only. PPG counts 3 points for a win in every season so eras compare (2 points were given before 1994/95; Pts shows what was awarded). 2020/21 was played behind closed doors.' : '') })));

  // League finishes, and European campaigns (FBref club history)
  // Every season with a position, top flight only (a second-tier finish isn't comparable)
  const fin = asc.filter((x) => x.r.pos && !(x.div && /div 2|second|division two|div b/i.test(x.div))).map((x) => {
    const f = hl(x), w = hw(x);
    const notes = f && f.notes ? f.notes : w && w.europe ? '' : '';
    return [x.season, { pos: x.r.pos, pts: x.r.a.pts, mp: x.r.a.n, w: x.r.a.w, d: x.r.a.d, l: x.r.a.l, scorer: scorerOf(x) === '–' ? '' : scorerOf(x), notes, title: x.r.pos === 1 }];
  });
  if (fin.length >= 3) grid.append(card({ title: 'League finishes', span: true }, `${teamName(S.team)}’s final league position, ${fin[0][0]} to ${fin[fin.length - 1][0]}`, positionChart(fin)));
  if (H) {
    const eu = Object.keys(H.summary).concat(Object.keys(H.europe)).filter((k, i, arr) => arr.indexOf(k) === i && ((H.summary[k] && H.summary[k].europe) || H.europe[k])).sort().reverse();
    if (eu.length) grid.append(card({ title: 'In Europe', span: true }, `${teamName(S.team)}’s European campaigns · from FBref (match records only where FBref has them)`, h('div', { class: 'tbl-wrap' }, h('table', null,
      h('thead', null, h('tr', null, ['Season', 'How far', 'Group / league phase', 'P', 'W', 'D', 'L', 'GF', 'GA', 'Top scorer'].map((c, i) => h('th', { class: i <= 2 || i === 9 ? 'l' : '', text: c })))),
      h('tbody', null, eu.map((k) => { const su = H.summary[k], e = H.europe[k]; return h('tr', { style: { cursor: 'default' } }, h('td', { class: 'l' }, h('b', { text: k })), h('td', { class: 'l', text: su && su.europe ? su.europe : '' }), h('td', { class: 'l sub', text: e ? e.comp + (e.stage ? ' · ' + ({ Lg: 'league phase', GR: 'group stage' }[e.stage] || e.stage) : '') : '' }),
        ['mp', 'w', 'd', 'l', 'gf', 'ga'].map((f) => h('td', { text: e && e[f] != null ? e[f] : '' })), h('td', { class: 'l sub', text: e && e.scorer ? e.scorer : '' })); }))))));
  }

  attendanceCard(grid, key);

  // Points per game and market expectation by season
  const c1 = card('Points per game by season', 'Actual points per game against what the betting market expected before each match');
  const b1 = h('div');
  c1.append(b1);
  grid.append(c1);
  const B = css('--ink-2');
  lineChart(b1, {
    labels: asc.map((x) => seasonShort(x.season)),
    series: [{ name: 'Points per game', color: A, values: asc.map((x) => safe(x.r.a.pts, x.r.a.n)) }].concat(showMkt ? [{ name: 'Market expected', color: B, dash: '5 4', values: asc.map((x) => (has(x.r.a.mxp) ? safe(x.r.a.mxp, x.r.a.n) : NaN)) }] : []),
    yFmt: (v) => v.toFixed(1),
    tipFor: (i) => { const x = asc[i], a = x.r.a; return [{ v: x.season + (x.r.pos ? ' · ' + ordinal(x.r.pos) : ''), strong: true }, { color: A, v: fmt(safe(a.pts, a.n), 2), l: 'points per game' }, has(a.mxp) ? { color: B, v: fmt(safe(a.mxp, a.n), 2), l: 'market expected' } : null, { v: `${a.pts} pts from ${a.n} · GD ${signed(a.g - a.ga, 0)}` }].filter(Boolean); },
  });
  c1.append(legend([['Points per game', A, 'line']].concat(showMkt ? [['Market expected', B, 'line line-dash']] : [])));

  // Goals by season
  const c2 = card('Goals per game by season', 'Scored and conceded in the league');
  const b2 = h('div');
  c2.append(b2);
  grid.append(c2);
  lineChart(b2, {
    labels: asc.map((x) => seasonShort(x.season)),
    series: [{ name: 'Scored', color: A, values: asc.map((x) => safe(x.r.a.g, x.r.a.n)) }, { name: 'Conceded', color: B, dash: '5 4', values: asc.map((x) => safe(x.r.a.ga, x.r.a.n)) }],
    yFmt: (v) => v.toFixed(1),
    tipFor: (i) => { const x = asc[i], a = x.r.a; return [{ v: x.season, strong: true }, { color: A, v: fmt(safe(a.g, a.n), 2), l: 'scored per game' }, { color: B, v: fmt(safe(a.ga, a.n), 2), l: 'conceded per game' }, has(a.sh) ? { v: `${fmt(safe(a.sh, a.n), 1)} shots, ${fmt(safe(a.sha, a.n), 1)} against per game` } : null].filter(Boolean); },
  });
  c2.append(legend([['Scored', A, 'line'], ['Conceded', B, 'line line-dash']]));

  // Points race: this season against earlier ones, match by match
  const raceRows = lrows.filter((x) => x.r.race && x.r.race.length);
  if (raceRows.length < 2) return;
  const pick = raceRows.slice(0, S.raceN === 'all' ? raceRows.length : 5);
  const n = Math.max(...pick.map((x) => x.r.race.length));
  const pal = ['--c1', '--c3', '--c2', '--c4', '--c5'];
  const series = pick.map((x, i) => ({ name: x.season, color: i === 0 ? A : css(pal[(i - 1) % pal.length]), width: i === 0 ? 3 : 1.6, noDots: true, values: Array.from({ length: n }, (_, k) => (k < x.r.race.length ? x.r.race[k] : NaN)) }));
  const c3 = card({ title: 'Points race', span: true, tools: raceRows.length > 5 ? seg([['5', 'Last 5 seasons'], ['all', 'All']], S.raceN === 'all' ? 'all' : '5', (v) => { S.raceN = v; render(); }, 'Seasons') : null }, `${teamName(S.team)}’s points after each league match, ${pick[0].season} against earlier seasons`);
  const b3 = h('div');
  c3.append(b3);
  grid.append(c3);
  lineChart(b3, {
    labels: Array.from({ length: n }, (_, k) => String(k + 1)), series, height: 280,
    yFmt: (v) => v.toFixed(0),
    tipFor: (k) => [{ v: 'After ' + (k + 1) + ' matches', strong: true }].concat(series.map((s) => (has(s.values[k]) ? { color: s.color, v: s.values[k] + ' pts', l: s.name } : null)).filter(Boolean)),
  });
  c3.append(legend(series.map((s) => [s.name, s.color, 'line'])));
  const now = pick[0].r.race, k = now.length - 1;
  if (k >= 0 && pick.length > 1) {
    const cmp = pick.slice(1).filter((x) => x.r.race.length > k).map((x) => ({ s: x.season, v: x.r.race[k] }));
    if (cmp.length) c3.append(h('p', { class: 'note', text: `After ${k + 1} matches: ${now[k]} points in ${pick[0].season}, against ` + cmp.map((x) => `${x.v} in ${x.s}`).join(', ') + '.' }));
  }

  // Players across seasons (seasons with Sportmonks player stats)
  const withP = lrows.filter((x) => x.r.players);
  if (withP.length >= 2) playersAcross(grid, withP.slice().reverse());
}

// Average home attendance by season for every club with figures (FBref)
// Seasons whose football-data file lists each match's crowd (2000/01, 2001/02): average home attendance per club
function fdAttendance() {
  SEASONS.list.forEach((e) => {
    if (ATT[e.season] && Object.keys(ATT[e.season]).length >= 3) return;
    if (!e.primary.some((f) => /^[^\n]*\bAttendance\b/.test(f.text))) return;
    const db = seasonDB(e.season);
    if (!db) return;
    const tot = {};
    db.matches.forEach((m) => { if (m.att) { const t = (tot[m.home] = tot[m.home] || [0, 0]); t[0] += m.att; t[1]++; } });
    const S0 = (ATT[e.season] = ATT[e.season] || {});
    Object.entries(tot).forEach(([id, [sum, n]]) => { const nm = db.teamById[id].name, k = fbTeamKey(nm); if (n >= 5 && !S0[k]) S0[k] = { name: nm, att: Math.round(sum / n) }; });
  });
}
function attendanceCard(grid, key) {
  fdAttendance();
  const seasons = Object.keys(ATT).filter((k) => Object.keys(ATT[k]).length).sort();
  if (!seasons.length) return;
  const clubs = {};
  seasons.forEach((k) => Object.entries(ATT[k]).forEach(([tk, x]) => { clubs[tk] = clubs[tk] || x.name; }));
  const others = Object.keys(clubs).filter((tk) => tk !== key);
  const A = css('--team-a'), G = css('--rule-2');
  const val = (tk, k) => (ATT[k][tk] && ATT[k][tk].att >= 500 ? ATT[k][tk].att : NaN); // 2020/21 was behind closed doors
  const series = others.map((tk) => ({ name: clubs[tk], color: G, width: 1.2, noDots: true, values: seasons.map((k) => val(tk, k)) }))
    .concat(clubs[key] ? [{ name: clubs[key], color: A, width: 3, values: seasons.map((k) => val(key, k)) }] : []);
  const c = card({ title: 'Home attendances', span: true }, `Average league home crowd by season · ${clubs[key] || teamName(S.team)} highlighted${others.length ? ', other clubs in grey' : ''} · from your attendance CSV, FBref and football-data.co.uk`);
  const box = h('div');
  c.append(box);
  grid.append(c);
  lineChart(box, {
    labels: seasons.map(seasonShort), series, height: 260, zero: false,
    yFmt: (v) => (v >= 1000 ? Math.round(v / 1000) + 'k' : String(Math.round(v))),
    tipFor: (i) => [{ v: seasons[i], strong: true }].concat(Object.entries(ATT[seasons[i]]).filter(([, x]) => x.att >= 500).sort((a, b) => b[1].att - a[1].att).slice(0, 12).map(([tk, x]) => ({ color: tk === key ? A : G, v: x.att.toLocaleString('en-GB'), l: x.name }))).concat(Object.values(ATT[seasons[i]]).some((x) => x.att < 500) ? [{ v: 'Behind closed doors (Covid)' }] : []),
  });
  c.append(legend([[clubs[key] || teamName(S.team), A, 'line']].concat(others.length ? [['Other clubs', G, 'line']] : [])));
  const last = seasons.slice().reverse().find((k) => Object.keys(ATT[k]).length >= 3);
  if (last) {
    const rows = Object.entries(ATT[last]).sort((a, b) => b[1].att - a[1].att);
    c.append(h('div', { class: 'tbl-wrap', style: { marginTop: '10px' } }, h('table', null, h('thead', null, h('tr', null, ['#', 'Club', 'Average home crowd ' + last].map((x, i) => h('th', { class: i === 1 ? 'l' : '', text: x })))),
      h('tbody', null, rows.map(([tk, x], i) => h('tr', { class: tk === key ? 'focus' : '', style: { cursor: 'default' } }, h('td', { text: i + 1 }), h('td', { class: 'l', text: x.name }), h('td', { text: x.att >= 500 ? x.att.toLocaleString('en-GB') : 'closed doors' })))))));
  }
  const missing = seasons.length < 10 || others.length < 5;
  c.append(h('p', { class: 'note', text: (missing ? 'To add every club, paste each season’s attendance table into the Data tab’s FBref box: either FBref’s League Table (the season page, e.g. fbref.com/en/comps/40/2023-2024/2023-2024-Scottish-Premiership-Stats, “Regular season” → Share & Export → Get table as CSV), or the Attendances table from the Wikipedia article for that season (e.g. “2010–11 Scottish Premier League”), selected and copied from the page. Wikipedia goes back further. ' : '') + 'Figures from 1976/77 come from the attendance CSV you supplied (compiled from Wikipedia, European Football Statistics, London Hearts, CelticWiki and others); FBref and football-data.co.uk fill gaps. Before 1995/96 only a few clubs have figures. 2020/21 was played behind closed doors.' }));
}

// Final league position by season, 1st at the top
function positionChart(fin) {
  const n = fin.length, W = 1000, Hh = 220, m = { l: 34, r: 12, t: 14, b: 30 };
  const maxP = Math.max(12, ...fin.map(([, f]) => f.pos));
  const X = (i) => m.l + (n <= 1 ? (W - m.l - m.r) / 2 : (i * (W - m.l - m.r)) / (n - 1)), Y = (p) => m.t + ((p - 1) * (Hh - m.t - m.b)) / (maxP - 1);
  const svg = sv('svg', { viewBox: `0 0 ${W} ${Hh}`, width: '100%', role: 'img', 'aria-label': 'League position by season' });
  const ax = sv('g', { class: 'axis' });
  [1, 3, 6, 9, 12, 15, 18].filter((p) => p <= maxP).forEach((p) => { ax.append(sv('line', { x1: m.l, x2: W - m.r, y1: Y(p), y2: Y(p), class: p === 6 ? 'baseline' : 'grid-line' })); ax.append(sv('text', { x: m.l - 6, y: Y(p) + 4, 'text-anchor': 'end', text: ordinal(p) })); });
  const every = Math.max(1, Math.ceil(n / 14));
  fin.forEach(([k], i) => { if (i % every === 0 || i === n - 1) ax.append(sv('text', { x: X(i), y: Hh - 8, 'text-anchor': 'middle', text: seasonShort(k) })); });
  svg.append(ax);
  const A = css('--team-a');
  const yr = (k) => parseInt(k, 10); // break the line over missing seasons (the wars)
  svg.append(sv('path', { d: fin.map(([k, f], i) => (i && yr(k) - yr(fin[i - 1][0]) === 1 ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(f.pos).toFixed(1)).join(''), fill: 'none', stroke: A, 'stroke-width': 2, 'stroke-linejoin': 'round' }));
  fin.forEach(([k, f], i) => {
    const eu = /europa|uefa|conference|champions/i.test(f.notes || '');
    const won = f.pos === 1, gold = css('--warn');
    const dot = sv('circle', { cx: X(i), cy: Y(f.pos), r: won ? 6.5 : eu ? 5.5 : n > 60 ? 2.6 : 4, fill: won ? gold : eu ? A : css('--surface'), stroke: won ? gold : A, 'stroke-width': 2, tabindex: 0 });
    hover(dot, () => [{ v: k + ' · ' + ordinal(f.pos), strong: true }, { v: `${f.pts} pts from ${f.mp} · ${f.w}-${f.d}-${f.l}` }, f.scorer ? { v: 'Top scorer ' + f.scorer } : null, f.notes ? { v: f.notes.replace(/^→\s*/, 'Qualified: ') } : null].filter(Boolean));
    svg.append(dot);
  });
  const anyEu = fin.some(([, f]) => /europa|uefa|conference|champions/i.test(f.notes || ''));
  return h('div', null, svg, legend([['League position', A, 'line'], ['League champions', css('--warn')]].concat(anyEu ? [['Qualified for Europe (from 2000/01)', A]] : [])), h('p', { class: 'note', text: 'The line at 6th marks the top-six split, used since 2000/01. Earlier top flights had 10 to 20 clubs. Seasons outside the top flight are left out.' }));
}

// Same club, same player id (club + name), each season's totals
function playersAcross(grid, seasons) {
  const mets = IMP_METRICS;
  const mt = mets.find((x) => x.k === S.impMetric) || mets[0];
  const MIN = 450;
  const keep = aggPlayer.season;
  aggPlayer.season = null; // per-season totals only, not this season's FBref figures
  const ids = {};
  seasons.forEach((x) => Object.values(x.r.db.players).forEach((p) => { const pre = 'pl-' + x.r.t.id + '-'; if (p.team === x.r.t.id && p.id.startsWith(pre)) ids[p.id.slice(pre.length)] = p.name; }));
  const rows = Object.entries(ids).map(([nk, name]) => {
    const vals = seasons.map((x) => {
      const pid = 'pl-' + x.r.t.id + '-' + nk, ms = x.r.db.matches.filter((m) => m.ps && m.ps[pid]);
      const a = aggPlayer(ms, pid);
      return a.min >= MIN ? { v: mt.f(a), min: a.min } : null;
    });
    const got = vals.filter((v) => v && has(v.v));
    if (got.length < 2) return null;
    const last = vals.length - 1 - [...vals].reverse().findIndex((v) => v && has(v.v));
    let prev = last - 1; while (prev >= 0 && !(vals[prev] && has(vals[prev].v))) prev--;
    return { name, vals, d: prev >= 0 ? vals[last].v - vals[prev].v : NaN };
  }).filter(Boolean).sort((a, b) => (has(b.d) ? b.d : -1e9) - (has(a.d) ? a.d : -1e9));
  aggPlayer.season = keep;
  if (!rows.length) return;
  grid.append(card({ title: 'Players across seasons', span: true, tools: seg(mets.map((x) => [x.k, x.l]), mt.k, (v) => { S.impMetric = v; render(); }, 'Stat') },
    `${mt.l} per season for players with ${MIN}+ league minutes in at least two seasons at the club · change = latest season against the one before`,
    h('div', { class: 'tbl-wrap' }, h('table', null, h('thead', null, h('tr', null, h('th', { class: 'l', text: 'Player' }), seasons.map((x) => h('th', { text: seasonShort(x.season) })), h('th', { text: 'Change' }))),
      h('tbody', null, rows.map((r) => h('tr', { style: { cursor: 'default' } }, h('td', { class: 'l', text: r.name }),
        r.vals.map((v) => h('td', { class: v ? '' : 'sub', title: v ? v.min + ' min' : 'under ' + MIN + ' min', text: v && has(v.v) ? fmt(v.v, mt.d) : '–' })),
        h('td', null, h('b', { style: { color: !has(r.d) ? null : r.d > 0 ? 'var(--good-text)' : r.d < 0 ? 'var(--bad-text)' : null }, text: has(r.d) ? signed(r.d, mt.d) : '–' }))))))),
    h('p', { class: 'note', text: 'Season-level numbers smooth out single matches, so this is the steadier view of who has improved. The current season is still short, so its column moves the most.' })));
}
