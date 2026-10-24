'use strict';
/* =====================================================================
   football-data.co.uk import
   One CSV per league season, e.g. https://www.football-data.co.uk/mmz4281/2627/SC0.csv
   (Scottish Premiership 2026/27). Gives results, team match stats where the
   file has them (xG, shots, shots on target, corners, fouls, cards) and
   bookmaker odds. No players, line-ups or pitch locations.
   ===================================================================== */

const FD_DIVISIONS = {
  SC0: 'Scottish Premiership', SC1: 'Scottish Championship', SC2: 'Scottish League One', SC3: 'Scottish League Two',
  E0: 'Premier League', E1: 'EFL Championship', E2: 'EFL League One', E3: 'EFL League Two', EC: 'National League',
  D1: 'Bundesliga', D2: '2. Bundesliga', SP1: 'La Liga', SP2: 'La Liga 2', I1: 'Serie A', I2: 'Serie B', F1: 'Ligue 1', F2: 'Ligue 2',
  N1: 'Eredivisie', B1: 'Belgian Pro League', P1: 'Primeira Liga', T1: 'Süper Lig', G1: 'Super League Greece',
};
// Odds columns, best first: market average, then individual bookmakers.
const FD_ODDS = [['AvgH', 'AvgD', 'AvgA'], ['BbAvH', 'BbAvD', 'BbAvA'], ['PSH', 'PSD', 'PSA'], ['B365H', 'B365D', 'B365A'], ['WHH', 'WHD', 'WHA']];

