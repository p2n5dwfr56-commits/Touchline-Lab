'use strict';
/* =====================================================================
   FBref player stats import
   Season totals per player, from a squad page table (Standard Stats,
   Shooting, Passing, Defensive Actions, Possession, Miscellaneous).
   Accepts the text from "Share & Export > Get table as CSV", or the
   table copied straight off the page (tab-separated). Columns are found
   by name, so added, removed or reordered columns are tolerated.
   The stats attach to one team of the season already loaded.
   ===================================================================== */

function fbParse(text) {
  text = String(text || '').replace(/^﻿/, '');
  // Pasted text may carry page navigation or a citation line above the table, so judge
  // tab- versus comma-separated from the header row itself.
  const lines = text.split(/\r?\n/);
  const head = lines.find((l) => /(^|[\t,])(Player|Date|Opponent)([\t,]|$)/.test(l)) || lines.slice(0, 4).join('\n');
  const tabs = (head.match(/\t/g) || []).length, commas = (head.match(/,/g) || []).length;
  if (tabs > commas) return lines.map((l) => l.split('\t')).filter((r) => r.some((x) => x.trim() !== ''));
  return fdParseCSV(text);
}
function fbIsTable(rows) {
  return rows.slice(0, 60).some((r) => { const c = r.map((x) => x.trim()); return c.includes('Player') && c.some((x) => ['Min', '90s', 'MP', 'Starts', 'Sh', 'Cmp', 'Tkl', 'Touches'].includes(x)); });
}

// Team "Scores & Fixtures" table: one row per match, with formations, possession and upcoming games
function fbIsFixtures(rows) {
  return rows.slice(0, 60).some((r) => { const c = r.map((x) => x.trim()); return c.includes('Date') && c.includes('Opponent') && c.includes('Result'); });
}
const fbTeamKey = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/heart of midlothian/, 'hearts').replace(/\butd\b/, 'united').replace(/\b(fc|afc)\b/g, '').replace(/[^a-z0-9]+/g, '')
  // Short and full club names across sources ("Inverness C" / "Inverness Caledonian Thistle")
  .replace(/^(inverness|partick|hamilton|dunfermline|queenofthesouth|raith)[a-z]*$/, '$1');
