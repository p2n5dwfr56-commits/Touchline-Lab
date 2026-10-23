'use strict';
/* =====================================================================
   Cup competitions from API-Football (e.g. Scottish League Cup, id 185;
   Scottish Cup, id 181), added on top of the loaded league season with
   the same detail as league matches: line-ups, formations, events, team
   and player stats. Teams and players are matched by name to the league
   data already loaded (Sportmonks, FBref, football-data).
   ===================================================================== */

const AF_CUP_NAME = /cup|trophy|shield|challenge|play-?offs?/i;
// The competition an API-Football file is for, if it is a cup rather than a league season
function afCupLeague(files) {
  const fx = afFixtures(files);
  const lg = fx.length && fx[0].league;
  return lg && AF_CUP_NAME.test(lg.name || '') ? lg : null;
}

function attachApiFootballCups(db, files) {
  const raw = afFixtures(files);
  const lg = raw[0] && raw[0].league;
  const { db: c } = importApiFootball(files); // the same import as a league file, then mapped onto this season
  const tmap = {};
  c.teams.forEach((t) => (tmap[t.id] = fbEnsureTeam(db, t.name)));
  const byFx = {};
  raw.forEach((x) => (byFx['af' + x.fixture.id] = x));
  const pmap = {};
  Object.values(c.players).forEach((p) => {
    const team = tmap[p.team];
    if (!team) return;
    const id = afPlayerId(db, team, p.name);
    pmap[p.id] = id;
    const q = db.players[id] || (db.players[id] = { id, team, name: p.name, num: p.num, group: p.group, role: p.role });
    if (!q.role && p.role) q.role = p.role;
    if (q.num == null && p.num != null) q.num = p.num;
  });
  const P = (id) => (id && pmap[id]) || id;
  const remapKeys = (o) => Object.fromEntries(Object.entries(o || {}).map(([k, v]) => [tmap[k] || P(k), v]));
  let added = 0;
  const games = (c.results || c.matches).map((m) => {
    const x = byFx[m.id] || {};
    const H = tmap[m.home], A = tmap[m.away];
    const venue = (x.fixture && x.fixture.venue && x.fixture.venue.name) || '';
    const round = (x.league && x.league.round) || '';
    const pen = x.score && x.score.penalty && x.score.penalty.home != null ? { f: x.score.penalty.home, a: x.score.penalty.away } : null;
    const out = {
      ...m, id: 'afc-' + m.id, cup: true, comp: lg ? lg.name : 'Cup', round, home: H, away: A, pens: pen,
      neutral: /hampden/i.test(venue) || /semi|^final/i.test(round),
      forms: remapKeys(m.forms), ts: remapKeys(m.ts), subs: remapKeys(m.subs), ps: Object.fromEntries(Object.entries(m.ps || {}).map(([k, v]) => [P(k), v])),
      minutes: Object.fromEntries(Object.entries(m.minutes || {}).map(([k, v]) => [P(k), v])),
      lineups: Object.fromEntries(Object.entries(m.lineups || {}).map(([k, v]) => [tmap[k], v.map((l) => ({ ...l, pid: P(l.pid) }))])),
      timeline: (m.timeline || []).map((e) => ({ ...e, team: tmap[e.team] || e.team, pl: P(e.pl), as: P(e.as) })),
      detail: m.detail !== false,
      info: { ...(m.info || {}), venue },
    };
    // On-pitch goals and points per appearance, as for league matches from Sportmonks
    const pts = (T) => { const f = T === H ? out.hg : out.ag, g = T === H ? out.ag : out.hg; return f > g ? 3 : f === g ? (pen ? (T === H ? (pen.f > pen.a ? 3 : 0) : (pen.a > pen.f ? 3 : 0)) : 1) : 0; };
    Object.entries(out.ps).forEach(([pid, s]) => { const p = db.players[pid]; if (p && s.min > 0) s.ptsP = pts(p.team); });
    return out;
  });
  db.cups = (db.cups || []).filter((x) => !games.some((g) => g.id === x.id)); // re-importing replaces
  games.forEach((g) => {
    // FBref's or a hand-entered version of the same tie gives way; its attendance and referee fill gaps
    const old = db.cups.filter((x) => x.id.startsWith('cup-') && sameTie(x, g));
    old.forEach((o) => { g.info = { ...o.info, ...g.info }; });
    db.cups = db.cups.filter((x) => !old.includes(x));
    db.cups.push(g); added++;
    [g.home, g.away].forEach((T) => { if (db.fixtures && db.fixtures[T]) db.fixtures[T] = db.fixtures[T].filter((f) => !(fbDays(f.date, g.date) <= 1 && fbTeamKey(f.opp) === fbTeamKey(teamNameIn(db, T === g.home ? g.away : g.home)))); });
  });
  db.cups.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  // Upcoming ties
  let upcoming = 0;
  raw.filter((x) => !['FT', 'AET', 'PEN'].includes(x.fixture.status && x.fixture.status.short) && x.fixture.date).forEach((x) => {
    const H = fbEnsureTeam(db, x.teams.home.name), A = fbEnsureTeam(db, x.teams.away.name);
    const date = x.fixture.date.slice(0, 10), time = x.fixture.date.slice(11, 16), venue = (x.fixture.venue && x.fixture.venue.name) || '';
    const neutral = /hampden/i.test(venue);
    const round = (x.league && x.league.round) || '';
    [[H, A, 'H'], [A, H, 'A']].forEach(([T, O, v]) => { if (db.teams.some((t) => t.id === T)) addFixture(db, T, { date, time, comp: lg ? lg.name : 'Cup', round, venue: neutral ? 'N' : v, opp: teamNameIn(db, O) }); });
    upcoming++;
  });
  if (games.some((g) => g.detail)) db.hasPlayers = db.hasPlayers || Object.keys(db.players).length > 0;
  return { comp: lg ? lg.name : 'Cup', season: lg && lg.season, matches: added, detailed: games.filter((g) => g.detail).length, upcoming };
}
const sameTie = (x, g) => x.date && g.date && fbDays(x.date, g.date) <= 1 && [x.home, x.away].includes(g.home) && [x.home, x.away].includes(g.away);
// API-Football often shortens first names ("K. Nisbet"): match on surname and first initial
function afPlayerId(db, team, name) {
  const id = playerKey(team, name);
  if (db.players[id]) return id;
  const words = (n) => String(n || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter(Boolean);
  const w = words(name);
  if (!w.length) return id;
  const fits = (q) => {
    const v = words(q.name);
    if (!v.length || v[v.length - 1] !== w[w.length - 1]) return v.length === w.length && v.slice().sort().join() === w.slice().sort().join();
    return w.length === 1 || v.length === 1 || v[0][0] === w[0][0];
  };
  const hits = Object.values(db.players).filter((q) => q.team === team && fits(q));
  return hits.length === 1 ? hits[0].id : id;
}
const teamNameIn = (db, id) => (db.teamById[id] ? db.teamById[id].name : id);
