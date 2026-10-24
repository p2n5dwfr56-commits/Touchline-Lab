'use strict';
/* =====================================================================
   Managers tab: every manager of each top-flight club since 1976
   Reads the manager history CSV (club, manager, appointment and departure
   dates with their precision, caretaker flags, sources) and sets each
   spell against the results, league finishes and trophies loaded.
   ===================================================================== */

// Club key -> spells, oldest first
const MGR = {};
let MGR_FROM = '';
// Club names in the CSV that differ from other sources
const mgrKey = (club) => fbTeamKey(String(club).replace(/\s*\(\d{4}\s*-\s*\d{4}\)\s*$/, '').replace(/^greenock\s+/i, ''));
function csvRows(text) {
  const rows = [];
  let cur = [], f = '', q = false;
  for (const ch of String(text).replace(/^﻿/, '')) {
    if (ch === '"') { q = !q; continue; }
    if (ch === ',' && !q) { cur.push(f); f = ''; continue; }
    if (ch === '\n' && !q) { cur.push(f.replace(/\r$/, '')); rows.push(cur); cur = []; f = ''; continue; }
    f += ch;
  }
  if (f || cur.length) { cur.push(f); rows.push(cur); }
  return rows.filter((r) => r.length > 3);
}
const isManagersCSV = (text) => /^﻿?club,manager,spell_number_for_club/i.test(String(text).trimStart());
// A date at the precision given: day as is, month from its 1st, year from the start (or end) of that season
function mgrDate(v, prec, end) {
  const s = String(v || '').trim();
  if (!s || /ongoing/i.test(prec)) return null;
  if (prec === 'day' || /^\d{4}-\d{2}-\d{2}$/.test(s)) return s.slice(0, 10);
  if (prec === 'month' || /^\d{4}-\d{2}$/.test(s)) return s.slice(0, 7) + (end ? '-28' : '-01');
  const y = parseInt(s, 10);
  return Number.isFinite(y) ? (end ? y + '-05-31' : y + '-06-01') : null;
}
function addManagersCSV(text, from) {
  const rows = csvRows(text), H = rows[0];
  const today = new Date().toISOString().slice(0, 10);
  let n = 0;
  rows.slice(1).forEach((r) => {
    const o = Object.fromEntries(H.map((k, i) => [k.trim(), (r[i] || '').trim()]));
    if (!o.club || !o.manager) return;
    const k = mgrKey(o.club);
    const ongoing = /ongoing/i.test(o.tenure_status || '') || !o.departure_date;
    const start = mgrDate(o.appointment_date, o.appointment_date_precision, false);
    const end = ongoing ? null : mgrDate(o.departure_date, o.departure_date_precision, true);
    if (!start) return;
    (MGR[k] = MGR[k] || []).push({
      club: o.club.replace(/\s*\(\d{4}\s*-\s*\d{4}\)\s*$/, ''), name: o.manager, spell: +o.spell_number_for_club || 0, start, end, to: end || today, ongoing,
      exact: o.appointment_date_precision === 'day' && (ongoing || o.departure_date_precision === 'day'),
      approx: o.appointment_date_precision === 'year' || o.departure_date_precision === 'year',
      caretaker: /caretaker|interim/i.test(o.manager_role || ''), joint: /co-manager|joint/i.test(o.manager_role || ''),
      quality: o.date_quality || '', source: o.primary_source_url || '',
    });
    n++;
  });
  Object.values(MGR).forEach((l) => l.sort((a, b) => a.start.localeCompare(b.start) || a.spell - b.spell));
  MGR_FROM = from || MGR_FROM;
  return { spells: n, clubs: Object.keys(MGR).length };
}
// Companion files: manager changes by calendar year, and a per-club turnover summary
let MGR_YEARS = [];
const MGR_SUM = {};
const isMgrYearsCSV = (text) => /^\uFEFF?calendar_year,appointments_count/i.test(String(text).trimStart());
const isMgrSummaryCSV = (text) => /^\uFEFF?club,spells_listed/i.test(String(text).trimStart());
const csvObjects = (text) => { const rows = csvRows(text), H = rows[0].map((x) => x.trim()); return rows.slice(1).map((r) => Object.fromEntries(H.map((k, i) => [k, (r[i] || '').trim()]))); };
function addMgrYears(text) { MGR_YEARS = csvObjects(text).map((o) => ({ year: +o.calendar_year, app: +o.appointments_count || 0, dep: +o.departures_count || 0, caveat: o.data_caveat || '' })).filter((o) => o.year); return MGR_YEARS.length; }
function addMgrSummary(text) { const l = csvObjects(text); l.forEach((o) => { if (o.club) MGR_SUM[mgrKey(o.club)] = o; }); return l.length; }
// Which kind of manager file a CSV is, and how to add it
function addManagerFile(text, name) {
  if (isManagersCSV(text)) { Object.keys(MGR).forEach((k) => delete MGR[k]); const r = addManagersCSV(text, name); return { kind: 'history', msg: `${r.spells} managerial spells for ${r.clubs} clubs` }; }
  if (isMgrYearsCSV(text)) return { kind: 'years', msg: `manager changes for ${addMgrYears(text)} calendar years` };
  if (isMgrSummaryCSV(text)) return { kind: 'summary', msg: `manager turnover figures for ${addMgrSummary(text)} clubs` };
  return null;
}
const isManagerFile = (text) => isManagersCSV(text) || isMgrYearsCSV(text) || isMgrSummaryCSV(text);
async function saveManagersFile(f) { const kind = isManagersCSV(f.text) ? 'managers' : isMgrYearsCSV(f.text) ? 'mgrYears' : 'mgrSum'; return storeSet(kind, { name: f.name, text: f.text }); }
async function restoreManagers() {
  if (SNAP && SNAP.managers) addManagersCSV(SNAP.managers, 'built-in');
  if (SNAP && SNAP.managersByYear) addMgrYears(SNAP.managersByYear);
  if (SNAP && SNAP.managersSummary) addMgrSummary(SNAP.managersSummary);
  for (const k of ['managers', 'mgrYears', 'mgrSum']) { const saved = await storeGet(k); if (saved) { try { addManagerFile(saved.text, saved.name); } catch (e) { /* skip a damaged file */ } } }
}