const fbDays = (a, b) => Math.abs(Date.parse(a + 'T12:00:00Z') - Date.parse(b + 'T12:00:00Z')) / 864e5;
/* ---------- Cup matches and fixtures (from FBref, or entered by hand) ---------- */
// A club outside the loaded league (e.g. a lower-division cup opponent) gets a name-only team entry.
function fbEnsureTeam(db, name) {
  const key = fbTeamKey(name);
  const t = db.teams.find((x) => fbTeamKey(x.name) === key);
  if (t) return t.id;
  const id = 'x-' + key;
  if (!db.teamById[id]) db.teamById[id] = { id, name, style: null, nonLeague: true };
  return id;
}
const fbVenue = (s) => (/neutral/i.test(s) ? 'N' : /home/i.test(s) || s === 'H' ? 'H' : 'A');
// A cup match: results and match info only (no team match stats), kept apart from the league in db.cups.
function addCupMatch(db, teamId, o) {
  const oppId = fbEnsureTeam(db, o.opp);
  // The same tie already loaded with full detail (API-Football) wins over results-only versions
  const full = (db.cups || []).find((x) => x.id.startsWith('afc-') && x.date && fbDays(x.date, o.date) <= 1 && [x.home, x.away].includes(teamId) && [x.home, x.away].includes(oppId));
  if (full) { full.info = { att: o.att || null, ref: o.ref || '', captain: o.captain || '', ...full.info }; return full; }
  const H = o.venue === 'A' ? oppId : teamId, A = o.venue === 'A' ? teamId : oppId;
  const ts = {};
  [teamId, oppId].forEach((T) => {
    const s = blankTeam();
    Object.keys(s).forEach((k) => { if (typeof s[k] === 'number') s[k] = NaN; });
    s.n = 1; s.g = T === teamId ? o.gf : o.ga; s.ga = T === teamId ? o.ga : o.gf;
    s.w = s.g > s.ga ? 1 : 0; s.d = s.g === s.ga ? 1 : 0; s.l = s.g < s.ga ? 1 : 0; s.pts = 3 * s.w + s.d;
    if (has(o.poss)) { s.posT = T === teamId ? o.poss : 100 - o.poss; s.oposT = 100 - s.posT; }
    ts[T] = s;
  });
  const m = {
    id: 'cup-' + o.date + '-' + oppId, cup: true, comp: o.comp || 'Cup', round: o.round || '', date: o.date, neutral: o.venue === 'N',
    // pens are stored home-first, like hg/ag; o.pens is from this team's side
    home: H, away: A, hg: H === teamId ? o.gf : o.ga, ag: H === teamId ? o.ga : o.gf, pens: o.pens ? (H === teamId ? { f: o.pens.f, a: o.pens.a } : { f: o.pens.a, a: o.pens.f }) : null,
    forms: {}, lineups: {}, subs: {}, minutes: {}, events: [], poss: [], ts, ps: {}, timeline: [], detail: false, manual: !!o.manual,
    info: { att: o.att || null, ref: o.ref || '', captain: o.captain || '' },
  };
  if (o.form) m.forms[teamId] = o.form;
  if (o.oform) m.forms[oppId] = o.oform;
  db.cups = (db.cups || []).filter((x) => x.id !== m.id).concat(m).sort((a, b) => a.date.localeCompare(b.date));
  // A played match is no longer upcoming
  if (db.fixtures && db.fixtures[teamId]) db.fixtures[teamId] = db.fixtures[teamId].filter((f) => !(f.date === o.date && fbTeamKey(f.opp) === fbTeamKey(o.opp)));
  return m;
}
function addFixture(db, teamId, f) {
  db.fixtures = db.fixtures || {};
  const list = (db.fixtures[teamId] || []).filter((x) => !(x.date === f.date && fbTeamKey(x.opp) === fbTeamKey(f.opp)));
  const known = db.teams.find((x) => fbTeamKey(x.name) === fbTeamKey(f.opp));
  list.push({ date: f.date, time: f.time || '', comp: f.comp || '', round: f.round || '', venue: f.venue, home: f.venue === 'H', opp: f.opp, oppId: known ? known.id : null, manual: !!f.manual });
  db.fixtures[teamId] = list.sort((a, b) => a.date.localeCompare(b.date));
}
// Goals like "1 (4)" mean a penalty shootout: score 1, shootout 4
const fbGoals = (s) => { const m = String(s || '').match(/^\s*(\d+)(?:\s*\((\d+)\))?/); return m ? { g: +m[1], p: m[2] != null ? +m[2] : null } : null; };