function fdParseCSV(text) {
  text = text.replace(/^﻿/, '');
  const rows = [];
  let row = [], f = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; }
      else f += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(f); rows.push(row); row = []; f = '';
    } else f += c;
  }
  if (f || row.length) { row.push(f); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim() !== ''));
}
function fdIsCSV(rows) {
  const h = rows && rows[0] ? rows[0].map((x) => x.trim()) : [];
  return (h.includes('HomeTeam') && h.includes('AwayTeam') && h.includes('FTHG')) || (h.includes('Home') && h.includes('Away') && h.includes('HG'));
}
function fdDate(s) {
  const m = String(s || '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!m) return '';
  let y = +m[3];
  if (y < 100) y += y >= 70 ? 1900 : 2000; // 2-digit years in older files: 94 = 1994
  return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}
const fdSlug = (s) => 'f' + String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function importFootballData(csvFiles) {
  // csvFiles: [{ name, rows }] where rows come from fdParseCSV
  const seasons = {};
  csvFiles.forEach((f) => {
    const head = f.rows[0].map((x) => x.trim());
    const col = (n) => head.indexOf(n);
    const pick = (...names) => { for (const n of names) { const i = col(n); if (i >= 0) return i; } return -1; };
    const iH = pick('HomeTeam', 'Home'), iA = pick('AwayTeam', 'Away'), iHG = pick('FTHG', 'HG'), iAG = pick('FTAG', 'AG');
    const iDiv = col('Div'), iDate = col('Date'), iLeague = col('League'), iSeason = col('Season');
    const odds = FD_ODDS.map((cols) => cols.map(col)).find((c) => c.every((i) => i >= 0));
    const iAtt = col('Attendance');
    const stat = { HxG: col('HxG'), AxG: col('AxG'), HS: col('HS'), AS: col('AS'), HST: col('HST'), AST: col('AST'), HC: col('HC'), AC: col('AC'), HF: col('HF'), AF: col('AF'), HY: col('HY'), AY: col('AY'), HR: col('HR'), AR: col('AR') };
    f.rows.slice(1).forEach((r) => {
      const home = (r[iH] || '').trim(), away = (r[iA] || '').trim();
      const hg = parseInt(r[iHG], 10), ag = parseInt(r[iAG], 10);
      if (!home || !away || Number.isNaN(hg) || Number.isNaN(ag)) return; // unplayed or blank rows
      const date = fdDate(r[iDate]);
      const div = iDiv >= 0 ? r[iDiv].trim() : iLeague >= 0 ? r[iLeague].trim() : '';
      let key = iSeason >= 0 ? String(r[iSeason]).trim() : '';
      if (!key && date) { const y = +date.slice(0, 4), mo = +date.slice(5, 7); const s = mo >= 7 ? y : y - 1; key = `${s}/${String((s + 1) % 100).padStart(2, '0')}`; }
      const k = div + '|' + key;
      (seasons[k] = seasons[k] || { div, season: key, rows: [] }).rows.push({ home, away, hg, ag, date, r, stat, odds, att: iAtt >= 0 ? parseInt(String(r[iAtt] || '').replace(/[^0-9]/g, ''), 10) : NaN });
    });
  });
  const keys = Object.keys(seasons);
  if (!keys.length) return { db: { matches: [] }, errors: ['No played matches found in the CSV file.'] };
  // One season at a time: take the most recent.
  keys.sort((a, b) => seasons[b].rows.reduce((m, x) => (x.date > m ? x.date : m), '').localeCompare(seasons[a].rows.reduce((m, x) => (x.date > m ? x.date : m), '')));
  const S0 = seasons[keys[0]];
  const errors = keys.length > 1 ? [`Loaded ${FD_DIVISIONS[S0.div] || S0.div} ${S0.season}. The other ${keys.length - 1} season(s) in the files were skipped: load one season at a time.`] : [];

  const teams = {}, matches = [], played = {};
  S0.rows.sort((a, b) => a.date.localeCompare(b.date));
  S0.rows.forEach((x, idx) => {
    const H = fdSlug(x.home), A = fdSlug(x.away);
    if (!teams[H]) teams[H] = { id: H, name: x.home, style: null };
    if (!teams[A]) teams[A] = { id: A, name: x.away, style: null };
    played[H] = (played[H] || 0) + 1; played[A] = (played[A] || 0) + 1;
    const num = (i) => { if (i < 0) return NaN; const v = parseFloat(x.r[i]); return Number.isFinite(v) ? v : NaN; };
    let pH = NaN, pD = NaN, pA = NaN;
    if (x.odds) {
      const o = x.odds.map(num);
      if (o.every((v) => v > 1)) { const inv = o.map((v) => 1 / v), s = inv[0] + inv[1] + inv[2]; [pH, pD, pA] = inv.map((v) => v / s); }
    }
    const ts = {};
    [[H, 'H', 'A'], [A, 'A', 'H']].forEach(([T, me, op]) => {
      const s = blankTeam();
      Object.keys(s).forEach((k) => { if (typeof s[k] === 'number') s[k] = NaN; });
      s.n = 1; s.g = T === H ? x.hg : x.ag; s.ga = T === H ? x.ag : x.hg;
      s.w = s.g > s.ga ? 1 : 0; s.d = s.g === s.ga ? 1 : 0; s.l = s.g < s.ga ? 1 : 0; s.pts = 3 * s.w + s.d;
      s.sh = num(x.stat[me + 'S']); s.sha = num(x.stat[op + 'S']); s.sot = num(x.stat[me + 'ST']);
      s.cor = num(x.stat[me + 'C']); s.fls = num(x.stat[me + 'F']); s.yc = num(x.stat[me + 'Y']); s.rc = num(x.stat[me + 'R']);
      s.xg = num(x.stat[me + 'xG']); s.xga = num(x.stat[op + 'xG']); // xG columns appear in recent seasons only
      s.mxp = T === H ? 3 * pH + pD : 3 * pA + pD;
      ts[T] = s;
    });
    matches.push({
      id: 'fd' + idx, round: Math.max(played[H], played[A]), date: x.date, home: H, away: A, hg: x.hg, ag: x.ag,
      forms: {}, lineups: { [H]: [], [A]: [] }, subs: { [H]: [], [A]: [] }, minutes: {}, events: [], poss: [], ts, ps: {}, timeline: [],
      odds: Number.isFinite(pH) ? { h: pH, d: pD, a: pA } : null, att: Number.isFinite(x.att) && x.att > 0 ? x.att : null,
    });
  });
  const y0 = parseInt(S0.season, 10);
  const lname = S0.div === 'SC0' && y0 ? (y0 < 1998 ? 'Scottish Premier Division' : y0 < 2013 ? 'Scottish Premier League' : 'Scottish Premiership') : FD_DIVISIONS[S0.div] || S0.div || 'League';
  const label = `${lname} ${S0.season} (football-data.co.uk)`;
  return { db: { source: 'football-data', label, season: S0.season, div: S0.div, teams: Object.values(teams), players: {}, matches }, errors };
}

if (typeof module !== 'undefined') module.exports = { importFootballData, fdParseCSV, fdIsCSV };