const daysBetween = (a, b) => Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 864e5);
const tenure = (d) => (d >= 730 ? (d / 365.25).toFixed(1) + ' yrs' : d >= 60 ? Math.round(d / 30.44) + ' months' : d + ' days');

// Every match the club played in the loaded seasons (league from 1994/95, cups where loaded), oldest first
function clubMatches(key) {
  return memo('clubMatches|' + key + '|' + allSeasons().length + '|' + (SEASONS.real ? SEASONS.real.matches.length + '|' + (SEASONS.real.cups || []).length : 0), () => {
    const out = [];
    allSeasons().forEach((x) => {
      const db = x.current ? SEASONS.real || x.db : x.db || seasonDB(x.season);
      if (!db || !db.matches) return;
      const t = db.teams.find((z) => fbTeamKey(z.name) === key);
      if (!t) return;
      const nm = (id) => (db.teamById && db.teamById[id] ? db.teamById[id].name : id);
      db.matches.concat(db.cups || []).forEach((m) => { if ((m.home === t.id || m.away === t.id) && m.date) out.push({ m, T: t.id, season: x.season, date: m.date.slice(0, 10), cup: !!m.cup, me: t.name, opp: nm(m.home === t.id ? m.away : m.home) }); });
    });
    return out.sort((a, b) => a.date.localeCompare(b.date));
  });
}
// A spell's record: matches between its dates (exact dates only), league finishes and trophies at season ends inside it
function spellRecord(sp, key, all, opts = {}) {
  const ms = sp.approx ? [] : all.filter((x) => x.date >= sp.start && x.date <= sp.to && (opts.cups !== false || !x.cup));
  let w = 0, d = 0, l = 0, gf = 0, ga = 0;
  const res = ms.map((x) => { const r = result(x.m, x.T); if (r === 'W') w++; else if (r === 'D') d++; else l++; gf += goalsFor(x.m, x.T); ga += goalsAg(x.m, x.T); return r; });
  const pts = (rs) => rs.reduce((t, r) => t + (r === 'W' ? 3 : r === 'D' ? 1 : 0), 0);
  let n = ms.length, p3 = pts(res);
  // Seasons that ended (31 May) while in charge: final league position and trophies
  const P = seasonPositions(), H = CLUBHIST[key];
  const finishes = [], trophies = [], histSeasons = [], partSeasons = [];
  const matchSeasons = new Set(all.filter((x) => !x.cup).map((x) => x.season));
  for (let y = parseInt(sp.start, 10); y <= parseInt(sp.to, 10); y++) {
    const endDay = y + '-05-20', season = (y - 1) + '/' + String(y % 100).padStart(2, '0');
    const hs = H && H.seasons[season];
    // Before match-by-match results: a whole league season in charge counts from the club history's record
    if (!matchSeasons.has(season) && hs && hs.pld != null && y - 1 >= 1975) {
      if (sp.start <= (y - 1) + '-08-10' && sp.to >= y + '-05-01') {
        n += hs.pld; w += hs.w || 0; d += hs.d || 0; l += hs.l || 0; gf += hs.gf || 0; ga += hs.ga || 0; p3 += 3 * (hs.w || 0) + (hs.d || 0);
        histSeasons.push(season);
      } else if (sp.start < y + '-05-01' && sp.to > (y - 1) + '-08-10') partSeasons.push(season);
    }
    if (endDay < sp.start || endDay > sp.to) continue;
    const pos = P[season] && P[season][key];
    if (pos) finishes.push({ season, pos: pos.pos });
    if (pos && pos.pos === 1) trophies.push('League ' + season);
    if (hs && /^(w|winners?)$/i.test(hs.scottishCup || '')) trophies.push('Scottish Cup ' + season);
    if (hs && /^(w|winners?)$/i.test(hs.leagueCup || '')) trophies.push('League Cup ' + season);
    // European trophies ("Cup Winners' Cup · Winners; Super Cup · Winners")
    if (hs && hs.europe) String(hs.europe).split(/;/).forEach((part) => { const m2 = part.match(/^\s*(.+?)\s*[·–-]\s*(W|Winners?)\s*$/i); if (m2 && !/challenge cup/i.test(m2[1])) trophies.push(m2[1].trim() + ' ' + season); });
  }
  return { n, w, d, l, gf, ga, ppg: n ? p3 / n : NaN, first10: res.length >= 10 ? pts(res.slice(0, 10)) / 10 : NaN, last10: res.length >= 10 ? pts(res.slice(-10)) / 10 : NaN, res, ms, finishes, trophies, histSeasons, partSeasons, best: finishes.length ? Math.min(...finishes.map((f) => f.pos)) : null };
}