function attachFixtures(db, teamId, rows) {
  const hi = rows.findIndex((r) => { const c = r.map((x) => x.trim()); return c.includes('Date') && c.includes('Opponent'); });
  const H = rows[hi].map((x) => x.trim()), col = (n) => H.indexOf(n);
  const i = { date: col('Date'), time: col('Time'), comp: col('Comp'), round: col('Round'), venue: col('Venue'), res: col('Result'), gf: col('GF'), ga: col('GA'), opp: col('Opponent'), poss: col('Poss'), att: col('Attendance'), cap: col('Captain'), form: col('Formation'), oform: col('Opp Formation'), ref: col('Referee') };
  const cell = (r, k) => (i[k] >= 0 ? String(r[i[k]] || '').trim() : '');
  const byKey = {};
  db.teams.forEach((t) => (byKey[fbTeamKey(t.name)] = t.id));
  const upcoming = [], unmatched = [];
  let played = 0, matched = 0, cups = 0;
  const data = rows.slice(hi + 1).filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(cell(r, 'date'))); // skip repeated headers, blank rows
  const findLeague = (r) => {
    const opp = cell(r, 'opp'), oppId = byKey[fbTeamKey(opp)] || null, home = fbVenue(cell(r, 'venue')) === 'H', date = cell(r, 'date');
    return oppId && db.matches.find((x) => (home ? x.home === teamId && x.away === oppId : x.away === teamId && x.home === oppId) && x.date && fbDays(x.date, date) <= 1);
  };
  // The league is whichever competition the rows matching league matches belong to
  const leagueRow = data.find((r) => cell(r, 'res') && findLeague(r));
  const leagueComp = leagueRow ? cell(leagueRow, 'comp') : null;
  data.forEach((r) => {
    const date = cell(r, 'date'), opp = cell(r, 'opp'), comp = cell(r, 'comp'), venue = fbVenue(cell(r, 'venue'));
    const isCup = leagueComp ? comp !== leagueComp : false;
    if (!cell(r, 'res')) { upcoming.push({ date, time: cell(r, 'time'), comp, round: isCup ? cell(r, 'round') : '', venue, home: venue === 'H', opp, oppId: byKey[fbTeamKey(opp)] || null }); return; }
    played++;
    if (isCup) {
      const gf = fbGoals(cell(r, 'gf')), ga = fbGoals(cell(r, 'ga'));
      if (!gf || !ga) { unmatched.push(`${date} ${comp} v ${opp}`); return; }
      const att = parseInt(cell(r, 'att').replace(/,/g, ''), 10), poss = parseFloat(cell(r, 'poss'));
      addCupMatch(db, teamId, { date, comp, round: cell(r, 'round'), opp, venue, gf: gf.g, ga: ga.g, pens: gf.p != null && ga.p != null ? { f: gf.p, a: ga.p } : null, poss: Number.isFinite(poss) ? poss : NaN, att: Number.isFinite(att) ? att : null, ref: cell(r, 'ref'), captain: cell(r, 'cap'), form: cell(r, 'form').replace(/[^\d-]/g, ''), oform: cell(r, 'oform').replace(/[^\d-]/g, '') });
      cups++;
      return;
    }
    const m = findLeague(r);
    const oppId = byKey[fbTeamKey(opp)] || null;
    if (!m) { unmatched.push(`${date} ${comp} v ${opp}`); return; }
    matched++;
    const f = cell(r, 'form').replace(/[^\d-]/g, ''), of = cell(r, 'oform').replace(/[^\d-]/g, '');
    if (f) m.forms[teamId] = f;
    if (of && oppId) m.forms[oppId] = of;
    const poss = parseFloat(cell(r, 'poss'));
    if (Number.isFinite(poss)) {
      const a = m.ts[teamId], b = m.ts[oppId];
      if (a && !has(a.posT)) { a.posT = poss; a.oposT = 100 - poss; }
      if (b && !has(b.posT)) { b.posT = 100 - poss; b.oposT = poss; }
    }
    const att = parseInt(cell(r, 'att').replace(/,/g, ''), 10);
    m.info = { ...(m.info || {}), att: Number.isFinite(att) ? att : null, ref: cell(r, 'ref'), captain: cell(r, 'cap') };
  });
  db.fixtures = db.fixtures || {};
  // Keep fixtures entered by hand; FBref's list replaces the rest
  const manual = (db.fixtures[teamId] || []).filter((f) => f.manual && !upcoming.some((u) => u.date === f.date && fbTeamKey(u.opp) === fbTeamKey(f.opp)));
  db.fixtures[teamId] = upcoming.concat(manual).sort((a, b) => a.date.localeCompare(b.date));
  if (leagueComp) db.leagueComp = leagueComp;
  return { played, matched, unmatched, upcoming: upcoming.length, cups, leagueComp };
}

