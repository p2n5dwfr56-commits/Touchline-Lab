'use strict';
/* =====================================================================
   Sportmonks (Football API v3) import
   Reads the file written by tools/fetch-sportmonks.mjs and attaches it to
   the loaded season, match by match: line-ups with formation positions,
   formations, goals/assists/cards/substitutions, per-player match stats
   for every club, team passing and duel totals, and remaining fixtures.
   ===================================================================== */

const SM_GROUP = { 24: 'GK', 25: 'DEF', 26: 'MID', 27: 'FWD' };
// Sportmonks stat type name -> player stat field
const SM_PLAYER = {
  'Minutes Played': 'min', Touches: 'touch', Passes: 'pa', 'Accurate Passes': 'pc', 'Key Passes': 'key', Goals: 'g', Assists: 'ast',
  'Shots Total': 'sh', 'Shots On Target': 'sot', Tackles: 'tkl', Interceptions: 'int', 'Ball Recovery': 'rec', Clearances: 'clr',
  'Total Duels': 'duel', 'Duels Won': 'duelW', 'Dribble Attempts': 'drb', 'Successful Dribbles': 'drbW', Fouls: 'fls', 'Total Crosses': 'cross',
  Yellowcards: 'yc', Saves: 'saves', 'Goalkeeper Goals Conceded': 'gaK',
  'Aerials Won': 'aerW', 'Aerials Lost': 'aerL', 'Tackles Won': 'tklW', 'Big Chances Created': 'bcc', 'Passes In Final Third': 'f3p',
  'Long Balls': 'lb', 'Long Balls Won': 'lbW', 'Possession Lost': 'pLost', Dispossessed: 'disp', 'Dribbled Past': 'drbPast',
  'Blocked Shots': 'blk', 'Fouls Drawn': 'fd', 'Error Lead To Shot': 'errSh', 'Error Lead To Goal': 'errG', 'Man of Match': 'motm', 'Accurate Crosses': 'crossOk',
};
const smIsBundle = (d) => d && d.source === 'sportmonks' && Array.isArray(d.fixtures);

// Player id for a Sportmonks name: the same id another source gave that player when the names
// differ only by a short first name ("Dan Happe" / "Daniel Happe"), else the usual key.
function smPlayerId(db, team, name, memo) {
  const k = team + '|' + name;
  if (memo[k]) return memo[k];
  let id = playerKey(team, name);
  if (!db.players[id]) {
    const words = (s) => playerKey('', s).replace(/^pl--/, '').split('-').filter(Boolean);
    const mine = words(name);
    const fits = (a, b) => a.length === b.length && a.every((w) => b.some((x) => x === w || (w.length >= 3 && x.startsWith(w)) || (x.length >= 3 && w.startsWith(x))));
    const hits = Object.values(db.players).filter((p) => p.team === team && !p.fromLineups && fits(mine, words(p.name)));
    if (hits.length === 1) id = hits[0].id;
  }
  return (memo[k] = id);
}

