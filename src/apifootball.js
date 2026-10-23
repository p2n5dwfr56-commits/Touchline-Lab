'use strict';
/* =====================================================================
   API-Football (api-sports.io, v3) import
   Reads fixture objects that include events, lineups, statistics and
   players: the bundle written by tools/fetch-api-football.mjs, or raw
   /fixtures?ids=... responses saved from the API.
   This source has match and player stats, line-ups and formations, but
   no pitch coordinates, so spatial views stay empty.
   ===================================================================== */

// Line-up grid is "row:column", row 1 = goalkeeper. Set to false if
// players appear mirrored left/right on the Tactics board.
const AF_GRID_COL1_LEFT = true;

const AF_ROW_ROLES = {
  DEF: { 1: ['CB'], 2: ['RCB', 'LCB'], 3: ['RCB', 'CB', 'LCB'], 4: ['RB', 'RCB', 'LCB', 'LB'], 5: ['RWB', 'RCB', 'CB', 'LCB', 'LWB'] },
  DM: { 1: ['DM'], 2: ['RDM', 'LDM'], 3: ['RDM', 'DM', 'LDM'], 4: ['RM', 'RDM', 'LDM', 'LM'], 5: ['RWB', 'RDM', 'DM', 'LDM', 'LWB'] },
  MID: { 1: ['CM'], 2: ['RCM', 'LCM'], 3: ['RCM', 'CM', 'LCM'], 4: ['RM', 'RCM', 'LCM', 'LM'], 5: ['RWB', 'RCM', 'CM', 'LCM', 'LWB'] },
  AM: { 1: ['AM'], 2: ['RAM', 'LAM'], 3: ['RW', 'AM', 'LW'], 4: ['RM', 'RAM', 'LAM', 'LM'] },
  FWD: { 1: ['ST'], 2: ['RS', 'LS'], 3: ['RW', 'ST', 'LW'] },
};
const AF_POS_GROUP = { G: 'GK', D: 'DEF', M: 'MID', F: 'FWD' };
const AF_NO_TEAM = ['npxg', 'npxga', 'ppdaPass', 'ppdaDef', 'f3p', 'of3p', 'prog', 'f3e', 'boxe', 'cross', 'spxg', 'hto', 'defX', 'defN', 'fwd', 'dist', 'poss', 'possMid', 'possF3', 'possBox', 'possShot', 'possGoal', 'rec', 'trSh', 'trXg'];
const AF_NO_PLAYER = ['xg', 'npxg', 'xa', 'prog', 'progC', 'f3e', 'boxT', 'rec', 'clr', 'touch', 'cross', 'ca'];

function afNum(v) {
  if (v == null || v === '') return null;
  const x = parseFloat(String(v).replace('%', ''));
  return Number.isFinite(x) ? x : null;
}
function afStat(list, type) {
  const s = (list || []).find((x) => x.type === type);
  return s ? afNum(s.value) : null;
}
function afRowKinds(nRows) {
  if (nRows <= 1) return ['MID'];
  const mid = nRows - 2;
  return ['DEF'].concat(mid === 1 ? ['MID'] : mid === 2 ? ['DM', 'AM'] : mid === 3 ? ['DM', 'MID', 'AM'] : Array(mid).fill('MID'), ['FWD']);
}
function afRoles(rowsOfCounts) {
  const kinds = afRowKinds(rowsOfCounts.length);
  return rowsOfCounts.map((n, r) => {
    const table = AF_ROW_ROLES[kinds[r]] || AF_ROW_ROLES.MID;
    return table[n] || Array(n).fill(kinds[r] === 'DEF' ? 'CB' : kinds[r] === 'FWD' ? 'ST' : 'CM');
  });
}

function afFixtures(files) {
  const out = {};
  files.forEach((f) => {
    const d = f.data;
    const list = Array.isArray(d) ? d : d && Array.isArray(d.fixtures) ? d.fixtures : d && Array.isArray(d.response) ? d.response : null;
    if (!list) return;
    list.forEach((x) => {
      if (!x || !x.fixture || !x.teams || !x.league) return;
      const prev = out[x.fixture.id];
      if (!prev || (x.lineups && x.lineups.length && !(prev.lineups && prev.lineups.length))) out[x.fixture.id] = x;
    });
  });
  return Object.values(out);
}
function isApiFootball(files) { return afFixtures(files).length > 0; }