// Team "Records vs Opponents" table: one row per club played, with matches, wins, draws, losses and goals
function fbIsRecords(rows) {
  return rows.slice(0, 60).some((r) => { const c = r.map((x) => x.trim()); return c.includes('Opponent') && c.includes('MP') && c.includes('W') && c.includes('L') && !c.includes('Date') && !c.includes('Player'); });
}
function attachRecords(db, teamId, rows) {
  const hi = rows.findIndex((r) => { const c = r.map((x) => x.trim()); return c.includes('Opponent') && c.includes('MP'); });
  const H = rows[hi].map((x) => x.trim()), col = (n) => H.indexOf(n);
  const i = { opp: col('Opponent'), mp: col('MP'), w: col('W'), d: col('D'), l: col('L'), gf: col('GF'), ga: col('GA'), pts: col('Pts'), xg: col('xG'), xga: col('xGA') };
  const num = (r, k) => (i[k] >= 0 && String(r[i[k]] || '').trim() !== '' ? fbNum(r[i[k]]) : NaN);
  const byKey = {};
  db.teams.forEach((t) => (byKey[fbTeamKey(t.name)] = t.id));
  const recs = [];
  rows.slice(hi + 1).forEach((r) => {
    const name = String(r[i.opp] || '').trim().replace(/^vs\.?\s+/i, '');
    if (!name || name === 'Opponent' || !/\p{L}/u.test(name)) return; // repeated headers, stray lines
    const rec = { name, oppId: byKey[fbTeamKey(name)] || null, mp: num(r, 'mp'), w: num(r, 'w'), d: num(r, 'd'), l: num(r, 'l'), gf: num(r, 'gf'), ga: num(r, 'ga'), pts: num(r, 'pts'), xg: num(r, 'xg'), xga: num(r, 'xga') };
    if (!(rec.mp > 0)) return;
    recs.push(rec);
  });
  db.records = db.records || {};
  db.records[teamId] = recs;
  return { clubs: recs.length, inLeague: recs.filter((r) => r.oppId).length, games: recs.reduce((s, r) => s + r.mp, 0) };
}

const FB_GROUP = { GK: 'GK', DF: 'DEF', MF: 'MID', FW: 'FWD' };
const fbNum = (s) => { const v = parseFloat(String(s == null ? '' : s).replace(/,/g, '').replace('%', '')); return Number.isFinite(v) ? v : 0; };

function fbReadTable(rows) {
  const hi = rows.findIndex((r) => r.map((x) => x.trim()).includes('Player'));
  if (hi < 0) return null;
  const names = rows[hi].map((x) => x.trim());
  // Over-header row (e.g. "Playing Time", "Per 90 Minutes") if present; blank cells continue the group to their left.
  const over = hi > 0 ? rows[hi - 1].map((x) => x.trim()) : [];
  let g = '';
  const cols = names.map((name, i) => { if (over[i]) g = over[i]; else if (!over.length) g = ''; return { name, group: over.length ? g : '' }; });
  const find = (name, after = -1) => cols.findIndex((c, i) => i > after && c.name === name && !/per 90/i.test(c.group));
  const idx = {
    n: find('MP'), st: find('Starts'), min: find('Min'), g: find('Gls'), ast: find('Ast'), xg: find('xG'), npxg: find('npxG'), xa: find('xAG'),
    progC: find('PrgC'), prog: find('PrgP'), sh: find('Sh'), sot: find('SoT'), key: find('KP'), f3e: find('1/3'),
    tkl: find('Tkl'), int: find('Int'), clr: find('Clr'), touch: find('Touches'), boxT: find('Att Pen'), rec: find('Recov'), fls: find('Fls'),
    pc: find('Cmp'), drbW: find('Succ'), n90: find('90s'), yc: find('CrdY'),
    // Goalkeeping table
    gaK: find('GA'), sota: find('SoTA'), saves: find('Saves'), cs: find('CS'),
    // Playing Time table: team results while the player is on the pitch
    onG: find('onG'), onGA: find('onGA'), ppm: find('PPM'), subs: find('Subs'),
  };
  idx.pa = idx.pc >= 0 && cols[idx.pc + 1] && cols[idx.pc + 1].name === 'Att' ? idx.pc + 1 : -1; // passes: Cmp then Att
  idx.drb = idx.drbW > 0 && cols[idx.drbW - 1].name === 'Att' ? idx.drbW - 1 : -1; // take-ons: Att then Succ
  if (idx.xa < 0) idx.xa = find('xA');
  const iP = names.indexOf('Player'), iPos = names.indexOf('Pos'), iNat = names.indexOf('Nation');
  const players = [];
  rows.slice(hi + 1).forEach((r) => {
    const name = (r[iP] || '').trim();
    if (!name || name === 'Player' || /^(Squad|Opponent) Total$/i.test(name) || !/\p{L}/u.test(name)) return; // repeated headers, summary rows, stray pasted lines
    const stats = {};
    Object.entries(idx).forEach(([k, i]) => { if (i >= 0) stats[k] = fbNum(r[i]); });
    // Tables other than Standard Stats give playing time only as 90s played
    const approxMin = !('min' in stats) && 'n90' in stats;
    if (approxMin) stats.min = Math.round(stats.n90 * 90);
    delete stats.n90;
    const pos = iPos >= 0 ? (r[iPos] || '').trim() : '';
    const nat = iNat >= 0 ? (r[iNat] || '').trim().split(/\s+/).pop() : '';
    players.push({ name, pos, nat, stats, approxMin });
  });
  const found = Object.entries(idx).filter(([k, i]) => i >= 0 && k !== 'n90').map(([k]) => k);
  return { players, found };
}

