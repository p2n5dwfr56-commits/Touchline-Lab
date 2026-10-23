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
  .replace(/heart of midlothian/, 'hearts').replace(/\butd\b/, 'united').replace(/\b(fc|afc)\b/g, '').replace(/[^a-z0-9]+/g, '');
const fbDays = (a, b) => Math.abs(Date.parse(a + 'T12:00:00Z') - Date.parse(b + 'T12:00:00Z')) / 864e5;
function attachFixtures(db, teamId, rows) {
  const hi = rows.findIndex((r) => { const c = r.map((x) => x.trim()); return c.includes('Date') && c.includes('Opponent'); });
  const H = rows[hi].map((x) => x.trim()), col = (n) => H.indexOf(n);
  const i = { date: col('Date'), time: col('Time'), comp: col('Comp'), venue: col('Venue'), res: col('Result'), opp: col('Opponent'), poss: col('Poss'), att: col('Attendance'), cap: col('Captain'), form: col('Formation'), oform: col('Opp Formation'), ref: col('Referee') };
  const cell = (r, k) => (i[k] >= 0 ? String(r[i[k]] || '').trim() : '');
  const byKey = {};
  db.teams.forEach((t) => (byKey[fbTeamKey(t.name)] = t.id));
  const upcoming = [], unmatched = [];
  let played = 0, matched = 0;
  rows.slice(hi + 1).forEach((r) => {
    const date = cell(r, 'date');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return; // repeated headers, blank rows
    const opp = cell(r, 'opp'), oppId = byKey[fbTeamKey(opp)] || null, home = /home/i.test(cell(r, 'venue'));
    if (!cell(r, 'res')) { upcoming.push({ date, time: cell(r, 'time'), comp: cell(r, 'comp'), home, opp, oppId }); return; }
    played++;
    const m = oppId && db.matches.find((x) => (home ? x.home === teamId && x.away === oppId : x.away === teamId && x.home === oppId) && x.date && fbDays(x.date, date) <= 1);
    if (!m) { unmatched.push(`${date} ${cell(r, 'comp')} v ${opp}`); return; }
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
  db.fixtures[teamId] = upcoming.sort((a, b) => a.date.localeCompare(b.date));
  return { played, matched, unmatched, upcoming: upcoming.length };
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

function attachFbref(db, teamId, texts) {
  const errors = [];
  let tables = 0, rowsRead = 0;
  db.seasonPS = db.seasonPS || {};
  const slug = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const fields = new Set();
  let fixtures = null, records = null;
  texts.forEach((t) => {
    const rows = fbParse(t.text);
    if (!fbIsTable(rows) && fbIsFixtures(rows)) { fixtures = attachFixtures(db, teamId, rows); tables++; return; }
    if (!fbIsTable(rows) && fbIsRecords(rows)) { records = attachRecords(db, teamId, rows); tables++; return; }
    if (!fbIsTable(rows)) { errors.push(`${t.name}: no FBref player table found (looking for a "Player" column).`); return; }
    const tab = fbReadTable(rows);
    if (!tab || !tab.players.length) { errors.push(`${t.name}: the table has no player rows.`); return; }
    tables++;
    tab.found.forEach((f) => fields.add(f));
    tab.players.forEach((p) => {
      const id = 'fb-' + teamId + '-' + slug(p.name);
      // Positions come as "DF", "DF,MF" or "DFMF": the first one decides the group
      const codes = p.pos.toUpperCase().match(/GK|DF|MF|FW/g) || [];
      const code = codes[0] || '', role = codes.length ? codes.join('/') : p.pos || null;
      if (!db.players[id]) db.players[id] = { id, team: teamId, name: p.name, num: null, group: FB_GROUP[code] || 'MID', role, nation: p.nat };
      else if (p.pos) { db.players[id].role = role; db.players[id].group = FB_GROUP[code] || db.players[id].group; }
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
  return { tables, rowsRead, fields: [...fields], errors, fixtures, records };
}

if (typeof module !== 'undefined') module.exports = { fbParse, fbIsTable, fbIsFixtures, fbIsRecords, fbReadTable, attachFbref };