const afRound = (x, fallback) => { const rd = String((x.league && x.league.round) || '').match(/(\d+)\s*$/); return rd ? +rd[1] : fallback; };
// A fixture from the season list without match details: counts in the league table and form only.
function afResultsOnly(x, H, A, hg, ag) {
  const ts = {};
  [H, A].forEach((T) => {
    const s = blankTeam();
    Object.keys(s).forEach((k) => { if (typeof s[k] === 'number') s[k] = NaN; });
    s.n = 1; s.g = T === H ? hg : ag; s.ga = T === H ? ag : hg;
    s.w = s.g > s.ga ? 1 : 0; s.d = s.g === s.ga ? 1 : 0; s.l = s.g < s.ga ? 1 : 0; s.pts = 3 * s.w + s.d;
    ts[T] = s;
  });
  return { id: 'af' + x.fixture.id, round: afRound(x, 0), date: (x.fixture.date || '').slice(0, 10), home: H, away: A, hg, ag, forms: {}, lineups: { [H]: [], [A]: [] }, subs: { [H]: [], [A]: [] }, minutes: {}, events: [], poss: [], ts, ps: {}, timeline: [], detail: false };
}

function importApiFootball(files) {
  const all = afFixtures(files);
  const fx = all.filter((x) => ['FT', 'AET', 'PEN'].includes(x.fixture.status && x.fixture.status.short));
  const teams = {}, players = {}, roleCount = {};
  const matches = [], results = [];
  let league = null;
  const addPlayer = (id, team, name, num, pos) => {
    if (!players[id]) players[id] = { id, team, name: name || 'Unknown', num: num == null ? null : num, group: AF_POS_GROUP[pos] || 'MID', role: null };
    else {
      players[id].team = team;
      if (num != null) players[id].num = num;
      if (pos && AF_POS_GROUP[pos]) players[id].group = AF_POS_GROUP[pos];
    }
  };

  fx.sort((a, b) => (a.fixture.date || '').localeCompare(b.fixture.date || ''));
  fx.forEach((x) => {
    league = league || x.league;
    const H = 'a' + x.teams.home.id, A = 'a' + x.teams.away.id;
    [x.teams.home, x.teams.away].forEach((t) => { if (!teams['a' + t.id]) teams['a' + t.id] = { id: 'a' + t.id, name: t.name, style: null }; });
    const hg = x.goals && x.goals.home != null ? x.goals.home : 0, ag = x.goals && x.goals.away != null ? x.goals.away : 0;
    const detail = (x.lineups && x.lineups.length) || (x.statistics && x.statistics.length) || (x.players && x.players.length);
    if (!detail) { results.push(afResultsOnly(x, H, A, hg, ag)); return; }
    const forms = {}, lineups = { [H]: [], [A]: [] }, minutes = {}, subs = { [H]: [], [A]: [] }, ts = {}, ps = {};

    // Line-ups and formations
    (x.lineups || []).forEach((lu) => {
      const T = 'a' + lu.team.id;
      forms[T] = lu.formation || null;
      const xi = (lu.startXI || []).map((s) => s.player).filter(Boolean);
      xi.concat((lu.substitutes || []).map((s) => s.player).filter(Boolean)).forEach((p) => addPlayer('a' + p.id, T, p.name, p.number, p.pos));
      let parsed = xi.map((p) => { const g = String(p.grid || '').split(':').map(Number); return { p, row: g[0] || 0, col: g[1] || 0 }; });
      const hasGrid = parsed.length && parsed.every((q) => q.row > 0);
      let roles = [];
      if (hasGrid) {
        parsed.sort((a, b) => a.row - b.row || (AF_GRID_COL1_LEFT ? b.col - a.col : a.col - b.col));
        const counts = [];
        parsed.forEach((q) => { if (q.row > 1) counts[q.row - 2] = (counts[q.row - 2] || 0) + 1; });
        roles = ['GK'].concat(...afRoles(counts.filter(Boolean)));
      } else {
        const order = { G: 0, D: 1, M: 2, F: 3 };
        parsed.sort((a, b) => (order[a.p.pos] ?? 2) - (order[b.p.pos] ?? 2));
        const parts = String(lu.formation || '').split('-').map(Number).filter((n) => n > 0);
        if (parts.reduce((s, n) => s + n, 0) === parsed.length - 1) roles = ['GK'].concat(...afRoles(parts));
      }
      lineups[T] = parsed.map((q, i) => {
        const role = roles[i] || ({ G: 'GK', D: 'CB', M: 'CM', F: 'ST' }[q.p.pos] || 'CM');
        const id = 'a' + q.p.id;
        roleCount[id] = roleCount[id] || {};
        roleCount[id][role] = (roleCount[id][role] || 0) + 1;
        return { pid: id, role };
      });
    });

    // Team stats
    const st = {}, pst = {};
    (x.statistics || []).forEach((s) => (st['a' + s.team.id] = s.statistics));
    (x.players || []).forEach((p) => (pst['a' + p.team.id] = p.players));
    [H, A].forEach((T) => {
      const O = T === H ? A : H, S = st[T], SO = st[O];
      const s = blankTeam();
      s.n = 1;
      s.g = T === H ? hg : ag; s.ga = T === H ? ag : hg;
      if (s.g > s.ga) { s.w = 1; s.pts = 3; } else if (s.g === s.ga) { s.d = 1; s.pts = 1; } else s.l = 1;
      AF_NO_TEAM.forEach((k) => (s[k] = NaN));
      const count = (list, type) => (list ? afStat(list, type) || 0 : NaN); // API sends null for zero
      const val = (list, type) => { const v = list ? afStat(list, type) : null; return v == null ? NaN : v; };
      s.sh = count(S, 'Total Shots'); s.sot = count(S, 'Shots on Goal'); s.shIn = count(S, 'Shots insidebox');
      s.cor = count(S, 'Corner Kicks'); s.fls = count(S, 'Fouls'); s.yc = count(S, 'Yellow Cards');
      s.pa = val(S, 'Total passes'); s.pc = val(S, 'Passes accurate');
      s.posT = val(S, 'Ball Possession'); s.oposT = val(SO, 'Ball Possession');
      s.xg = val(S, 'expected_goals'); s.xga = val(SO, 'expected_goals');
      s.sha = count(SO, 'Total Shots');
      const PL = pst[T];
      ['duel', 'duelW', 'tkl', 'int', 'drb', 'drbW'].forEach((k) => (s[k] = PL ? 0 : NaN));
      (PL || []).forEach((pp) => {
        const q = pp.statistics && pp.statistics[0];
        if (!q) return;
        s.duel += (q.duels && q.duels.total) || 0; s.duelW += (q.duels && q.duels.won) || 0;
        s.tkl += (q.tackles && q.tackles.total) || 0; s.int += (q.tackles && q.tackles.interceptions) || 0;
        s.drb += (q.dribbles && q.dribbles.attempts) || 0; s.drbW += (q.dribbles && q.dribbles.success) || 0;
      });
      ts[T] = s;
    });

    // Player stats
    Object.entries(pst).forEach(([T, list]) => list.forEach((pp) => {
      const q = pp.statistics && pp.statistics[0];
      if (!q || !pp.player) return;
      const id = 'a' + pp.player.id, g = q.games || {};
      addPlayer(id, T, pp.player.name, g.number, g.position);
      const mins = g.minutes || 0;
      if (!mins) return;
      const s = blankPlayer();
      AF_NO_PLAYER.forEach((k) => (s[k] = NaN));
      s.n = 1; s.min = mins; s.st = g.substitute ? 0 : 1;
      const o = (obj, k) => (obj && obj[k]) || 0;
      s.g = o(q.goals, 'total'); s.ast = o(q.goals, 'assists');
      s.sh = o(q.shots, 'total'); s.sot = o(q.shots, 'on');
      s.key = o(q.passes, 'key'); s.pa = o(q.passes, 'total');
      const acc = afNum(q.passes && q.passes.accuracy);
      s.pc = acc == null ? 0 : acc <= s.pa ? acc : Math.round((acc * s.pa) / 100); // count per match; % in some feeds
      s.tkl = o(q.tackles, 'total'); s.int = o(q.tackles, 'interceptions');
      s.duel = o(q.duels, 'total'); s.duelW = o(q.duels, 'won');
      s.drb = o(q.dribbles, 'attempts'); s.drbW = o(q.dribbles, 'success');
      s.fls = o(q.fouls, 'committed');
      const r = afNum(g.rating);
      if (r != null) { s.rt = r; s.rtN = 1; }
      ps[id] = s;
      minutes[id] = mins;
    }));

    // Events: goals, cards, substitutions
    const timeline = [];
    const onPitch = { [H]: new Set(lineups[H].map((l) => l.pid)), [A]: new Set(lineups[A].map((l) => l.pid)) };
    (x.events || []).forEach((ev) => {
      if (!ev.team) return;
      const T = 'a' + ev.team.id;
      const min = ((ev.time && ev.time.elapsed) || 0) + ((ev.time && ev.time.extra) || 0);
      const pl = ev.player && ev.player.id ? 'a' + ev.player.id : null;
      const as = ev.assist && ev.assist.id ? 'a' + ev.assist.id : null;
      // Only register unknown players here: an own goal is listed under the team that benefits.
      if (pl && !players[pl]) addPlayer(pl, T, ev.player.name);
      if (as && !players[as]) addPlayer(as, T, ev.assist.name);
      const type = String(ev.type || '').toLowerCase();
      if (type === 'goal') {
        if (/missed/i.test(ev.detail || '')) return;
        timeline.push({ min, team: T, kind: 'goal', pl, as, detail: ev.detail || '' });
      } else if (type === 'card') {
        timeline.push({ min, team: T, kind: /red/i.test(ev.detail || '') ? 'red' : 'yellow', pl });
      } else if (type === 'subst' && pl && as && onPitch[T]) {
        // The feed's player/assist order for substitutions varies; whoever is on the pitch is going off.
        const off = onPitch[T].has(pl) ? pl : as, on = off === pl ? as : pl;
        onPitch[T].delete(off); onPitch[T].add(on);
        subs[T].push({ min, off, on });
        timeline.push({ min, team: T, kind: 'sub', pl: on, as: off });
      }
    });
    // Minutes from line-ups when the feed has no player stats
    [H, A].forEach((T) => {
      if (pst[T]) return;
      lineups[T].forEach((l) => (minutes[l.pid] = 90));
      subs[T].forEach((sb) => { minutes[sb.off] = Math.max(1, sb.min); minutes[sb.on] = Math.max(1, 90 - sb.min); });
      Object.entries(minutes).forEach(([pid, mn]) => {
        if (players[pid] && players[pid].team === T && !ps[pid]) {
          const s = blankPlayer();
          Object.keys(s).forEach((k) => { if (!['n', 'min', 'st'].includes(k)) s[k] = NaN; });
          s.n = 1; s.min = mn; s.st = lineups[T].some((l) => l.pid === pid) ? 1 : 0;
          ps[pid] = s;
        }
      });
    });

    const m = {
      id: 'af' + x.fixture.id, round: afRound(x, matches.length + 1), date: (x.fixture.date || '').slice(0, 10),
      home: H, away: A, hg, ag, forms, lineups, subs, minutes, events: [], poss: [], ts, ps, timeline,
    };
    matches.push(m);
    results.push(m);
  });
  Object.entries(roleCount).forEach(([pid, rc]) => { if (players[pid]) players[pid].role = Object.entries(rc).sort((a, b) => b[1] - a[1])[0][0]; });
  const season = league && league.season;
  const partial = matches.length < results.length ? `, ${matches.length} of ${results.length} matches in detail` : '';
  const label = league ? `${league.name} ${season}/${String((season + 1) % 100).padStart(2, '0')} (API-Football${partial})` : 'API-Football data';
  const errors = [];
  if (!all.length) errors.push('No API-Football fixtures found in the files.');
  else if (!fx.length) errors.push('The files contain fixtures, but none are finished yet.');
  else if (!matches.length) errors.push('The file has the fixture list but no match details yet. Run the download script again.');
  results.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  return { db: { source: 'api-football', label, teams: Object.values(teams), players, matches, results, coverage: { detailed: matches.length, total: results.length } }, errors };
}

if (typeof module !== 'undefined') module.exports = { importApiFootball, isApiFootball };