function attachSportmonks(db, b) {
  const byKey = {};
  db.teams.forEach((t) => (byKey[fbTeamKey(t.name)] = t.id));
  const tid = (side) => (side ? byKey[fbTeamKey(side.name)] || null : null);
  const typeOf = {};
  Object.entries(b.types || {}).forEach(([id, name]) => (typeOf[id] = name));
  // Fields Sportmonks never supplies in this file stay missing (NaN) rather than zero
  const seen = new Set();
  b.fixtures.forEach((f) => (f.lineups || []).forEach((l) => Object.keys(l.d || {}).forEach((k) => { const fld = SM_PLAYER[typeOf[k]]; if (fld) seen.add(fld); })));
  const roleCount = {}, memo = {};
  let finished = 0, matched = 0, upcoming = 0;
  const unmatched = [];

  b.fixtures.forEach((f) => {
    const H = tid(f.home), A = tid(f.away), date = String(f.date || '').slice(0, 10);
    if (!f.score) { // upcoming: add to both clubs' fixture lists
      if (H && A && date) { addFixture(db, H, { date, time: String(f.date).slice(11, 16), comp: b.league.name, venue: 'H', opp: f.away.name }); addFixture(db, A, { date, time: String(f.date).slice(11, 16), comp: b.league.name, venue: 'A', opp: f.home.name }); upcoming++; }
      return;
    }
    finished++;
    const m = H && A && db.matches.find((x) => x.home === H && x.away === A && x.date && fbDays(x.date, date) <= 1);
    if (!m) { unmatched.push(`${date} ${f.home && f.home.name} v ${f.away && f.away.name}`); return; }
    matched++;
    const sideOf = { [f.home.id]: H, [f.away.id]: A };
    const T = (smTeam) => sideOf[smTeam];
    m.lineups = m.lineups || {};
    m.subs = m.subs || {};

    // Formations and starting XIs; grid "row:col", row 1 = goalkeeper, col 1 = the team's right
    [H, A].forEach((team) => {
      const smId = team === H ? f.home.id : f.away.id;
      if (f.formations && f.formations[smId]) m.forms[team] = f.formations[smId];
      const xi = (f.lineups || []).filter((l) => l.team === smId && l.starter);
      const grid = xi.map((l) => { const g = String(l.field || '').split(':').map(Number); return { l, row: g[0] || 0, col: g[1] || 0 }; });
      if (grid.length && grid.every((q) => q.row > 0)) {
        grid.sort((a, c) => a.row - c.row || a.col - c.col);
        const counts = [];
        grid.forEach((q) => { if (q.row > 1) counts[q.row - 2] = (counts[q.row - 2] || 0) + 1; });
        const roles = ['GK'].concat(...afRoles(counts.filter(Boolean)));
        m.lineups[team] = grid.map((q, i) => ({ pid: smPlayerId(db, team, q.l.name, memo), role: roles[i] || 'CM' }));
      } else m.lineups[team] = xi.map((l) => ({ pid: smPlayerId(db, team, l.name, memo), role: { 24: 'GK', 25: 'CB', 26: 'CM', 27: 'ST' }[l.pos] || 'CM' }));
      m.lineups[team].forEach((x) => { roleCount[x.pid] = roleCount[x.pid] || {}; roleCount[x.pid][x.role] = (roleCount[x.pid][x.role] || 0) + 1; });
    });

    // Players and their match stats
    (f.lineups || []).forEach((l) => {
      const team = T(l.team);
      if (!team) return;
      const id = smPlayerId(db, team, l.name, memo);
      const p = db.players[id] || (db.players[id] = { id, team, name: l.name, num: null, group: SM_GROUP[l.pos] || 'MID', role: null });
      p.team = team; p.group = SM_GROUP[l.pos] || p.group; p.fromLineups = true;
      ((m.squad = m.squad || {})[team] = m.squad[team] || []).push(id); // the matchday squad, bench included
      if (l.num != null) p.num = l.num;
      const d = l.d || {};
      if (!Object.keys(d).length) return; // unused substitute
      const s = blankPlayer();
      ['xg', 'npxg', 'xa', 'prog', 'progC', 'f3e', 'boxT', 'ca'].forEach((k) => (s[k] = NaN));
      Object.values(SM_PLAYER).forEach((k) => { s[k] = seen.has(k) ? s[k] || 0 : NaN; }); // a stat the file has but this player didn't record is 0
      Object.entries(d).forEach(([k, v]) => {
        const name = typeOf[k], fld = SM_PLAYER[name];
        if (fld) s[fld] = (s[fld] || 0) + v;
        if (name === 'Rating') { s.rt = v; s.rtN = 1; }
      });
      if (!(s.min > 0)) return;
      s.n = 1; s.st = l.starter ? 1 : 0;
      if (p.group !== 'GK') { s.saves = undefined; s.gaK = undefined; }
      else s.sota = (s.saves || 0) + (s.gaK || 0); // shots on target faced = saves + goals conceded
      m.ps[id] = s;
      m.minutes[id] = s.min;
    });

    // Events: goals, cards, substitutions; on-pitch goal difference from who was on at each goal
    const onPitch = { [H]: new Set((m.lineups[H] || []).map((x) => x.pid)), [A]: new Set((m.lineups[A] || []).map((x) => x.pid)) };
    const timeline = [];
    const evs = (f.events || []).slice().sort((x, y) => (x.min || 0) - (y.min || 0) || (x.extra || 0) - (y.extra || 0));
    const goalsFor = { [H]: 0, [A]: 0 };
    evs.forEach((e) => {
      const team = T(e.team), min = (e.min || 0) + (e.extra || 0);
      if (!team) return;
      const pid = e.name ? smPlayerId(db, team, e.name, memo) : null, rel = e.relName ? smPlayerId(db, team, e.relName, memo) : null;
      if (e.type === 'Substitution' && pid && rel) {
        const off = onPitch[team].has(rel) ? rel : pid, on = off === rel ? pid : rel;
        onPitch[team].delete(off); onPitch[team].add(on);
        m.subs[team] = (m.subs[team] || []).concat({ min, off, on });
        timeline.push({ min, team, kind: 'sub', pl: on, as: off });
      } else if (e.type === 'Goal' || e.type === 'Penalty' || e.type === 'Own Goal') {
        // Every goal, own goals included, is listed under the team it counts for (checked against the scores)
        const scoring = team;
        goalsFor[scoring]++;
        timeline.push({ min, bm: e.min || 0, team: scoring, kind: 'goal', pl: e.type === 'Own Goal' ? null : pid, as: e.type === 'Own Goal' ? null : rel, detail: e.type === 'Penalty' ? 'Penalty' : e.type === 'Own Goal' ? 'Own Goal' : '', ogName: e.type === 'Own Goal' ? e.name : null });
        const other = scoring === H ? A : H;
        onPitch[scoring].forEach((x) => { if (m.ps[x]) m.ps[x].onG = (m.ps[x].onG || 0) + 1; });
        onPitch[other].forEach((x) => { if (m.ps[x]) m.ps[x].onGA = (m.ps[x].onGA || 0) + 1; });
      } else if (/yellow\/red|redcard/i.test(e.type || '')) timeline.push({ min, team, kind: 'red', pl: pid });
      else if (/yellowcard/i.test(e.type || '')) timeline.push({ min, team, kind: 'yellow', pl: pid });
    });
    m.timeline = timeline;
    // Per-player result context: goal difference on the pitch, team points per appearance, clean sheets
    const ptsFor = (team) => { const gf = team === m.home ? m.hg : m.ag, ga = team === m.home ? m.ag : m.hg; return gf > ga ? 3 : gf === ga ? 1 : 0; };
    Object.entries(m.ps).forEach(([id, s]) => {
      const p = db.players[id];
      if (!p || (p.team !== H && p.team !== A) || !(s.min > 0) || !p.fromLineups) return;
      s.onG = s.onG || 0; s.onGA = s.onGA || 0; s.ptsP = ptsFor(p.team);
      if (p.group === 'GK') s.cs = s.min >= 60 && (p.team === m.home ? m.ag : m.hg) === 0 ? 1 : 0;
    });
    // Team totals the season file lacks (passes, duels, tackles...), summed from the players
    [H, A].forEach((team) => {
      const ts = m.ts[team];
      if (!ts) return;
      const mine = Object.entries(m.ps).filter(([id]) => db.players[id] && db.players[id].team === team).map(([, s]) => s);
      [['pa', 'pa'], ['pc', 'pc'], ['tkl', 'tkl'], ['int', 'int'], ['duel', 'duel'], ['duelW', 'duelW'], ['drb', 'drb'], ['drbW', 'drbW'], ['rec', 'rec']].forEach(([tk, pk]) => {
        if (!has(ts[tk]) && mine.length && seen.has(pk)) ts[tk] = mine.reduce((sum, s) => sum + (has(s[pk]) ? s[pk] : 0), 0);
      });
      const poss = (f.stats || []).find((x) => x.team === (team === H ? f.home.id : f.away.id) && typeOf[x.type] === 'Ball Possession %');
      if (poss && !has(ts.posT)) { ts.posT = poss.value; ts.oposT = 100 - poss.value; }
    });
    m.info = { ...(m.info || {}), venue: f.venue || (m.info && m.info.venue) };
  });
  Object.entries(roleCount).forEach(([pid, rc]) => { if (db.players[pid]) db.players[pid].role = Object.entries(rc).sort((a, c) => c[1] - a[1])[0][0]; });
  db.hasLineups = db.matches.some((m) => Object.values(m.lineups || {}).some((l) => l.length));
  db.hasPlayers = true;
  return { finished, matched, unmatched, upcoming, season: b.season && b.season.name, league: b.league && b.league.name };
}

if (typeof module !== 'undefined') module.exports = { attachSportmonks, smIsBundle };