function viewManagers(el) {
  const key = fbTeamKey(teamName(S.team));
  if (!Object.keys(MGR).length) {
    el.append(card({ title: 'Managers', span: true }, null, h('p', { class: 'note', style: { marginTop: 0 }, text: 'No manager history is loaded. Drop the manager history CSV (club, manager, appointment and departure dates) in the Data tab.' })));
    return;
  }
  const spells = MGR[key] || [];
  const all = clubMatches(key);
  const withCt = S.mgrCaretakers === 'yes';
  const list = spells.filter((s) => withCt || !s.caretaker);
  const recs = new Map(spells.map((s) => [s, spellRecord(s, key, all)]));
  const cur = spells.filter((s) => s.ongoing && !s.caretaker).slice(-1)[0] || spells.filter((s) => s.ongoing).slice(-1)[0];
  const A = css('--team-a');
  el.append(h('div', { class: 'hero' }, h('h1', { text: teamName(S.team) }), h('div', { class: 'meta' },
    h('span', { text: cur ? `Manager: ${cur.name} · since ${fmtLong(cur.start)} · ${tenure(daysBetween(cur.start, cur.to))}` : spells.length ? 'No current manager listed' : 'Not in the manager history' }))));
  if (!spells.length) { el.append(card({ title: 'Managers', span: true }, null, h('p', { class: 'note', style: { marginTop: 0 }, text: `${teamName(S.team)} is not in the manager history. It covers: ${[...new Set(Object.values(MGR).map((l) => l[0].club))].sort().join(', ')}.` }))); leagueManagers(el, key); return; }

  // Headline numbers (permanent managers since 1976)
  const perm = spells.filter((s) => !s.caretaker && s.to >= '1976-01-01');
  const ended = perm.filter((s) => !s.ongoing);
  const avg = ended.length ? ended.reduce((t, s) => t + daysBetween(s.start, s.to), 0) / ended.length : NaN;
  const longest = perm.slice().sort((a, b) => daysBetween(b.start, b.to) - daysBetween(a.start, a.to))[0];
  const curRank = cur ? Object.values(MGR).map((l) => l.filter((s) => s.ongoing && !s.caretaker).slice(-1)[0]).filter(Boolean).sort((a, b) => a.start.localeCompare(b.start)).indexOf(cur) + 1 : 0;
  const nCur = Object.values(MGR).filter((l) => l.some((s) => s.ongoing && !s.caretaker)).length;
  el.append(h('div', { class: 'kpis' }, [
    ['Managers since 1976', perm.length, 'permanent appointments · ' + spells.filter((s) => s.caretaker).length + ' caretaker spells'],
    ['Average tenure', Number.isFinite(avg) ? tenure(Math.round(avg)) : '–', 'of managers who have left'],
    ['Longest serving', longest ? longest.name : '–', longest ? tenure(daysBetween(longest.start, longest.to)) + ` (${longest.start.slice(0, 4)}–${longest.ongoing ? 'now' : longest.to.slice(0, 4)})` : ''],
    ['Current manager', cur ? tenure(daysBetween(cur.start, cur.to)) : '–', cur && curRank ? `${ordinal(curRank)} longest in post of ${nCur} clubs listed` : ''],
  ].map(([l, v, r]) => h('div', { class: 'kpi' }, h('div', { class: 'eyebrow', text: l }), h('div', { class: 'v', text: v }), h('div', { class: 'r', text: r })))));

  const grid = h('div', { class: 'grid' });
  el.append(grid);
  const tools = seg([['no', 'Permanent'], ['yes', 'With caretakers']], withCt ? 'yes' : 'no', (v) => { S.mgrCaretakers = v; const y = window.scrollY; render(); window.scrollTo(0, y); }, 'Managers shown');
  const tl = card({ title: 'Managers and league finishes', span: true, tools }, `${teamName(S.team)}’s managers since 1976, with the league finish each season (top flight) · hover a bar for the record`);
  grid.append(tl);
  mgrTimeline(tl, list, key, recs);

  // The managers, newest first
  const sel = list.find((s) => s.name + s.start === S.mgrSel) || null;
  const anyRec = list.some((s) => recs.get(s).n);
  // Sortable columns: key, heading, value (null sorts last), first direction (1 up, -1 down)
  const MCOLS = [
    ['name', 'Manager', (s) => s.name.split(' ').slice(-1)[0] + ' ' + s.name, 1], ['from', 'From', (s) => s.start, -1], ['to', 'To', (s) => s.to, -1],
    ['tenure', 'Tenure', (s) => daysBetween(s.start, s.to), -1], ['n', 'P', (s) => recs.get(s).n || null, -1], ['wdl', 'W-D-L', (s) => recs.get(s).n ? recs.get(s).w : null, -1],
    ['win', 'Win %', (s) => (recs.get(s).n ? recs.get(s).w / recs.get(s).n : null), -1], ['ppg', 'PPG', (s) => (recs.get(s).n ? recs.get(s).ppg : null), -1],
    ['gd', 'GF–GA / game', (s) => (recs.get(s).n ? (recs.get(s).gf - recs.get(s).ga) / recs.get(s).n : null), -1], ['first10', 'First 10', (s) => (Number.isFinite(recs.get(s).first10) ? recs.get(s).first10 : null), -1],
    ['best', 'Best finish', (s) => recs.get(s).best, 1], ['trophies', 'Trophies', (s) => recs.get(s).trophies.length || null, -1],
  ];
  const msort = S.mgrSort && MCOLS.some(([k]) => k === S.mgrSort.k) ? S.mgrSort : { k: 'from', dir: -1 };
  const mval = MCOLS.find(([k]) => k === msort.k)[2];
  const sortedList = list.slice().sort((a, b) => {
    const va = mval(a), vb = mval(b);
    if (va == null && vb == null) return b.start.localeCompare(a.start);
    if (va == null) return 1;
    if (vb == null) return -1; // blanks last either way
    return (typeof va === 'string' ? va.localeCompare(vb) : va - vb) * msort.dir || b.start.localeCompare(a.start);
  });
  grid.append(card({ title: 'Every manager', span: true }, 'Results between appointment and departure (every match from 1994/95; whole league seasons before) · league finishes and trophies at the end of each season in charge · click a heading to sort, a manager for detail',
    h('div', { class: 'tbl-wrap' }, h('table', null,
      h('thead', null, h('tr', null, MCOLS.map(([k, t, , first], i) => {
        const on = msort.k === k, tip = t === 'PPG' ? 'Points per game, 3 for a win' : t === 'First 10' ? 'Points per game in the first 10 matches' : null;
        return h('th', { class: (i <= 2 || i === 11 ? 'l ' : '') + 'sortable' + (on ? ' sorted' : ''), title: (tip ? tip + ' · ' : '') + 'Click to sort', 'aria-sort': on ? (msort.dir > 0 ? 'ascending' : 'descending') : 'none',
          onclick: () => { S.mgrSort = { k, dir: on ? -msort.dir : first }; const y = window.scrollY; render(); window.scrollTo(0, y); } }, t, on ? h('span', { class: 'sort-arrow', text: msort.dir > 0 ? ' ▲' : ' ▼' }) : null);
      }))),
      h('tbody', null, sortedList.map((s) => {
        const r = recs.get(s);
        return h('tr', { class: sel === s ? 'focus' : '', onclick: () => { S.mgrSel = sel === s ? null : s.name + s.start; const y = window.scrollY; render(); window.scrollTo(0, y); }, title: s.approx ? 'Dates known to the year only: no match record' : '' },
          h('td', { class: 'l' }, h('b', { text: s.name }), s.caretaker ? h('span', { class: 'sub', text: ' caretaker' }) : s.joint ? h('span', { class: 'sub', text: ' joint' }) : null),
          h('td', { class: 'l sub', text: fmtLong(s.start) + (s.approx ? ' ≈' : '') }), h('td', { class: 'l sub', text: s.ongoing ? 'now' : fmtLong(s.to) }),
          h('td', { text: tenure(daysBetween(s.start, s.to)) }),
          h('td', { title: r.histSeasons.length ? `Includes ${r.histSeasons.length} whole league season${r.histSeasons.length > 1 ? 's' : ''} from the club history (${r.histSeasons.join(', ')})` + (r.partSeasons.length ? `; part-seasons not counted (${r.partSeasons.join(', ')})` : '') : r.partSeasons.length ? `Part-seasons not counted (${r.partSeasons.join(', ')})` : null }, r.n ? String(r.n) : '–', r.histSeasons.length ? h('sup', { class: 'sub', text: '*' }) : null), h('td', { text: r.n ? `${r.w}-${r.d}-${r.l}` : '' }), h('td', { text: r.n ? Math.round((100 * r.w) / r.n) + '%' : '' }),
          h('td', null, h('b', { text: r.n ? r.ppg.toFixed(2) : '' })), h('td', { text: r.n ? `${(r.gf / r.n).toFixed(2)}–${(r.ga / r.n).toFixed(2)}` : '' }),
          h('td', { text: Number.isFinite(r.first10) ? r.first10.toFixed(1) : '' }),
          h('td', { text: r.best ? ordinal(r.best) : '' }), h('td', { class: 'l sub', text: r.trophies.join(', ') }));
      })))),
    h('p', { class: 'note', text: (anyRec ? 'Records count every match from 1994/95 (league and cups, from the loaded results); before that, * whole league seasons in charge from the club history (league only; a season shared between managers is left out). ' : '') + 'Trophies and finishes are credited to the manager in charge when each season ended. ≈ dates known to the year only. Manager dates: ' + (MGR_FROM === 'built-in' ? 'your manager history CSV' : MGR_FROM || 'your manager history CSV') + ' (sources listed per spell in the file).' })));

  if (sel) grid.append(managerDetail(sel, recs.get(sel), list, recs));

  // Points per game by manager (enough matches to judge)
  const ranked = list.filter((s) => recs.get(s).n >= 15).sort((a, b) => recs.get(b).ppg - recs.get(a).ppg);
  if (ranked.length >= 3) {
    const c = card({ title: 'Points per game by manager', span: true }, `Managers with 15 or more matches counted · league and cup from 1994/95, whole league seasons before · 3 points a win`);
    c.append(h('div', { class: 'mgr-bars' }, ranked.map((s) => {
      const r = recs.get(s);
      return h('div', { class: 'mgr-bar' }, h('span', { class: 'l', text: s.name + (s.spell > 1 && spells.filter((x) => x.name === s.name).length > 1 ? ` (${s.start.slice(0, 4)})` : '') }),
        h('span', { class: 'b' }, h('i', { style: { width: (100 * r.ppg) / 3 + '%', background: s === cur ? A : 'var(--c1)' } })), h('b', { text: r.ppg.toFixed(2) }), h('span', { class: 'sub', text: `${r.n} matches` }));
    })));
    grid.append(c);
  }
  leagueManagers(grid, key);
}
const fmtLong = (d) => new Date(d + 'T12:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

// One lane of manager bars across the years, with the league finish line beneath
function mgrTimeline(box, list, key, recs) {
  const W = 1100, laneH = 34, H = 230, m = { l: 34, r: 12, t: 8, b: 26 };
  const y0 = 1976, y1 = new Date().getUTCFullYear() + 1;
  const X = (d) => m.l + ((Date.parse(d + 'T12:00:00Z') - Date.parse(y0 + '-01-01T12:00:00Z')) / (Date.parse(y1 + '-01-01T12:00:00Z') - Date.parse(y0 + '-01-01T12:00:00Z'))) * (W - m.l - m.r);
  const svg = sv('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', role: 'img', 'aria-label': 'Managers and league finishes by year' });
  const ax = sv('g', { class: 'axis' });
  for (let y = 1980; y < y1; y += 5) { ax.append(sv('line', { x1: X(y + '-01-01'), x2: X(y + '-01-01'), y1: m.t, y2: H - m.b, class: 'grid-line' })); ax.append(sv('text', { x: X(y + '-01-01'), y: H - 8, 'text-anchor': 'middle', text: y })); }
  svg.append(ax);
  const cols = [css('--c1'), css('--c3'), css('--c4'), css('--c5')];
  let k = 0;
  // Joint managers (overlapping spells) share the lane as two half-height bars
  const perm = list.filter((s) => !s.caretaker), half = new Map();
  perm.forEach((s, i) => { const o = perm.find((t, j) => j !== i && t.start < s.to && s.start < t.to && Math.min(daysBetween(s.start, t.to), daysBetween(t.start, s.to)) > 60); if (o) half.set(s, perm.indexOf(o) < i ? 1 : 0); });
  list.forEach((s) => {
    if (s.to < y0 + '-01-01') return;
    const x0 = Math.max(m.l, X(s.start < y0 + '-01-01' ? y0 + '-01-01' : s.start)), x1 = X(s.to), w = Math.max(2, x1 - x0);
    const col = s.caretaker ? css('--muted') : cols[k++ % cols.length];
    const hv = half.get(s), lane = s.caretaker ? m.t + laneH * 0.55 : hv != null ? m.t + hv * laneH * 0.5 : m.t;
    const bh = s.caretaker ? laneH * 0.45 : hv != null ? laneH * 0.5 - 1 : laneH;
    const rect = sv('rect', { x: x0, y: lane, width: w, height: bh, fill: col, opacity: s.approx ? 0.55 : 0.9, rx: 3, tabindex: 0 });
    const r = recs.get(s);
    hover(rect, () => [{ v: s.name + (s.caretaker ? ' (caretaker)' : ''), strong: true }, { v: `${fmtLong(s.start)} – ${s.ongoing ? 'now' : fmtLong(s.to)} · ${tenure(daysBetween(s.start, s.to))}` }, r.n ? { v: `${r.n} matches · ${r.w}W ${r.d}D ${r.l}L · ${r.ppg.toFixed(2)} pts a game` } : null, r.trophies.length ? { v: r.trophies.join(', ') } : null].filter(Boolean));
    rect.addEventListener('click', () => { S.mgrSel = s.name + s.start; const y = window.scrollY; render(); window.scrollTo(0, y); });
    svg.append(rect);
    const surname = s.name.split(' ').slice(-1)[0];
    if (!s.caretaker && w > surname.length * 6.5 + 6) svg.append(sv('text', { x: x0 + 4, y: lane + bh / 2 + 4, class: 'mgr-lbl', text: surname }));
  });
  // League finishes (top flight), at each season's end
  const P = seasonPositions(), fin = [];
  Object.entries(P).forEach(([season, t]) => { if (t[key]) fin.push({ d: (parseInt(season, 10) + 1) + '-05-15', pos: t[key].pos, season }); });
  fin.sort((a, b) => a.d.localeCompare(b.d));
  const top = m.t + laneH + 16, bot = H - m.b - 4, maxP = Math.max(12, ...fin.map((f) => f.pos));
  const Y = (p) => top + ((p - 1) * (bot - top)) / (maxP - 1);
  [1, 6, 12].filter((p) => p <= maxP).forEach((p) => { svg.append(sv('line', { x1: m.l, x2: W - m.r, y1: Y(p), y2: Y(p), class: 'grid-line' })); svg.append(sv('text', { x: m.l - 6, y: Y(p) + 4, 'text-anchor': 'end', class: 'axis-t', text: ordinal(p) })); });
  const pts = fin.filter((f) => f.d >= y0 + '-01-01');
  let d = '';
  pts.forEach((f, i) => { const gap = i && parseInt(f.season, 10) - parseInt(pts[i - 1].season, 10) > 1; d += (i && !gap ? 'L' : 'M') + X(f.d).toFixed(1) + ' ' + Y(f.pos).toFixed(1); });
  svg.append(sv('path', { d, fill: 'none', stroke: css('--team-a'), 'stroke-width': 1.8 }));
  pts.forEach((f) => { const c = sv('circle', { cx: X(f.d), cy: Y(f.pos), r: f.pos === 1 ? 4.5 : 2.6, fill: f.pos === 1 ? css('--warn') : css('--team-a'), tabindex: 0 }); hover(c, () => [{ v: f.season, strong: true }, { v: ordinal(f.pos) + ' in the league' }]); svg.append(c); });
  box.append(svg, legend([['Manager in charge', cols[0]], ['Caretaker', css('--muted')], ['League finish', css('--team-a'), 'line'], ['Champions', css('--warn')]]));
}