/* ---------- Club history (FBref club page: Domestic Leagues Results, International Cup Results, Season-by-Season Summary) ---------- */
const fbSeasonKey = (s) => { const m = String(s || '').match(/^(\d{4})-(\d{4})$/); return m ? m[1] + '/' + m[2].slice(2) : ''; };
// One paste can hold all three tables: find each header and read its season rows
function fbHistoryTables(text) {
  const rows = fdParseCSV(String(text || '').replace(/^\uFEFF/, ''));
  const out = {};
  let cur = null, head = null;
  rows.forEach((r) => {
    const c = r.map((x) => String(x || '').trim());
    if (c[0] === 'Season' && c[1] === 'Squad') {
      cur = c.includes('Domestic Leagues') ? 'summary' : c.includes('LgRank') && c.includes('Country') ? 'league' : c.includes('LgRank') ? 'europe' : null;
      head = c;
      if (cur) out[cur] = out[cur] || [];
      return;
    }
    if (!cur || !fbSeasonKey(c[0])) return;
    const o = {};
    head.forEach((k, i) => (o[k] = c[i] || ''));
    out[cur].push(o);
  });
  return out;
}
const fbIsHistory = (text) => { const t = fbHistoryTables(text); return !!(t.league || t.europe || t.summary); };
function attachFbHistory(db, teamId, text) {
  const t = fbHistoryTables(text);
  const key = fbTeamKey(db.teamById[teamId] ? db.teamById[teamId].name : teamId);
  const H = ((db.fbHistory = db.fbHistory || {})[key] = db.fbHistory[key] || { league: {}, europe: {}, summary: {} });
  const n = (v) => { const x = parseInt(String(v).replace(/[^0-9-]/g, ''), 10); return Number.isFinite(x) ? x : null; };
  (t.league || []).forEach((r) => { H.league[fbSeasonKey(r.Season)] = { comp: r.Comp.replace(/^\d+\.\s*/, ''), pos: n(r.LgRank), mp: n(r.MP), w: n(r.W), d: n(r.D), l: n(r.L), gf: n(r.GF), ga: n(r.GA), pts: n(r.Pts), att: n(r.Attendance), scorer: r['Top Team Scorer'], gk: r.Goalkeeper, notes: r.Notes }; });
  (t.europe || []).forEach((r) => { H.europe[fbSeasonKey(r.Season)] = { comp: r.Comp.replace(/^\d+\.\s*/, ''), stage: r.LgRank, mp: n(r.MP), w: n(r.W), d: n(r.D), l: n(r.L), gf: n(r.GF), ga: n(r.GA), att: n(r.Attendance), scorer: r['Top Team Scorer'], gk: r.Goalkeeper }; });
  (t.summary || []).forEach((r) => { const k = fbSeasonKey(r.Season); const eu = Object.entries(r).find(([h]) => /^Int'?l Cups/i.test(h)); H.summary[k] = { league: r['Domestic Leagues'] || '', europe: eu ? eu[1] : '' }; });
  return { league: Object.keys(H.league).length, europe: Object.values(H.summary).filter((x) => x.europe).length + Object.keys(H.europe).filter((k) => !(H.summary[k] && H.summary[k].europe)).length, from: Object.keys(H.league).sort()[0] };
}

/* ---------- Attendances: FBref league tables (one per season) and club histories ---------- */
// season ("2023/24") -> team key -> { name, att }; kept for the whole visit, whichever season is on screen
const ATT = {};
function fbLeagueTableRows(text) {
  const rows = fdParseCSV(String(text || '').replace(/^\uFEFF/, ''));
  const hi = rows.findIndex((r) => { const c = r.map((x) => String(x || '').trim()); return c.includes('Squad') && c.includes('Pts') && c.includes('Attendance') && (c.includes('Rk') || c.includes('MP')); });
  if (hi < 0) return null;
  const H = rows[hi].map((x) => String(x || '').trim());
  const iS = H.indexOf('Squad'), iA = H.indexOf('Attendance');
  return rows.slice(hi + 1).map((r) => ({ name: String(r[iS] || '').trim(), att: parseInt(String(r[iA] || '').replace(/[^0-9]/g, ''), 10) })).filter((x) => x.name && x.name !== 'Squad');
}
const fbIsLeagueTable = (text) => !!fbLeagueTableRows(text) && !fbIsHistory(text);
// Wikipedia season articles ("2023–24 Scottish Premiership" → Attendances): a table copied from the page
// arrives tab-separated, with a Team (or Club) column and an Average column
function wikiAttendanceRows(text) {
  const lines = String(text || '').split(/\r?\n/);
  const split = (l) => (l.includes('\t') ? l.split('\t') : l.split(/\s{2,}/)).map((x) => x.trim());
  const hi = lines.findIndex((l) => { const c = split(l).map((x) => x.toLowerCase()); return c.some((x) => /^(team|club)$/.test(x)) && c.some((x) => /^average/.test(x)); });
  if (hi < 0) return null;
  const H = split(lines[hi]).map((x) => x.toLowerCase());
  const iT = H.findIndex((x) => /^(team|club)$/.test(x)), iA = H.findIndex((x) => /^average/.test(x));
  const out = [];
  for (const l of lines.slice(hi + 1)) {
    const c = split(l);
    if (c.length < 2 || /^total|^league total/i.test(c[iT] || c[0])) { if (out.length && !l.trim()) break; continue; }
    const name = String(c[iT] || '').replace(/\[[^\]]*\]/g, '').replace(/[†‡*]/g, '').trim();
    const att = parseInt(String(c[iA] || '').replace(/\[[^\]]*\]/g, '').replace(/[^0-9]/g, ''), 10);
    if (name && /[a-z]/i.test(name) && Number.isFinite(att) && att > 0) out.push({ name, att });
  }
  return out.length >= 3 ? out : null;
}
const fbIsWikiAttendance = (text) => !!wikiAttendanceRows(text) && !fbLeagueTableRows(text);
// The season a league table is for: "2023-2024" in the pasted text, else the season on screen when it was pasted
const fbTextSeason = (text) => {
  const m = String(text || '').match(/(\d{4})-(\d{4})/);
  if (m && +m[2] === +m[1] + 1) return m[1] + '/' + m[2].slice(2);
  const w = String(text || '').match(/(\d{4})\s*[–-]\s*(\d{2})\b/); // Wikipedia: 2023–24
  return w && (+w[1] + 1) % 100 === +w[2] ? w[1] + '/' + w[2] : '';
};
function attachLeagueAttendance(text, fallbackSeason) {
  const season = fbTextSeason(text) || fallbackSeason;
  const rows = fbLeagueTableRows(text) || wikiAttendanceRows(text) || [];
  if (!season) return { season: '', teams: 0 };
  const S0 = (ATT[season] = ATT[season] || {});
  let n = 0;
  rows.forEach((r) => { if (Number.isFinite(r.att) && r.att > 0) { S0[fbTeamKey(r.name)] = { name: r.name, att: r.att }; n++; } });
  return { season, teams: n };
}
// Attendance files from tools/fetch-wiki-attendance.mjs: { source: 'touchline-attendance', seasons: { '1996/97': { Club: average } } }
const isAttendanceFile = (d) => d && d.source === 'touchline-attendance' && d.seasons && typeof d.seasons === 'object';
function addAttendanceFile(d) {
  let n = 0;
  Object.entries(d.seasons || {}).forEach(([season, clubs]) => {
    const S0 = (ATT[season] = ATT[season] || {});
    Object.entries(clubs || {}).forEach(([name, att]) => { const k = fbTeamKey(name); if (Number.isFinite(att) && att > 0 && !S0[k]) { S0[k] = { name, att, src: 'wikipedia' }; n++; } });
  });
  return { seasons: Object.keys(d.seasons || {}).length, entries: n };
}
function noteHistoryAttendance(db) {
  Object.entries(db.fbHistory || {}).forEach(([key, Hh]) => Object.entries(Hh.league || {}).forEach(([season, f]) => {
    if (f.att == null || f.att <= 0) return;
    const S0 = (ATT[season] = ATT[season] || {});
    if (!S0[key]) S0[key] = { name: db.teamById && Object.values(db.teamById).find((t) => fbTeamKey(t.name) === key) ? Object.values(db.teamById).find((t) => fbTeamKey(t.name) === key).name : key, att: f.att };
  }));
}

function attachFbref(db, teamId, texts) {
  const errors = [];
  let tables = 0, rowsRead = 0;
  db.seasonPS = db.seasonPS || {};
  const slug = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const fields = new Set();
  let fixtures = null, records = null, history = null, attendance = null;
  texts.forEach((t) => {
    if (fbIsHistory(t.text)) { history = attachFbHistory(db, teamId, t.text); noteHistoryAttendance(db); tables++; return; }
    if (fbIsLeagueTable(t.text) || fbIsWikiAttendance(t.text)) { attendance = attachLeagueAttendance(t.text, db.season); tables++; return; }
    const rows = fbParse(t.text);
    if (!fbIsTable(rows) && fbIsFixtures(rows)) { fixtures = attachFixtures(db, teamId, rows); tables++; return; }
    if (!fbIsTable(rows) && fbIsRecords(rows)) { records = attachRecords(db, teamId, rows); tables++; return; }
    if (!fbIsTable(rows)) { errors.push(`${t.name}: no FBref player table found (looking for a "Player" column).`); return; }
    const tab = fbReadTable(rows);
    if (!tab || !tab.players.length) { errors.push(`${t.name}: the table has no player rows.`); return; }
    tables++;
    tab.found.forEach((f) => fields.add(f));
    tab.players.forEach((p) => {
      const id = playerKey(teamId, p.name); // shared with other sources, so the same player merges
      // Positions come as "DF", "DF,MF" or "DFMF": the first one decides the group
      const codes = p.pos.toUpperCase().match(/GK|DF|MF|FW/g) || [];
      const code = codes[0] || '', role = codes.length ? codes.join('/') : p.pos || null;
      const ex = db.players[id];
      if (!ex) db.players[id] = { id, team: teamId, name: p.name, num: null, group: FB_GROUP[code] || 'MID', role, nation: p.nat };
      else {
        if (p.nat) ex.nation = p.nat;
        // Line-up data (exact positions such as RB) beats FBref's broad DF/MF
        if (p.pos && !ex.fromLineups) { ex.role = role; ex.group = FB_GROUP[code] || ex.group; }
      }
      let s = db.seasonPS[id];
      if (!s) { s = blankPlayer(); Object.keys(s).forEach((k) => { if (!['n', 'min', 'st'].includes(k)) s[k] = NaN; }); db.seasonPS[id] = s; }
      Object.entries(p.stats).forEach(([k, v]) => {
        if (k === 'min' && p.approxMin && s.min > 0) return; // keep exact minutes over 90s-based ones
        s[k] = v; // later tables fill in more columns
      });
      if (s.min > 0) rowsRead++; // count players who actually played
    });
  });
  // Drop players who did not play
  Object.keys(db.seasonPS).forEach((id) => { if (db.players[id] && db.players[id].team === teamId && !(db.seasonPS[id].min > 0)) { delete db.seasonPS[id]; delete db.players[id]; } });
  db.hasPlayers = Object.keys(db.players).length > 0;
  return { tables, rowsRead, fields: [...fields], errors, fixtures, records, history, attendance };
}

if (typeof module !== 'undefined') module.exports = { fbParse, fbIsTable, fbIsFixtures, fbIsRecords, fbReadTable, attachFbref };
