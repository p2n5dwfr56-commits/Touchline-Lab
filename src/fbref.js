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
  const lines = text.split(/\r?\n/).slice(0, 4).join('\n');
  const tabs = (lines.match(/\t/g) || []).length, commas = (lines.match(/,/g) || []).length;
  if (tabs > commas) return text.split(/\r?\n/).map((l) => l.split('\t')).filter((r) => r.some((x) => x.trim() !== ''));
  return fdParseCSV(text);
}
function fbIsTable(rows) {
  return rows.slice(0, 4).some((r) => { const c = r.map((x) => x.trim()); return c.includes('Player') && c.some((x) => ['Min', '90s', 'MP', 'Starts', 'Sh', 'Cmp', 'Tkl', 'Touches'].includes(x)); });
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
    pc: find('Cmp'), drbW: find('Succ'), n90: find('90s'),
  };
  idx.pa = idx.pc >= 0 && cols[idx.pc + 1] && cols[idx.pc + 1].name === 'Att' ? idx.pc + 1 : -1; // passes: Cmp then Att
  idx.drb = idx.drbW > 0 && cols[idx.drbW - 1].name === 'Att' ? idx.drbW - 1 : -1; // take-ons: Att then Succ
  if (idx.xa < 0) idx.xa = find('xA');
  const iP = names.indexOf('Player'), iPos = names.indexOf('Pos'), iNat = names.indexOf('Nation');
  const players = [];
  rows.slice(hi + 1).forEach((r) => {
    const name = (r[iP] || '').trim();
    if (!name || name === 'Player' || /^(Squad|Opponent) Total$/i.test(name)) return; // repeated headers and summary rows
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
  texts.forEach((t) => {
    const rows = fbParse(t.text);
    if (!fbIsTable(rows)) { errors.push(`${t.name}: no FBref player table found (looking for a "Player" column).`); return; }
    const tab = fbReadTable(rows);
    if (!tab || !tab.players.length) { errors.push(`${t.name}: the table has no player rows.`); return; }
    tables++;
    tab.found.forEach((f) => fields.add(f));
    tab.players.forEach((p) => {
      const id = 'fb-' + teamId + '-' + slug(p.name);
      const code = (p.pos.split(',')[0] || '').trim();
      if (!db.players[id]) db.players[id] = { id, team: teamId, name: p.name, num: null, group: FB_GROUP[code] || 'MID', role: p.pos || null, nation: p.nat };
      else if (p.pos) { db.players[id].role = p.pos; db.players[id].group = FB_GROUP[code] || db.players[id].group; }
      let s = db.seasonPS[id];
      if (!s) { s = blankPlayer(); Object.keys(s).forEach((k) => { if (!['n', 'min', 'st'].includes(k)) s[k] = NaN; }); db.seasonPS[id] = s; }
      Object.entries(p.stats).forEach(([k, v]) => {
        if (k === 'min' && p.approxMin && s.min > 0) return; // keep exact minutes over 90s-based ones
        s[k] = v; // later tables fill in more columns
      });
      rowsRead++;
    });
  });
  // Drop players who did not play
  Object.keys(db.seasonPS).forEach((id) => { if (db.players[id] && db.players[id].team === teamId && !(db.seasonPS[id].min > 0)) { delete db.seasonPS[id]; delete db.players[id]; } });
  db.hasPlayers = Object.keys(db.players).length > 0;
  return { tables, rowsRead, fields: [...fields], errors };
}

if (typeof module !== 'undefined') module.exports = { fbParse, fbIsTable, fbReadTable, attachFbref };