// One manager: results in order and season by season
function managerDetail(s, r, list, recs) {
  const c = card({ title: s.name, span: true }, `${s.club} · ${fmtLong(s.start)} – ${s.ongoing ? 'now' : fmtLong(s.to)} · ${tenure(daysBetween(s.start, s.to))}${s.caretaker ? ' · caretaker' : ''}`);
  if (!r.n) { c.append(h('p', { class: 'note', style: { marginTop: 0 }, text: s.approx ? 'Dates are known to the year only, so no matches are credited.' : 'No matches loaded for this spell (league results start in 1994/95).' })); return c; }
  const i = list.indexOf(s), prev = list.slice(0, i).reverse().find((x) => !x.caretaker && recs.get(x).n >= 10);
  const stat = (items) => h('div', { class: 'statline' }, items.map(([v, l]) => h('div', null, h('b', { text: v }), h('span', { text: l }))));
  const bar = wdlBar(r.w, r.d, r.l); bar.classList.add('wide');
  c.append(stat([[r.n, 'Matches'], [`${r.w} · ${Math.round((100 * r.w) / r.n)}%`, 'Won'], [r.d, 'Drawn'], [r.l, 'Lost'], [r.ppg.toFixed(2), 'Points a game'], [`${r.gf}–${r.ga}`, 'Goals']]), bar);
  if (Number.isFinite(r.first10) && prev) c.append(h('p', { class: 'note', text: `First 10 matches: ${r.first10.toFixed(1)} points a game, against ${recs.get(prev).last10.toFixed(1)} in ${prev.name}’s last 10.` }));
  if (r.ms.length) c.append(h('div', { class: 'eyebrow', style: { margin: '10px 0 6px' }, text: 'Every result, in order' }), h('div', { class: 'h2h-strip' }, r.ms.map((x, j) => {
    const e = h('span', { class: r.res[j], tabindex: 0 });
    hover(e, () => [{ v: `${fmtLong(x.date)} · ${x.cup ? roundLabel(x.m) : 'League'}`, strong: true }, { v: `${x.me} ${goalsFor(x.m, x.T)}–${goalsAg(x.m, x.T)} ${x.opp} (${x.m.neutral ? 'N' : x.m.home === x.T ? 'H' : 'A'})` }]);
    return e;
  })));
  // Season by season
  const by = {};
  const H = CLUBHIST[mgrKey(s.club)];
  r.histSeasons.forEach((season) => { const hs = H.seasons[season]; by[season] = { n: hs.pld, w: hs.w || 0, d: hs.d || 0, l: hs.l || 0, pts: 3 * (hs.w || 0) + (hs.d || 0), hist: true }; });
  r.ms.forEach((x, j) => { const b = (by[x.season] = by[x.season] || { n: 0, w: 0, d: 0, l: 0, pts: 0 }); b.n++; const q = r.res[j]; b[q === 'W' ? 'w' : q === 'D' ? 'd' : 'l']++; b.pts += q === 'W' ? 3 : q === 'D' ? 1 : 0; });
  c.append(h('div', { class: 'tbl-wrap', style: { marginTop: '12px' } }, h('table', null, h('thead', null, h('tr', null, ['Season', 'P', 'W-D-L', 'PPG', 'League finish'].map((t, k) => h('th', { class: k === 0 ? 'l' : '', text: t })))),
    h('tbody', null, Object.entries(by).sort((a, b2) => a[0].localeCompare(b2[0])).map(([season, b]) => { const f = r.finishes.find((x) => x.season === season); return h('tr', { style: { cursor: 'default' } }, h('td', { class: 'l' }, h('b', { text: season }), b.hist ? h('span', { class: 'sub', text: ' league' }) : null), h('td', { text: b.n }), h('td', { text: `${b.w}-${b.d}-${b.l}` }), h('td', { text: (b.pts / b.n).toFixed(2) }), h('td', { text: f ? ordinal(f.pos) : '' })); })))));
  return c;
}

