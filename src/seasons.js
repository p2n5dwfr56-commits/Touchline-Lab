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
  el.append(h('div', { class: 'hero' }, h('h1', { text: teamName(S.team) }), h('div', { class: 'meta' }, h('span', { text: all.length + ' seasons · league only' }))));
  if (all.length < 2) {
    el.append(card({ title: 'Seasons', span: true }, null, h('p', { class: 'note', style: { marginTop: 0 }, text: 'Only one season is loaded. Add earlier seasons in the Data tab (football-data.co.uk files, free) to compare them here.' })));
    return;
  }
  const rows = memo('seasons|' + key + '|' + all.length + '|' + (SEASONS.real ? SEASONS.real.matches.length : 0), () => all.map((x) => ({ ...x, r: seasonRow(x.db || seasonDB(x.season), key) })).filter((x) => x.r));
  if (!rows.length) { el.append(card({ title: 'Seasons', span: true }, null, h('p', { class: 'note', text: teamName(S.team) + ' is not in the other seasons loaded.' }))); return; }
  const grid = h('div', { class: 'grid' });
  el.append(grid);
  const A = css('--team-a');
  const asc = rows.slice().reverse();

  // Table
  const showMkt = rows.some((x) => has(x.r.a.mxp)), showXg = rows.some((x) => has(x.r.a.xg));
  const head = ['Season', 'Pos', 'P', 'W', 'D', 'L', 'GF', 'GA', 'GD', 'Pts', 'PPG'].concat(showMkt ? ['Mkt xPts / g'] : [], ['Shots / g', 'Shots ag / g'], showXg ? ['xG / g', 'xGA / g'] : [], ['Champions', '']);
  grid.append(card({ title: 'Season by season', span: true }, `${teamName(S.team)} in the league · positions follow the split after 33 rounds · click a season to open it in every tab`,
    h('div', { class: 'tbl-wrap' }, h('table', null, h('thead', null, h('tr', null, head.map((c, i) => h('th', { class: i === 0 || i === head.length - 2 ? 'l' : '', text: c })))),
      h('tbody', null, rows.map((x) => {
        const a = x.r.a, g = (v, d) => fmt(safe(v, a.n), d);
        return h('tr', { class: x.season === DB.season ? 'focus' : '', onclick: () => { if (loadSeason(x.season)) { S.tab = 'overview'; render(); window.scrollTo({ top: 0 }); } }, title: 'Open ' + x.season },
          h('td', { class: 'l' }, h('b', { text: x.season }), x.current ? h('span', { class: 'sub', text: ' now' }) : null), h('td', null, h('b', { text: x.r.pos ? ordinal(x.r.pos) : '–' })),
          h('td', { text: a.n }), h('td', { text: a.w }), h('td', { text: a.d }), h('td', { text: a.l }), h('td', { text: a.g }), h('td', { text: a.ga }), h('td', { text: signed(a.g - a.ga, 0) }), h('td', null, h('b', { text: a.pts })), h('td', { text: g(a.pts, 2) }),
          showMkt ? h('td', { text: g(a.mxp, 2) }) : null, h('td', { text: g(a.sh, 1) }), h('td', { text: g(a.sha, 1) }), showXg ? [h('td', { text: g(a.xg, 2) }), h('td', { text: g(a.xga, 2) })] : null,
          h('td', { class: 'l sub', text: (x.r.champ || '') + (x.current && x.r.champ ? ' (leading)' : '') }), h('td', { class: 'sub', text: x.r.players ? 'players' : '' }));
      })))),
    h('p', { class: 'note', text: 'Seasons marked “players” also have line-ups and player stats (from Sportmonks). Past seasons from football-data.co.uk have no xG. 2019/20 ended early (Covid), so it has fewer matches.' })));

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
  const pick = rows.slice(0, S.raceN === 'all' ? rows.length : 5);
  const n = Math.max(...pick.map((x) => x.r.race.length));
  const pal = ['--c1', '--c3', '--c2', '--c4', '--c5'];
  const series = pick.map((x, i) => ({ name: x.season, color: i === 0 ? A : css(pal[(i - 1) % pal.length]), width: i === 0 ? 3 : 1.6, noDots: true, values: Array.from({ length: n }, (_, k) => (k < x.r.race.length ? x.r.race[k] : NaN)) }));
  const c3 = card({ title: 'Points race', span: true, tools: rows.length > 5 ? seg([['5', 'Last 5 seasons'], ['all', 'All']], S.raceN === 'all' ? 'all' : '5', (v) => { S.raceN = v; render(); }, 'Seasons') : null }, `${teamName(S.team)}’s points after each league match, ${pick[0].season} against earlier seasons`);
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
  const withP = rows.filter((x) => x.r.players);
  if (withP.length >= 2) playersAcross(grid, withP.slice().reverse());
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