// Across the league: who has been in post longest, and how often each club changes manager
function leagueManagers(grid, key) {
  const today = new Date().toISOString().slice(0, 10);
  const clubs = DB.teams.map((t) => ({ t, k: fbTeamKey(t.name) })).filter((x) => MGR[x.k]);
  if (clubs.length < 3) return;
  const hasSum = Object.keys(MGR_SUM).length > 0;
  const rows = clubs.map(({ t, k }) => {
    const l = MGR[k], cur = l.filter((s) => s.ongoing && !s.caretaker).slice(-1)[0] || l.filter((s) => s.ongoing).slice(-1)[0];
    const perm = l.filter((s) => !s.caretaker && s.to >= '1976-01-01'), ended = perm.filter((s) => !s.ongoing);
    const since = (y) => perm.filter((s) => s.start >= y).length;
    return { t, k, cur, n: perm.length, n10: since(String(+today.slice(0, 4) - 10)), avg: ended.length ? ended.reduce((s2, s) => s2 + daysBetween(s.start, s.to), 0) / ended.length : NaN };
  }).sort((a, b) => (a.cur ? a.cur.start : '9999').localeCompare(b.cur ? b.cur.start : '9999'));
  grid.append(card({ title: 'Managers across the league', span: true }, `This season’s clubs · longest in post first · click a club to see its managers`, h('div', { class: 'tbl-wrap' }, h('table', null,
    h('thead', null, h('tr', null, ['Club', 'Manager', 'Appointed', 'In post', 'Managers since 1976', 'In the last 10 years', 'Average tenure'].concat(hasSum ? ['Median tenure', 'Appointments since 2016'] : []).map((t, i) => h('th', { class: i <= 2 ? 'l' : '', text: t })))),
    h('tbody', null, rows.map((r) => h('tr', { class: r.k === key ? 'focus' : '', onclick: () => { S.team = r.t.id; S.mgrSel = null; render(); window.scrollTo({ top: 0, behavior: 'smooth' }); } },
      h('td', { class: 'l' }, h('b', { text: r.t.name })), h('td', { class: 'l', text: r.cur ? r.cur.name + (r.cur.caretaker ? ' (caretaker)' : '') : '–' }), h('td', { class: 'l sub', text: r.cur ? fmtLong(r.cur.start) : '' }),
      h('td', { text: r.cur ? tenure(daysBetween(r.cur.start, today)) : '' }), h('td', { text: r.n }), h('td', { text: r.n10 }), h('td', { text: Number.isFinite(r.avg) ? tenure(Math.round(r.avg)) : '–' }),
      hasSum ? [h('td', { text: MGR_SUM[r.k] && MGR_SUM[r.k].median_tenure_days_ended_exact ? tenure(+MGR_SUM[r.k].median_tenure_days_ended_exact) : '–' }), h('td', { text: MGR_SUM[r.k] ? MGR_SUM[r.k].manager_appointments_since_2016_01_01 || '–' : '–' })] : null)))),
    hasSum ? h('p', { class: 'note', text: 'Median tenure and appointments since 2016 are from your manager turnover summary (ended spells with exact dates; some eras’ records are incomplete).' }) : null)));
  // Manager changes across the clubs, year by year
  if (MGR_YEARS.length >= 5) {
    const c = card({ title: 'Manager changes by year', span: true }, 'Appointments at clubs that have played in the top flight since 1976, all divisions · ' + (MGR_YEARS[0].caveat || ''));
    const b = h('div'); c.append(b); grid.append(c);
    const ys = MGR_YEARS.slice().sort((a, b2) => a.year - b2.year), A = css('--team-a'), B = css('--ink-2');
    lineChart(b, { labels: ys.map((y) => String(y.year)), series: [{ name: 'Appointments', color: A, values: ys.map((y) => y.app) }, { name: 'Departures', color: B, dash: '5 4', values: ys.map((y) => y.dep) }], yFmt: (v) => v.toFixed(0),
      tipFor: (i) => [{ v: String(ys[i].year), strong: true }, { color: A, v: ys[i].app, l: 'appointments' }, { color: B, v: ys[i].dep, l: 'departures' }] });
    const busiest = ys.slice().sort((a, b2) => b2.app - a.app)[0];
    c.append(legend([['Appointments', A, 'line'], ['Departures', B, 'line line-dash']]), h('p', { class: 'note', text: `Busiest year: ${busiest.year}, with ${busiest.app} appointments. Source: your manager appointments by calendar year file.` }));
  }
}
