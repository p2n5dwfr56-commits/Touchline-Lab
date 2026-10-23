'use strict';
/* =====================================================================
   Touchline Lab UI
   ===================================================================== */
const SVGNS = 'http://www.w3.org/2000/svg';
let DB = null, DEMO = null;
const S = {
  tab: 'overview', team: 'ABE', venue: 'all', range: 'season', cmp: 'CEL',
  heat: 'all', shots: 'for', group: 'all', per90: true, sort: 'min', player: null,
  cmpMode: 'teams', pA: null, pB: null, match: null, act: 'pass', form: null, shape: 'plan',
  opp: null, oppSort: 'next', oppScope: 'league', comp: 'all', loss: null, lossShow: 'shot', bwSort: 'wins', impMetric: 'rating', impPlayer: null, raceN: '5', kpPeriod: '1',
};
const TABS = [['overview', 'Overview'], ['team', 'Team analysis'], ['press', 'Without the ball'], ['tactics', 'Tactics'], ['players', 'Players'], ['key', 'Key players'], ['compare', 'Compare'], ['opponents', 'Opponents'], ['seasons', 'Seasons'], ['matches', 'Matches'], ['data', 'Data']];

/* ---------- DOM helpers ---------- */
function h(tag, a, ...kids) {
  const el = document.createElement(tag);
  if (a) for (const k in a) {
    const v = a[k];
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  kids.flat(Infinity).forEach((c) => c != null && c !== false && el.append(c.nodeType ? c : document.createTextNode(String(c))));
  return el;
}
function sv(tag, a, ...kids) {
  const el = document.createElementNS(SVGNS, tag);
  if (a) for (const k in a) {
    const v = a[k];
    if (v == null) continue;
    if (k === 'text') el.textContent = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v);
  }
  kids.flat().forEach((c) => c && el.append(c));
  return el;
}
const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
function rgbOf(col) {
  const c = document.createElement('canvas').getContext('2d');
  c.fillStyle = col;
  const v = c.fillStyle;
  if (v[0] === '#') return [parseInt(v.slice(1, 3), 16), parseInt(v.slice(3, 5), 16), parseInt(v.slice(5, 7), 16)];
  const m = v.match(/\d+/g);
  return m ? m.slice(0, 3).map(Number) : [128, 128, 128];
}
const fmt = (v, d = 1) => (v == null || !isFinite(v) ? '–' : v.toFixed(d));
// Signed difference; values that round to zero show as plain 0.0 rather than -0.0
const signed = (v, d = 1) => { const s = fmt(v, d); return s === '–' ? s : Number(s) === 0 ? (0).toFixed(d) : (v > 0 ? '+' : '') + s; };
const teamName = (id) => (DB.teamById[id] ? DB.teamById[id].name : id);
const ordinal = (n) => n + (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th');
const fmtDate = (d) => (d ? new Date(d + 'T12:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '');
function card(title, sub, ...body) {
  const opts = typeof title === 'object' && title && !title.nodeType ? title : { title };
  const head = h('div', { class: 'card-h' }, h('div', null, h('h2', { text: opts.title }), sub ? h('p', { text: sub }) : null), opts.tools || null);
  return h('section', { class: 'card' + (opts.span ? ' span' : '') }, head, ...body);
}
function seg(options, value, onChange, label) {
  return h('div', { class: 'seg', role: 'group', 'aria-label': label || '' },
    options.map(([v, l]) => h('button', { type: 'button', 'aria-pressed': String(v === value), onclick: () => onChange(v), text: l })));
}

/* ---------- Tooltip ---------- */
const tip = h('div', { class: 'tip', role: 'tooltip', hidden: true });
function showTip(evt, lines) {
  tip.replaceChildren();
  lines.forEach((ln) => {
    if (ln.color) tip.append(h('div', { class: 'row' }, h('i', { style: { background: ln.color } }), h('span', { class: 'tv', text: ln.v }), h('span', { class: 'tl', text: ln.l || '' })));
    else tip.append(h('div', { class: ln.strong ? 'tv' : 'tl', text: ln.v }));
  });
  tip.hidden = false;
  moveTip(evt);
}
function moveTip(evt) {
  let x, y;
  if (evt && evt.clientX != null && evt.type !== 'focus') { x = evt.clientX; y = evt.clientY; }
  else { const r = evt.target.getBoundingClientRect(); x = r.left + r.width / 2; y = r.top; }
  const w = tip.offsetWidth, hh = tip.offsetHeight;
  tip.style.left = Math.min(window.innerWidth - w - 8, Math.max(8, x + 14)) + 'px';
  tip.style.top = (y - hh - 12 < 8 ? y + 18 : y - hh - 12) + 'px';
}
const hideTip = () => (tip.hidden = true);
function hover(el, fn) {
  el.addEventListener('pointerenter', (e) => showTip(e, fn()));
  el.addEventListener('pointermove', moveTip);
  el.addEventListener('pointerleave', hideTip);
  el.addEventListener('focus', (e) => showTip(e, fn()));
  el.addEventListener('blur', hideTip);
}

/* ---------- Selection ---------- */
// League matches, plus cup matches with full match detail (API-Football) as the Competition filter says
function teamMatches(T, venue = S.venue) {
  const inV = (m) => venue === 'all' || (!m.neutral && (venue === 'home' ? m.home === T : m.away === T));
  const lg = DB.matches.filter((m) => (m.home === T || m.away === T) && inV(m));
  if (S.comp === 'league' || !hasCupDetail()) return lg;
  const cups = (DB.cups || []).filter((m) => m.detail && m.ts && (m.home === T || m.away === T) && inV(m));
  return (S.comp === 'cups' ? cups : lg.concat(cups)).sort((a, b) => (a.date || '').localeCompare(b.date || ''));
}
const hasCupDetail = () => (DB.cups || []).some((m) => m.detail && m.ts);
function scoped(T, range = S.range) {
  const ms = teamMatches(T);
  if (range.startsWith('m:')) { const m = ms.find((x) => x.id === range.slice(2)); return m ? [m] : ms; }
  if (range === 'last5') return ms.slice(-5);
  if (range === 'last3') return ms.slice(-3);
  return ms;
}
const leagueRange = () => (S.range.startsWith('m:') ? 'season' : S.range);
const rangeLabel = () => {
  if (S.range.startsWith('m:')) { const m = DB.matches.find((x) => x.id === S.range.slice(2)); return m ? matchLabel(m, S.team) : 'Match'; }
  return { season: 'Season to date', last5: 'Last 5 matches', last3: 'Last 3 matches' }[S.range];
};
const oppOf = (m, T) => (m.home === T ? m.away : m.home);
const goalsFor = (m, T) => (m.home === T ? m.hg : m.ag);
const goalsAg = (m, T) => (m.home === T ? m.ag : m.hg);
// A level cup tie settled on penalties counts as won or lost, as FBref records it
const result = (m, T) => {
  const f = goalsFor(m, T), a = goalsAg(m, T);
  if (f === a && m.pens) { const pf = m.home === T ? m.pens.f : m.pens.a, pa = m.home === T ? m.pens.a : m.pens.f; return pf > pa ? 'W' : 'L'; }
  return f > a ? 'W' : f === a ? 'D' : 'L';
};
const venueOf = (m, T) => (m.neutral ? 'N' : m.home === T ? 'H' : 'A');
// "Semi-finals" -> "SF", "League Cup" -> "LC" for compact labels
const roundShort = (r) => { const s = String(r || ''); return /semi/i.test(s) ? 'SF' : /quarter/i.test(s) ? 'QF' : /^final/i.test(s) ? 'Final' : /(round of|last) ?16/i.test(s) ? 'R16' : /group/i.test(s) ? 'Group' : s.replace(/^round\s*/i, 'R').slice(0, 8); };
const compShort = (c) => String(c || 'Cup').split(/\s+/).map((w) => w[0]).join('').toUpperCase();
const roundLabel = (m) => (m.cup ? `${compShort(m.comp)} ${roundShort(m.round)}`.trim() : 'R' + m.round);
const matchLabel = (m, T) => `${roundLabel(m)} v ${teamName(oppOf(m, T))} (${venueOf(m, T)})`;
const scoreText = (m, T) => goalsFor(m, T) + '–' + goalsAg(m, T) + (m.pens ? ` (${m.home === T ? m.pens.f : m.pens.a}–${m.home === T ? m.pens.a : m.pens.f} pens)` : '');
// League matches plus cup matches, by the Competition filter. Stats views stay on teamMatches (league only).
function compMatches(T, comp = S.comp, venue = S.venue) {
  const inVenue = (m) => venue === 'all' || (!m.neutral && (venue === 'home' ? m.home === T : m.away === T));
  const league = comp === 'cups' ? [] : DB.matches.filter((m) => (m.home === T || m.away === T) && (venue === 'all' || (venue === 'home' ? m.home === T : m.away === T)));
  const cups = comp === 'league' ? [] : (DB.cups || []).filter((m) => (m.home === T || m.away === T) && inVenue(m));
  return league.concat(cups).sort((a, b) => (a.date || '').localeCompare(b.date || ''));
}
const hasCups = (T) => (DB.cups || []).some((m) => m.home === T || m.away === T);

const cache = new Map();
function memo(key, fn) { if (!cache.has(key)) cache.set(key, fn()); return cache.get(key); }
function leagueAggs() {
  return memo('lg|' + S.venue + '|' + leagueRange(), () => DB.teams.map((t) => ({ team: t, a: aggTeam(scoped(t.id, leagueRange()), t.id) })).filter((r) => r.a.n));
}
function teamAgg(T, range = S.range) { return memo('ta|' + T + '|' + S.venue + '|' + range, () => aggTeam(scoped(T, range), T)); }
function rankOf(mt, T) {
  const rows = leagueAggs().map((r) => ({ id: r.team.id, v: mt.f(r.a) })).filter((r) => has(r.v));
  const dir = mt.dir === -1 ? 1 : -1;
  rows.sort((a, b) => dir * (a.v - b.v));
  return { rank: rows.findIndex((r) => r.id === T) + 1, of: rows.length, avg: rows.reduce((s, r) => s + r.v, 0) / (rows.length || 1), max: Math.max(...rows.map((r) => r.v)), min: Math.min(...rows.map((r) => r.v)) };
}
const TM = Object.fromEntries(TEAM_METRICS.map((m) => [m.k, m]));
const teamHas = (keys, ...aggs) => keys.filter((k) => aggs.every((a) => has(TM[k].f(a))));
function dataHas() {
  const parts = ['results', 'team match stats'];
  if (DB.hasPlayers) parts.push('player stats');
  if (DB.hasLineups) parts.push('line-ups and formations');
  return parts.slice(0, -1).join(', ') + ' and ' + parts[parts.length - 1];
}
function eventsNote(title, items) {
  return card({ title, span: true }, null, h('p', { class: 'note', style: { marginTop: 0 }, text: `${items} need event data with pitch locations (every pass, shot and tackle with where it happened). ${DB.label} has ${dataHas()}, but no locations. Load StatsBomb-format event files in the Data tab to see these views.` }));
}
function missingNote(title, what, el) {
  el.append(h('div', { class: 'hero' }, h('h1', { text: teamName(S.team) })));
  const where = /^Player stats/.test(what) ? 'Add them from FBref in the Data tab (paste a squad table), or load API-Football or StatsBomb files.'
    : /^Line-ups/.test(what) ? 'Paste FBref’s Scores & Fixtures table in the Data tab for each match’s formation, or load API-Football or StatsBomb files for full line-ups.'
    : 'API-Football or StatsBomb files from the Data tab include them.';
  el.append(card({ title, span: true }, null, h('p', { class: 'note', style: { marginTop: 0 }, text: `${what} are not in this data. ${DB.label} has ${dataHas()}. ${where}` })));
}

/* ---------- Pitch ---------- */
function pitch({ half = false, label = true } = {}) {
  const vb = half ? '58 -3 65 87' : '-3 -3 126 87';
  const svg = sv('svg', { viewBox: vb, class: half ? 'pitch half' : 'pitch', role: 'img' });
  svg.append(sv('rect', { class: 'bg', x: -3, y: -3, width: 126, height: 87 }));
  const heat = sv('g');
  svg.append(heat);
  const ln = sv('g', { class: 'ln' });
  [
    ['rect', { x: 0, y: 0, width: 120, height: 80 }], ['line', { x1: 60, y1: 0, x2: 60, y2: 80 }], ['circle', { cx: 60, cy: 40, r: 10 }],
    ['rect', { x: 0, y: 18, width: 18, height: 44 }], ['rect', { x: 102, y: 18, width: 18, height: 44 }],
    ['rect', { x: 0, y: 30, width: 6, height: 20 }], ['rect', { x: 114, y: 30, width: 6, height: 20 }],
    ['rect', { x: -1.6, y: 36, width: 1.6, height: 8 }], ['rect', { x: 120, y: 36, width: 1.6, height: 8 }],
    ['path', { d: 'M18 32 A10 10 0 0 1 18 48' }], ['path', { d: 'M102 32 A10 10 0 0 0 102 48' }],
  ].forEach(([t, a]) => ln.append(sv(t, a)));
  svg.append(ln);
  [[12, 40], [108, 40], [60, 40]].forEach(([x, y]) => svg.append(sv('circle', { class: 'spot', cx: x, cy: y, r: 0.45 })));
  if (label && !half) svg.append(sv('text', { class: 'dir', x: 60, y: 83.4, 'text-anchor': 'middle', text: 'Attacking direction →' }));
  const marks = sv('g');
  svg.append(marks);
  return { svg, heat, marks };
}
function heatImage(grid, color, gamma = 1.1) {
  const { nx, ny, v } = grid;
  const sorted = Array.from(v).sort((x, y) => x - y);
  const max = sorted[sorted.length - 1], lo = sorted[Math.floor(sorted.length * 0.3)];
  const c = document.createElement('canvas');
  c.width = nx; c.height = ny;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(nx, ny);
  const [r, g, b] = rgbOf(color);
  for (let i = 0; i < v.length; i++) {
    const a = max > lo ? Math.pow(clamp((v[i] - lo) / (max - lo), 0, 1), gamma) : 0;
    img.data[i * 4] = r; img.data[i * 4 + 1] = g; img.data[i * 4 + 2] = b; img.data[i * 4 + 3] = Math.round(a * 235);
  }
  ctx.putImageData(img, 0, 0);
  return sv('image', { href: c.toDataURL(), x: 0, y: 0, width: 120, height: 80, preserveAspectRatio: 'none' });
}
function diffImage(gA, gB, colA, colB) {
  const { nx, ny } = gA;
  const sA = gA.v.reduce((s, x) => s + x, 0) || 1, sB = gB.v.reduce((s, x) => s + x, 0) || 1;
  const d = new Float32Array(nx * ny);
  let max = 0;
  for (let i = 0; i < d.length; i++) { d[i] = gA.v[i] / sA - gB.v[i] / sB; max = Math.max(max, Math.abs(d[i])); }
  const c = document.createElement('canvas');
  c.width = nx; c.height = ny;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(nx, ny);
  const A = rgbOf(colA), B = rgbOf(colB);
  for (let i = 0; i < d.length; i++) {
    const t = max ? d[i] / max : 0, col = t >= 0 ? A : B;
    img.data.set([col[0], col[1], col[2], Math.round(Math.pow(Math.abs(t), 0.8) * 225)], i * 4);
  }
  ctx.putImageData(img, 0, 0);
  return sv('image', { href: c.toDataURL(), x: 0, y: 0, width: 120, height: 80, preserveAspectRatio: 'none' });
}
const HEAT_MODES = [['all', 'All touches'], ['onball', 'On the ball'], ['def', 'Defensive actions']];
function teamPoints(matches, T, mode, pid) {
  const pts = [];
  matches.forEach((m) => m.events.forEach((e) => {
    if (pid ? e.pl === pid : e.team === T) {
      const def = e.type in DEF_TYPES || e.type === 'duel';
      if (mode === 'def' ? def : mode === 'onball' ? !def : true) pts.push([e.x, e.y]);
    }
    if (mode !== 'def' && e.type === 'pass' && e.ok && (pid ? e.rc === pid : e.team === T && e.rc)) pts.push([e.ex, e.ey]);
  }));
  return pts;
}
function heatmap(matches, T, mode, color, pid) {
  const pts = teamPoints(matches, T, mode, pid);
  const p = pitch();
  p.svg.setAttribute('aria-label', 'Heatmap of ' + pts.length + ' actions');
  if (pts.length) p.heat.append(heatImage(density(pts), color));
  return { el: p.svg, n: pts.length };
}

/* ---------- Shot map ---------- */
function shotMap(shots, color, opts = {}) {
  const p = pitch({ half: !opts.full });
  shots.slice().sort((a, b) => b.e.xg - a.e.xg).forEach(({ e, mirror, col }) => {
    const x = mirror ? PL - e.x : e.x, y = mirror ? PW - e.y : e.y;
    const c = col || color;
    const r = 0.6 + Math.sqrt(e.xg) * 3.2;
    const goal = e.out === 'goal';
    const dot = sv('circle', { cx: x, cy: y, r, fill: c, 'fill-opacity': goal ? 1 : 0.22, stroke: goal ? css('--surface') : c, 'stroke-width': goal ? 0.5 : 0.35 });
    hover(dot, () => {
      const pl = DB.players[e.pl];
      const m = opts.matchOf ? opts.matchOf(e) : null;
      return [
        { v: e.xg.toFixed(2) + ' xG', strong: true },
        { v: (pl ? pl.name : 'Unknown') + ' · ' + Math.floor(e.t / 60 + 1) + "'" },
        { v: { goal: 'Goal', saved: 'Saved', blocked: 'Blocked', off: 'Off target' }[e.out] + (e.head ? ' · header' : '') + (e.sp === 'pen' ? ' · penalty' : e.sp === 'fk' ? ' · free kick' : e.sp === 'corner' ? ' · from corner' : '') },
        m ? { v: m } : null,
      ].filter(Boolean);
    });
    p.marks.append(dot);
  });
  return p.svg;
}
function shotLegend(color) {
  return h('div', { class: 'legend' },
    h('span', null, h('i', { class: 'ring', style: { background: color, borderColor: color, color } }), 'Goal'),
    h('span', null, h('i', { class: 'ring', style: { color } }), 'No goal'),
    h('span', { text: 'Size shows xG' }));
}
function collectShots(matches, T, against) {
  const out = [];
  matches.forEach((m) => m.events.forEach((e) => {
    if (e.type === 'shot' && (against ? e.team !== T : e.team === T)) out.push({ e, m });
  }));
  return out;
}

/* ---------- Pass network ---------- */
function passNetwork(matches, T, color) {
  const n = matches.length;
  const mins = {};
  matches.forEach((m) => (m.lineups[T] || []).forEach((l) => (mins[l.pid] = (mins[l.pid] || 0) + 1)));
  matches.forEach((m) => Object.entries(m.minutes).forEach(([pid, mn]) => { if (DB.players[pid] && DB.players[pid].team === T) mins[pid] = (mins[pid] || 0) + mn / 1000; }));
  const ids = Object.keys(mins).sort((a, b) => mins[b] - mins[a]).slice(0, 11);
  const set = new Set(ids);
  const pos = {}, cnt = {}, links = {};
  ids.forEach((id) => { pos[id] = [0, 0, 0]; cnt[id] = 0; });
  matches.forEach((m) => m.events.forEach((e) => {
    if (e.team !== T) return;
    if (set.has(e.pl) && (e.type === 'pass' || e.type === 'carry' || e.type === 'dribble' || e.type === 'shot')) { const q = pos[e.pl]; q[0] += e.x; q[1] += e.y; q[2]++; }
    if (e.type === 'pass' && e.ok && e.rc && set.has(e.rc)) {
      const q = pos[e.rc]; q[0] += e.ex; q[1] += e.ey; q[2]++;
      if (set.has(e.pl)) { cnt[e.pl]++; const k = e.pl < e.rc ? e.pl + '|' + e.rc : e.rc + '|' + e.pl; links[k] = (links[k] || 0) + 1; }
    }
  }));
  const p = pitch();
  const thr = Math.max(3, n * 2.5);
  const maxL = Math.max(1, ...Object.values(links));
  const ink = css('--ink-2');
  Object.entries(links).filter(([, v]) => v >= thr).sort((a, b) => a[1] - b[1]).forEach(([k, v]) => {
    const [a, b] = k.split('|');
    if (!pos[a][2] || !pos[b][2]) return;
    const A = [pos[a][0] / pos[a][2], pos[a][1] / pos[a][2]], B = [pos[b][0] / pos[b][2], pos[b][1] / pos[b][2]];
    const ln = sv('line', { x1: A[0], y1: A[1], x2: B[0], y2: B[1], stroke: ink, 'stroke-opacity': 0.25 + 0.55 * (v / maxL), 'stroke-width': 0.3 + 1.6 * (v / maxL), 'stroke-linecap': 'round' });
    hover(ln, () => [{ v: (v / n).toFixed(1) + ' passes/match', strong: true }, { v: DB.players[a].name + ' ↔ ' + DB.players[b].name }]);
    p.marks.append(ln);
  });
  const maxC = Math.max(1, ...Object.values(cnt));
  const surf = css('--surface');
  ids.forEach((id) => {
    const q = pos[id];
    if (!q[2]) return;
    const x = q[0] / q[2], y = q[1] / q[2], pl = DB.players[id];
    const r = 2.2 + 2.2 * Math.sqrt(cnt[id] / maxC);
    const g = sv('g', { tabindex: 0 });
    g.append(sv('circle', { cx: x, cy: y, r, fill: color, stroke: surf, 'stroke-width': 0.5 }));
    g.append(sv('text', { x, y: y + 1.05, 'text-anchor': 'middle', 'font-size': 2.9, 'font-weight': 700, fill: '#fff', style: 'font-family: var(--font-display)', text: pl.num != null ? pl.num : pl.name.split(' ').pop().slice(0, 3) }));
    g.append(sv('text', { x, y: y + r + 2.8, 'text-anchor': 'middle', 'font-size': 2.3, fill: css('--ink-2'), text: pl.name.split(' ').pop() }));
    hover(g, () => [{ v: pl.name, strong: true }, { v: (cnt[id] / n).toFixed(1) + ' passes/match to this XI' }, { v: GROUP_NAME[pl.group] }]);
    p.marks.append(g);
  });
  const forms = {};
  matches.forEach((m) => m.forms[T] && (forms[m.forms[T]] = (forms[m.forms[T]] || 0) + 1));
  const top = Object.entries(forms).sort((a, b) => b[1] - a[1]);
  return { el: p.svg, forms: top, n };
}

/* ---------- Charts ---------- */
function lineChart(box, { series, labels, tipFor, yFmt = (v) => v.toFixed(1), height = 230, zero = true }) {
  const W = Math.max(280, box.clientWidth || 600), H = height, m = { l: 34, r: 12, t: 12, b: 26 };
  const n = labels.length;
  const all = series.flatMap((s) => s.values.concat(s.points || [])).filter((v) => has(v));
  const dmax = Math.max(...all), dmin = Math.min(...all);
  // zero: axis from 0 (counts); otherwise fitted to the data (ratings, percentages)
  const ymax = zero ? Math.max(0.5, dmax) * 1.08 : dmax + Math.max(0.05, (dmax - dmin) * 0.12);
  const span0 = zero ? ymax : ymax - (dmin - Math.max(0.05, (dmax - dmin) * 0.12));
  const raw = span0 / 5, mag = Math.pow(10, Math.floor(Math.log10(raw))), r = raw / mag;
  const step = (r <= 1 ? 1 : r <= 2 ? 2 : r <= 2.5 ? 2.5 : r <= 5 ? 5 : 10) * mag; // about five gridlines
  const top = Math.ceil(ymax / step) * step;
  const bot = zero ? 0 : Math.max(0, Math.floor((dmin - Math.max(0.05, (dmax - dmin) * 0.12)) / step) * step);
  const X = (i) => m.l + (n <= 1 ? (W - m.l - m.r) / 2 : (i * (W - m.l - m.r)) / (n - 1));
  const Y = (v) => m.t + (H - m.t - m.b) * (1 - (v - bot) / (top - bot || 1));
  const svg = sv('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', role: 'img' });
  const ax = sv('g', { class: 'axis' });
  for (let v = bot; v <= top + 1e-9; v += step) {
    ax.append(sv('line', { x1: m.l, x2: W - m.r, y1: Y(v), y2: Y(v), class: v === bot ? 'baseline' : 'grid-line' }));
    ax.append(sv('text', { x: m.l - 6, y: Y(v) + 4, 'text-anchor': 'end', text: yFmt(v) }));
  }
  const every = Math.max(1, Math.ceil(n / Math.floor((W - m.l) / 44)));
  labels.forEach((l, i) => { if (i % every === 0 || i === n - 1) ax.append(sv('text', { x: X(i), y: H - 6, 'text-anchor': 'middle', text: l })); });
  svg.append(ax);
  series.forEach((s) => {
    let pen = false; // a missing value (NaN) breaks the line
    const d = s.values.map((v, i) => { if (!has(v)) { pen = false; return ''; } const c = (pen ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(v).toFixed(1); pen = true; return c; }).join('');
    svg.append(sv('path', { d, fill: 'none', stroke: s.color, 'stroke-width': s.width || 2, 'stroke-dasharray': s.dash || null, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
    const lastI = s.values.reduce((li, v, i) => (has(v) ? i : li), -1);
    if (!s.noDots) s.values.forEach((v, i) => has(v) && svg.append(sv('circle', { cx: X(i), cy: Y(v), r: i === lastI ? 4 : 2.6, fill: s.color, stroke: css('--surface'), 'stroke-width': 1.5 })));
    else if (lastI >= 0) svg.append(sv('circle', { cx: X(lastI), cy: Y(s.values[lastI]), r: 3.2, fill: s.color, stroke: css('--surface'), 'stroke-width': 1.2 }));
    if (s.points) s.points.forEach((v, i) => has(v) && svg.append(sv('circle', { cx: X(i), cy: Y(v), r: 3.4, fill: s.color, 'fill-opacity': 0.28, stroke: 'none' }))); // single values behind an average line
  });
  const cross = sv('line', { y1: m.t, y2: H - m.b, stroke: css('--muted'), 'stroke-width': 1, opacity: 0 });
  svg.append(cross);
  const hit = sv('rect', { x: m.l - 10, y: 0, width: W - m.l - m.r + 20, height: H, fill: 'transparent' });
  const pick = (evt) => {
    const r = svg.getBoundingClientRect();
    const px = ((evt.clientX - r.left) / r.width) * W;
    const i = clamp(Math.round(((px - m.l) / (W - m.l - m.r)) * (n - 1)), 0, n - 1);
    cross.setAttribute('x1', X(i)); cross.setAttribute('x2', X(i)); cross.setAttribute('opacity', 1);
    showTip(evt, tipFor(i));
  };
  hit.addEventListener('pointermove', pick);
  hit.addEventListener('pointerenter', pick);
  hit.addEventListener('pointerleave', () => { cross.setAttribute('opacity', 0); hideTip(); });
  svg.append(hit);
  box.append(svg);
}

function legend(items) {
  return h('div', { class: 'legend' }, items.map(([label, color, kind]) => h('span', null, h('i', { class: kind || '', style: { background: kind === 'line-dash' ? `repeating-linear-gradient(90deg, ${color} 0 5px, transparent 5px 8px)` : color } }), label)));
}

const PHASE_COLORS = { bu: '--c1', pr: '--c3', f3: '--c2', tr: '--c5', sp: '--c4' };
function phaseBar(ph, names) {
  const tot = PHASES.reduce((s, k) => s + ph[k], 0) || 1;
  return h('div', { class: 'stackbar' }, PHASES.map((k) => {
    const pct = (100 * ph[k]) / tot;
    const el = h('div', { class: k === 'sp' || k === 'pr' ? 'dk' : '', style: { width: pct + '%', background: css(PHASE_COLORS[k]) }, tabindex: 0, text: pct >= 9 ? Math.round(pct) + '%' : '' });
    hover(el, () => [{ v: pct.toFixed(1) + '%', strong: true }, { v: names[k] }, { v: 'Share of time ' + (names === PHASE_IN ? 'with the ball' : 'without the ball') }]);
    return el;
  }));
}
function phaseLegend(names) { return legend(PHASES.map((k) => [names[k], css(PHASE_COLORS[k])])); }
function phasePct(ph) { const tot = PHASES.reduce((s, k) => s + ph[k], 0) || 1; return Object.fromEntries(PHASES.map((k) => [k, (100 * ph[k]) / tot])); }

function hbars(rows, color) {
  // rows: {label, value, max, text, mark, markLabel}
  return h('div', { class: 'hbars' }, rows.map((r) => {
    const track = h('div', { class: 'track' }, h('div', { class: 'fill', style: { width: clamp((100 * r.value) / (r.max || 1), 0, 100) + '%', background: r.color || color } }));
    if (r.mark != null) track.append(h('div', { class: 'mark', style: { left: clamp((100 * r.mark) / (r.max || 1), 0, 100) + '%' } }));
    const row = h('div', { class: 'hbar', tabindex: 0 }, h('div', { text: r.label }), track, h('div', { class: 'val', text: r.text }));
    if (r.tip) hover(row, r.tip);
    return row;
  }));
}

/* ---------- Shell ---------- */
const root = h('div');
let mainEl, filtersEl, tabsEl, chipEl;
function buildShell() {
  const logo = sv('svg', { viewBox: '0 0 30 20', 'aria-hidden': 'true' },
    sv('rect', { x: 0.75, y: 0.75, width: 28.5, height: 18.5, rx: 1.5, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.5 }),
    sv('line', { x1: 15, y1: 1, x2: 15, y2: 19, stroke: 'currentColor', 'stroke-width': 1.2 }),
    sv('circle', { cx: 15, cy: 10, r: 3.2, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.2 }),
    sv('rect', { x: 22, y: 5, width: 7, height: 10, fill: 'var(--accent)' }));
  chipEl = h('span', { class: 'chip' });
  filtersEl = h('div', { class: 'filters' });
  tabsEl = h('nav', { class: 'tabs', role: 'tablist', 'aria-label': 'Sections' });
  const top = h('header', { class: 'top' }, h('div', { class: 'wrap' },
    h('div', { class: 'bar' }, h('div', { class: 'brand' }, logo, 'Touchline Lab'), chipEl, filtersEl), tabsEl));
  mainEl = h('main', { class: 'wrap', id: 'main' });
  root.append(top, mainEl);
  document.body.append(root, tip);
}
function renderChrome() {
  chipEl.className = 'chip' + (DB.source === 'demo' ? '' : ' real');
  chipEl.replaceChildren(h('span', { class: 'dot' }), DB.source === 'demo' ? 'Synthetic demo data · invented players' : DB.label + (DB.snapshot ? ' · to ' + fmtDate(DB.snapshot) : ''));
  chipEl.title = DB.source === 'demo' ? 'Generated sample season. Switch to real data in the Data tab.' : DB.source === 'sample' ? 'Data: StatsBomb Open Data (github.com/statsbomb/open-data). Back to your data in the Data tab.' : DB.snapshot ? 'Built-in snapshot. Import newer files in the Data tab to update it.' : '';
  const teamSel = h('select', { id: 'f-team', onchange: (e) => { S.team = e.target.value; if (S.cmp === S.team) S.cmp = DB.teams.find((t) => t.id !== S.team).id; if (S.range.startsWith('m:')) S.range = 'season'; S.player = null; S.match = null; S.form = null; render(); } },
    DB.teams.map((t) => h('option', { value: t.id, selected: t.id === S.team, text: t.name })));
  const ms = teamMatches(S.team);
  const rangeSel = h('select', { id: 'f-range', onchange: (e) => { S.range = e.target.value; render(); } },
    h('option', { value: 'season', text: 'Season to date', selected: S.range === 'season' }),
    ms.length > 5 ? h('option', { value: 'last5', text: 'Last 5 matches', selected: S.range === 'last5' }) : null,
    ms.length > 3 ? h('option', { value: 'last3', text: 'Last 3 matches', selected: S.range === 'last3' }) : null,
    h('optgroup', { label: 'Single match' }, ms.slice().reverse().map((m) => h('option', { value: 'm:' + m.id, selected: S.range === 'm:' + m.id, text: matchLabel(m, S.team) + ' ' + goalsFor(m, S.team) + '–' + goalsAg(m, S.team) }))));
  const venueSel = h('select', { id: 'f-venue', onchange: (e) => { S.venue = e.target.value; if (S.range.startsWith('m:')) S.range = 'season'; render(); } },
    [['all', 'Home & away'], ['home', 'Home'], ['away', 'Away']].map(([v, l]) => h('option', { value: v, selected: S.venue === v, text: l })));
  // Competition filter: only when this team has cup matches
  const compSel = hasCups(S.team) ? h('div', { class: 'field' }, h('label', { for: 'f-comp', text: 'Competition' }),
    h('select', { id: 'f-comp', title: hasCupDetail() ? 'Applies everywhere, including team and player stats. The league table stays league only.' : 'Applies to results, form, matches, formations and opponents. Team stats and the league table are league only (load an API-Football cup file for cup stats).', onchange: (e) => { S.comp = e.target.value; render(); } },
      [['all', 'All competitions'], ['league', 'League only'], ['cups', 'Cups only']].map(([v, l]) => h('option', { value: v, selected: S.comp === v, text: l })))) : null;
  filtersEl.replaceChildren(...[
    seasonSelect(),
    h('div', { class: 'field' }, h('label', { for: 'f-team', text: 'Team' }), teamSel),
    compSel,
    h('div', { class: 'field' }, h('label', { for: 'f-venue', text: 'Venue' }), venueSel),
    h('div', { class: 'field' }, h('label', { for: 'f-range', text: 'Matches' }), rangeSel)].filter(Boolean));
  tabsEl.replaceChildren(...TABS.map(([k, l]) => h('button', { role: 'tab', 'aria-selected': String(S.tab === k), onclick: () => { S.tab = k; try { history.replaceState(null, '', '#' + k); } catch (e) {} render(); window.scrollTo({ top: 0 }); }, text: l })));
}
function render() {
  noteReal();
  aggPlayer.season = DB.seasonPS || null; // FBref season totals, when loaded
  hideTip();
  renderChrome();
  mainEl.replaceChildren();
  const views = { overview: viewOverview, team: viewTeam, press: viewPress, tactics: viewTactics, players: viewPlayers, key: viewKey, compare: viewCompare, opponents: viewOpponents, seasons: viewSeasons, matches: viewMatches, data: viewData };
  (views[S.tab] || viewOverview)(mainEl);
}

/* ---------- Overview ---------- */
function viewOverview(el) {
  const T = S.team, ms = scoped(T), a = teamAgg(T);
  const table = leagueTable(DB, null);
  const row = table.find((r) => r.team.id === T);
  const all = teamMatches(T, 'all');
  const lgRes = S.comp === 'cups' ? [] : (DB.results || DB.matches).filter((m) => m.home === T || m.away === T);
  const cupRes = S.comp === 'league' ? [] : (DB.cups || []).filter((m) => m.home === T || m.away === T);
  const form = lgRes.concat(cupRes).sort((x, y) => (x.date || '').localeCompare(y.date || '')).slice(-5).map((m) => result(m, T));
  el.append(h('div', { class: 'hero' },
    h('h1', { text: teamName(T) }),
    h('div', { class: 'meta' },
      row ? h('span', { text: `${ordinal(row.pos)} of ${table.length} · ${row.a.pts} pts · W${row.a.w} D${row.a.d} L${row.a.l}` }) : null,
      h('span', { class: 'form', 'aria-label': 'Last five results' }, form.map((r) => h('span', { class: r, text: r }))),
      h('span', { class: 'sub', text: rangeLabel() + (S.venue !== 'all' ? ' · ' + S.venue : '') }))));

  const KP = { xg: ['xG for', ''], xga: ['xG against', ''], poss: ['Possession', '%'], ppda: ['PPDA', ''], tilt: ['Field tilt', '%'], g: ['Goals', ''], ga: ['Goals against', ''], mxp: ['Market expected pts', ''], sh: ['Shots', ''], sha: ['Shots against', ''], pass: ['Pass completion', '%'], sot: ['Shots on target', '%'], cor: ['Corners', ''] };
  const kp = teamHas(Object.keys(KP), a).slice(0, 6).map((k) => [k, ...KP[k]]);
  el.append(h('div', { class: 'kpis' }, kp.map(([k, l, u]) => {
    const mt = TM[k], v = mt.f(a), rk = rankOf(mt, T);
    const tile = h('div', { class: 'kpi', tabindex: 0 }, h('div', { class: 'eyebrow', text: l + (mt.u === '/match' ? ' / match' : '') }), h('div', { class: 'v' }, fmt(v, k === 'poss' || k === 'tilt' ? 1 : mt.d === 2 ? 2 : 1), u ? h('small', { text: u }) : null),
      rk.of >= 3 ? h('div', { class: 'r' }, h('b', { text: ordinal(rk.rank) }), ` in league · avg ${fmt(rk.avg, mt.d === 0 ? 0 : mt.d === 2 ? 2 : 1)}`)
        : h('div', { class: 'r', text: 'No league comparison: other teams have no data for this' }));
    if (mt.tip) hover(tile, () => [{ v: mt.l, strong: true }, { v: mt.tip }]);
    return tile;
  })));

  const grid = h('div', { class: 'grid' });
  el.append(grid);
  // League table
  const showXg = table.some((r) => has(r.a.xg));
  const showMkt = table.every((r) => has(r.a.mxp));
  const lt = h('table', null,
    h('thead', null, h('tr', null, ['#', 'Team', 'P', 'W', 'D', 'L', 'GF', 'GA', 'GD', 'Pts'].concat(showXg ? ['xG', 'xGA', 'xGD'] : []).map((c, i) => h('th', { class: i === 1 ? 'l' : '', text: c })),
      showMkt ? [h('th', { text: 'Mkt xPts', title: 'Points the betting market expected, from pre-match odds' }), h('th', { text: '+/−', title: 'Actual points minus market expected points' })] : null)),
    h('tbody', null, table.map((r) => {
      const t = r.a;
      return h('tr', { class: r.team.id === T ? 'focus' : '', onclick: () => { S.team = r.team.id; if (S.cmp === S.team) S.cmp = T; S.range = 'season'; render(); }, title: 'Show ' + r.team.name },
        h('td', { text: r.pos }), h('td', { class: 'l', text: r.team.name }), h('td', { text: t.n }), h('td', { text: t.w }), h('td', { text: t.d }), h('td', { text: t.l }),
        h('td', { text: t.g }), h('td', { text: t.ga }), h('td', { text: (t.g - t.ga > 0 ? '+' : '') + (t.g - t.ga) }), h('td', null, h('b', { text: t.pts })),
        showXg ? [h('td', { text: fmt(t.xg, 1) }), h('td', { text: fmt(t.xga, 1) }), h('td', { text: signed(t.xg - t.xga) })] : null,
        showMkt ? [h('td', { text: fmt(t.mxp, 1) }), h('td', { text: signed(t.pts - t.mxp) })] : null);
    })));
  grid.append(card('League table', 'All matches · click a row to switch team', h('div', { class: 'tbl-wrap' }, lt)));

  // xG trend
  const useXg = all.every((m) => has(m.ts[T].xg) && has(m.ts[T].xga));
  const [kF, kA, unit] = useXg ? ['xg', 'xga', 'xG'] : ['sh', 'sha', 'Shots'];
  const trend = card(useXg ? 'xG by match' : 'Shots by match', (useXg ? 'Chance quality created and conceded, ' : 'Shots taken and faced (no xG in this data), ') + all.length + ' matches');
  grid.append(trend);
  const box = h('div');
  trend.append(box);
  const A = css('--team-a'), B = css('--ink-2');
  const val = (m, k) => (has(m.ts[T][k]) ? m.ts[T][k] : 0);
  lineChart(box, {
    labels: all.map((m) => roundLabel(m)),
    series: [{ name: unit + ' for', color: A, values: all.map((m) => val(m, kF)) }, { name: unit + ' against', color: B, dash: '5 4', values: all.map((m) => val(m, kA)) }],
    yFmt: (v) => v.toFixed(v % 1 ? 1 : 0),
    tipFor: (i) => { const m = all[i]; return [{ v: matchLabel(m, T) }, { v: `${result(m, T)} ${goalsFor(m, T)}–${goalsAg(m, T)}`, strong: true }, { color: A, v: fmt(m.ts[T][kF], useXg ? 2 : 0), l: unit + ' for' }, { color: B, v: fmt(m.ts[T][kA], useXg ? 2 : 0), l: unit + ' against' }]; },
  });
  trend.append(legend([[unit + ' for', A, 'line'], [unit + ' against', B, 'line line-dash']]));

  // Possession snapshot
  if (DB.hasEvents) grid.append(card('Game states', rangeLabel() + ' · share of ball-in-play time', phaseBlock(a)));

  // Top players
  const pls = Object.values(DB.players).filter((p) => p.team === T).map((p) => ({ p, a: aggPlayer(ms, p.id) })).filter((x) => x.a.min > 0);
  const top = (k, f) => pls.filter((x) => has(f(x.a))).sort((x, y) => f(y.a) - f(x.a)).slice(0, 3);
  const leaders = h('div', { class: 'grid three' });
  const n0 = (v) => (has(v) ? v : 0);
  [
    ['Goals', (a) => a.g, (a) => a.g + (has(a.xg) ? ' (' + a.xg.toFixed(1) + ' xG)' : ' in ' + a.min + ' min')],
    ['Chances created', (a) => n0(a.xa) + a.key * 0.01 + a.ast * 0.1, (a) => a.key + ' key passes · ' + (has(a.xa) ? a.xa.toFixed(1) + ' xA' : a.ast + ' assists')],
    ['Progressive passes', (a) => a.prog, (a) => a.prog + ' in ' + a.min + ' min'],
    ['Ball winning', (a) => a.tkl + a.int + n0(a.rec), (a) => a.tkl + a.int + n0(a.rec) + (has(a.rec) ? ' tackles, interceptions & recoveries' : ' tackles & interceptions')],
    ['Average rating', (a) => (a.rtN >= 3 ? a.rt / a.rtN : NaN), (a) => (a.rt / a.rtN).toFixed(2) + ' over ' + a.rtN + ' matches'],
    // Fallbacks for season-total sources (FBref) that lack the richer stats above
    ['Assists', (a) => (has(a.key) ? NaN : a.ast), (a) => a.ast + ' in ' + a.min + ' min'],
    ['Shots', (a) => (has(a.key) ? NaN : a.sh), (a) => a.sh + ' shots · ' + a.sot + ' on target'],
    ['On-pitch goal difference', (a) => (has(a.onG) && has(a.onGA) && a.min >= 270 ? a.onG - a.onGA : NaN), (a) => signed(a.onG - a.onGA, 0) + ' (' + a.onG + ' scored, ' + a.onGA + ' conceded while on)'],
  ].filter(([, f]) => pls.some((x) => has(f(x.a)))).slice(0, 4).forEach(([l, f, t]) => {
    leaders.append(h('div', null, h('div', { class: 'eyebrow', text: l }), h('ol', { style: { margin: '6px 0 0', paddingLeft: '18px' } }, top(l, f).map((x) => h('li', null, h('a', { href: '#players', onclick: (e) => { e.preventDefault(); S.tab = 'players'; S.player = x.p.id; render(); }, style: { color: 'var(--ink)' }, text: x.p.name }), h('div', { class: 'sub', text: t(x.a) }))))));
  });
  if (pls.length) grid.append(card({ title: 'Squad leaders', span: false }, DB.seasonPS ? 'Season totals from ' + (DB.seasonSrc ? 'Sportmonks' : 'FBref') : rangeLabel(), leaders));

  // Upcoming fixtures (from FBref's Scores & Fixtures table)
  const today = new Date().toISOString().slice(0, 10);
  const allNext = ((DB.fixtures && DB.fixtures[T]) || []).filter((f) => f.date >= today);
  const next = allNext.slice(0, 6);
  if (next.length) {
    grid.append(card('Next fixtures', teamName(T) + ' · from FBref and matches you added', h('div', { class: 'mlist' }, next.map((f) => fixtureRow(f, table)))));
  }
  // Cup run: every cup tie this season, and the next one
  const cups = (DB.cups || []).filter((m) => m.home === T || m.away === T);
  const nextCup = allNext.find((f) => f.round || (f.comp && !/premiership|premier league/i.test(f.comp) && f.comp !== (DB.leagueComp || '')));
  if (cups.length || nextCup) {
    const byComp = {};
    cups.forEach((m) => (byComp[m.comp] = byComp[m.comp] || []).push(m));
    const body = h('div', { class: 'stack' });
    if (nextCup) body.append(h('div', { class: 'cup-next' }, h('div', { class: 'eyebrow', text: 'Next' }),
      h('div', { class: 'cup-next-line' }, h('b', { text: `${nextCup.comp}${nextCup.round ? ' ' + nextCup.round.toLowerCase() : ''}` }), ` v ${nextCup.oppId ? teamName(nextCup.oppId) : nextCup.opp}`),
      h('div', { class: 'sub', text: `${fmtDate(nextCup.date)}${nextCup.time ? ' · ' + nextCup.time : ''} · ${nextCup.venue === 'N' ? 'neutral venue' : nextCup.home ? 'home' : 'away'}` })));
    Object.entries(byComp).forEach(([comp, list]) => body.append(h('div', null, h('div', { class: 'eyebrow', style: { marginBottom: '4px' }, text: comp }),
      h('div', { class: 'mlist' }, list.map((m) => {
        const r = result(m, T);
        return h('button', { type: 'button', class: 'mrow', onclick: () => { S.tab = 'matches'; S.match = m.id; S.comp = S.comp === 'league' ? 'all' : S.comp; render(); window.scrollTo({ top: 0 }); } },
          h('span', { class: 'd', text: fmtDate(m.date) + ' · ' + roundShort(m.round) }), h('span', { class: 'res ' + r, text: r }),
          h('span', null, (venueOf(m, T) === 'A' ? '@ ' : 'v ') + teamName(oppOf(m, T)) + (m.neutral ? ' (N)' : '')), h('span', { class: 'score', text: goalsFor(m, T) + '–' + goalsAg(m, T) }),
          h('span', { class: 'xg', text: m.pens ? 'pens ' + (m.home === T ? m.pens.f + '–' + m.pens.a : m.pens.a + '–' + m.pens.f) : '' }));
      })))));
    grid.append(card('Cup run', teamName(T) + ' · cup ties this season', body));
  }
}
function fixtureRow(f, table) {
  const opp = f.oppId ? teamName(f.oppId) : f.opp;
  const pts = f.oppId ? table.find((r) => r.team.id === f.oppId) : null;
  const v = f.venue || (f.home ? 'H' : 'A');
  return h('div', { class: 'mrow', style: { cursor: 'default' } },
    h('span', { class: 'd', text: fmtDate(f.date) + (f.time ? ' · ' + f.time : '') }), h('span', { class: 'res', style: { background: 'var(--surface-2)', color: 'var(--ink-2)' }, title: v === 'N' ? 'Neutral venue' : v === 'H' ? 'Home' : 'Away', text: v }),
    h('span', null, (v === 'A' ? '@ ' : 'v ') + opp), h('span', { class: 'sub', text: pts ? ordinal(pts.pos) + ' · ' + pts.a.pts + ' pts' : '' }),
    h('span', { class: 'xg', text: f.round ? compShort(f.comp) + ' ' + roundShort(f.round) : f.comp }));
}
function phaseBlock(a, compact) {
  const L = leagueAggs();
  const avg = (key) => Object.fromEntries(PHASES.map((k) => [k, L.reduce((s, r) => s + phasePct(r.a[key])[k], 0) / L.length]));
  const ai = avg('ph'), ao = avg('oph');
  const pi = phasePct(a.ph), po = phasePct(a.oph);
  const wrap = h('div');
  wrap.append(h('div', { class: 'phase-row' }, h('div', { class: 'eyebrow', text: 'With the ball · ' + fmt(TM.poss.f(a), 0) + '%' }), phaseBar(a.ph, PHASE_IN)));
  wrap.append(phaseLegend(PHASE_IN));
  wrap.append(h('div', { class: 'phase-row', style: { marginTop: '14px' } }, h('div', { class: 'eyebrow', text: 'Without the ball · ' + fmt(100 - TM.poss.f(a), 0) + '%' }), phaseBar(a.oph, PHASE_OUT)));
  wrap.append(phaseLegend(PHASE_OUT));
  if (!compact) {
    const t = h('table', { style: { marginTop: '14px' } }, h('thead', null, h('tr', null, h('th', { class: 'l', text: 'In possession' }), h('th', { text: 'Team' }), h('th', { text: 'League' }), h('th', { class: 'l', text: 'Out of possession' }), h('th', { text: 'Team' }), h('th', { text: 'League' }))),
      h('tbody', null, PHASES.map((k) => h('tr', { style: { cursor: 'default' } }, h('td', { class: 'l', text: PHASE_IN[k] }), h('td', { text: pi[k].toFixed(0) + '%' }), h('td', { class: 'sub', text: ai[k].toFixed(0) + '%' }), h('td', { class: 'l', text: PHASE_OUT[k] }), h('td', { text: po[k].toFixed(0) + '%' }), h('td', { class: 'sub', text: ao[k].toFixed(0) + '%' })))));
    wrap.append(h('div', { class: 'tbl-wrap' }, t));
    wrap.append(h('p', { class: 'note', text: 'Build-up = ball in own third; progression = middle third; final third = attacking third. Transition = first 7 seconds after winning the ball in open play. Set piece = first 12 seconds after a corner or free kick. Out-of-possession states mirror the opponent’s phase.' }));
  }
  return wrap;
}

/* ---------- Team analysis ---------- */
function viewTeam(el) {
  const T = S.team, ms = scoped(T), a = teamAgg(T), A = css('--team-a');
  el.append(h('div', { class: 'hero' }, h('h1', { text: teamName(T) }), h('div', { class: 'meta' }, h('span', { text: rangeLabel() + ' · ' + ms.length + (ms.length === 1 ? ' match' : ' matches') }))));
  const grid = h('div', { class: 'grid' });
  el.append(grid);
  if (!DB.hasEvents) {
    grid.append(eventsNote('Pitch maps', 'Touch maps, shot maps, game states, possession outcomes, passing networks and territory'));
    grid.append(card({ title: 'Team profile', span: true }, `${rangeLabel()} vs the other ${leagueAggs().length - 1} teams over the same span · bar = league rank, longer is better`, profileTable(T)));
    return;
  }

  // Heatmap
  const hm = heatmap(ms, T, S.heat, A);
  grid.append(card({ title: 'Touch map', tools: seg(HEAT_MODES, S.heat, (v) => { S.heat = v; render(); }, 'Heatmap type') }, hm.n + ' events · ' + (S.heat === 'def' ? 'tackles, interceptions, recoveries, clearances, duels, fouls' : 'includes passes received'), hm.el));

  // Shot map
  const against = S.shots === 'against';
  const shots = collectShots(ms, T, against);
  const xgSum = shots.reduce((s, x) => s + x.e.xg, 0), goals = shots.filter((x) => x.e.out === 'goal').length;
  const col = against ? css('--team-b') : A;
  grid.append(card({ title: 'Shot map', tools: seg([['for', 'Shots for'], ['against', 'Shots against']], S.shots, (v) => { S.shots = v; render(); }, 'Shots') }, against ? 'Opponent shots, shown attacking right' : 'Shots taken',
    h('div', { class: 'statline' }, [[shots.length, 'Shots'], [goals, 'Goals'], [xgSum.toFixed(1), 'xG'], [(xgSum / (shots.length || 1)).toFixed(2), 'xG / shot'], [(xgSum - goals > 0 ? '−' : '+') + Math.abs(goals - xgSum).toFixed(1), 'Goals vs xG']].map(([v, l]) => h('div', null, h('b', { text: v }), h('span', { text: l })))),
    shotMap(shots.map((x) => ({ e: x.e })), col, { matchOf: (e) => { const m = shots.find((s) => s.e === e).m; return matchLabel(m, T); } }), shotLegend(col)));

  // Possession
  grid.append(card('Game states', 'Share of ball-in-play time by phase, with the ball and without it', phaseBlock(a)));

  // Possession outcomes funnel
  const L = leagueAggs();
  const lav = (f) => L.reduce((s, r) => s + f(r.a), 0) / L.length;
  const steps = [
    ['Possessions', (x) => x.poss], ['Reached middle third', (x) => x.possMid], ['Reached final third', (x) => x.possF3], ['Reached the box', (x) => x.possBox], ['Ended in a shot', (x) => x.possShot], ['Ended in a goal', (x) => x.possGoal],
  ];
  grid.append(card('Possession outcomes', `How far ${teamName(T)}'s possessions get · per match, line marks league average`,
    hbars(steps.map(([l, f]) => {
      const v = f(a) / (a.n || 1), lv = lav((x) => f(x) / (x.n || 1)), max = a.poss / (a.n || 1);
      return { label: l, value: v, max: Math.max(max, lav((x) => x.poss / (x.n || 1))), mark: lv, text: v.toFixed(1) + '', tip: () => [{ v: v.toFixed(1) + ' per match', strong: true }, { v: ((100 * f(a)) / (a.poss || 1)).toFixed(1) + '% of possessions' }, { v: 'League average ' + lv.toFixed(1) }] };
    }), A),
    h('p', { class: 'note', text: `${fmt(TM.ppp.f(a), 1)} passes per possession · ${fmt(TM.direct.f(a), 0)}% of passing distance goes forward.` })));

  // Pass network
  const pn = passNetwork(ms, T, A);
  const fl = pn.forms.map(([f, c]) => f + (pn.forms.length > 1 ? ' (' + c + ')' : '')).join(', ');
  grid.append(card('Shape & passing network', `${ms.length === 1 ? 'Starting XI' : 'Most-used XI'} at average positions · lines join pairs with ${ms.length === 1 ? '3+ passes' : '2.5+ passes per match'} · formation: ${fl || '–'}`, pn.el));

  // Territory zones
  grid.append(card('Territory', 'Share of on-ball actions by zone (thirds × lanes)', zoneGrid(teamPoints(ms, T, 'onball'), A)));

  // Profile
  grid.append(card({ title: 'Team profile', span: true }, `${rangeLabel()} vs the other ${L.length - 1} teams over the same span · bar = league rank, longer is better`, profileTable(T)));
}
function zoneGrid(pts, color) {
  const xs = [0, 20, 40, 60, 80, 100, 120], ys = [0, 18, 30, 50, 62, 80];
  const cnt = Array.from({ length: 6 }, () => [0, 0, 0, 0, 0]);
  pts.forEach(([x, y]) => {
    const i = clamp(Math.floor(x / 20), 0, 5);
    let j = 0;
    while (j < 4 && y >= ys[j + 1]) j++;
    cnt[i][j]++;
  });
  const tot = pts.length || 1, max = Math.max(1, ...cnt.flat());
  const p = pitch();
  const [r, g, b] = rgbOf(color);
  cnt.forEach((col, i) => col.forEach((c, j) => {
    const x = xs[i], y = ys[j], w = 20, hh = ys[j + 1] - ys[j];
    const a = c / max;
    const rect = sv('rect', { x: x + 0.4, y: y + 0.4, width: w - 0.8, height: hh - 0.8, fill: `rgba(${r},${g},${b},${(a * 0.85).toFixed(3)})` });
    hover(rect, () => [{ v: ((100 * c) / tot).toFixed(1) + '%', strong: true }, { v: c + ' actions' }]);
    p.heat.append(rect);
    if (c / tot >= 0.015) p.marks.append(sv('text', { x: x + w / 2, y: y + hh / 2 + 1.3, 'text-anchor': 'middle', 'font-size': 3.4, 'font-weight': 600, fill: a > 0.55 ? '#fff' : css('--ink'), 'pointer-events': 'none', text: Math.round((100 * c) / tot) + '%' }));
  }));
  return p.svg;
}
function profileTable(T) {
  const a = teamAgg(T, leagueRange());
  const groups = {};
  TEAM_METRICS.filter((m) => m.grp !== 'Results').forEach((m) => (groups[m.grp] = groups[m.grp] || []).push(m));
  const wrap = h('div', { class: 'grid three' });
  Object.entries(groups).forEach(([g, all]) => {
    const list = all.filter((mt) => has(mt.f(a)) && rankOf(mt, T).of >= 3); // a ranking needs other teams with the stat
    if (!list.length) return;
    const n = leagueAggs().filter((r) => has(list[0].f(r.a))).length;
    wrap.append(h('div', null, h('div', { class: 'eyebrow', style: { marginBottom: '8px' }, text: g }), hbars(list.map((mt) => {
      const rk = rankOf(mt, T), v = mt.f(a);
      const score = mt.dir === 0 ? (v - rk.min) / ((rk.max - rk.min) || 1) * (n - 1) + 1 : n - rk.rank + 1;
      return {
        label: mt.l + (mt.u === '/match' ? '' : mt.u ? ' (' + mt.u + ')' : ''), value: score, max: n,
        color: mt.dir === 0 ? css('--c1') : css('--team-a'),
        text: fmt(v, mt.d) + (mt.dir === 0 ? '' : ' · ' + ordinal(rk.rank)),
        tip: () => [{ v: fmt(v, mt.d) + (mt.u ? ' ' + mt.u : ''), strong: true }, { v: mt.l }, { v: (mt.dir === 0 ? 'Style metric: ' + ordinal(rk.rank) + ' highest' : ordinal(rk.rank) + ' of ' + rk.of) + ' · league avg ' + fmt(rk.avg, mt.d) }, mt.tip ? { v: mt.tip } : null].filter(Boolean),
      };
    }))));
  });
  return h('div', null, wrap, h('p', { class: 'note', text: 'Red bars rank good-or-bad metrics (1st = best). Blue bars are style metrics with no right answer, scaled from league lowest to highest.' }));
}

/* ---------- Players ---------- */
// Players with per-match stats (e.g. from Sportmonks), whose numbers follow the match filters
const perMatchPids = () => memo('pmp', () => new Set(DB.matches.flatMap((m) => Object.keys(m.ps || {}))));
const ppmOf = (a) => PLAYER_METRICS.find((m) => m.k === 'ppm').f(a);
const PCOLS = [
  ['min', 'Min', (a) => a.min, 0, false], ['g', 'G', (a) => a.g, 2], ['xg', 'xG', (a) => a.xg, 2], ['ast', 'A', (a) => a.ast, 2], ['xa', 'xA', (a) => a.xa, 2], ['sh', 'Sh', (a) => a.sh, 2],
  ['key', 'KP', (a) => a.key, 2], ['pct', 'Pass%', (a) => 100 * safe(a.pc, a.pa), 0, false], ['prog', 'PrgP', (a) => a.prog, 2], ['progC', 'PrgC', (a) => a.progC, 2],
  ['drbW', 'Drb', (a) => a.drbW, 2], ['tkl', 'Tkl', (a) => a.tkl, 2], ['int', 'Int', (a) => a.int, 2], ['rec', 'Rec', (a) => a.rec, 2], ['duel', 'Duel%', (a) => 100 * safe(a.duelW, a.duel), 0, false], ['touch', 'Touch', (a) => a.touch, 1],
  ['rating', 'Rtg', (a) => (a.rtN ? a.rt / a.rtN : NaN), 2, false],
  ['yc', 'Yel', (a) => a.yc, 2], ['onGD', '+/−', (a) => (has(a.onG) && has(a.onGA) ? a.onG - a.onGA : NaN), 2], ['ppm', 'PPM', (a) => ppmOf(a), 2, false],
  ['savePct', 'Sv%', (a) => (a.sota ? (100 * a.saves) / a.sota : NaN), 1, false], ['cs', 'CS', (a) => a.cs, 0, false],
];
const PCOL_TIPS = { min: 'Minutes', g: 'Goals', xg: 'Expected goals', ast: 'Assists', xa: 'Expected assists', sh: 'Shots', key: 'Key passes', pct: 'Pass completion', prog: 'Progressive passes', progC: 'Progressive carries', drbW: 'Successful dribbles', tkl: 'Tackles', int: 'Interceptions', rec: 'Ball recoveries', duel: 'Duels won', touch: 'Touches', rating: 'Average match rating', yc: 'Yellow cards', onGD: 'Team goal difference while on the pitch', ppm: 'Team points per match played', savePct: 'Save percentage', cs: 'Clean sheets' };
function colVal(c, a) { const v = c[2](a); return S.per90 && c[4] !== false && c[0] !== 'min' ? safe(v * 90, a.min) : v; }
function viewPlayers(el) {
  if (!DB.hasPlayers) return missingNote('Players', 'Player stats', el);
  const T = S.team, ms = scoped(T);
  let rows = Object.values(DB.players).filter((p) => p.team === T).map((p) => ({ p, a: aggPlayer(ms, p.id) })).filter((r) => r.a.min > 0);
  if (!rows.length) return missingNote('Players', `Player stats for ${teamName(T)}`, el);
  if (S.group !== 'all') rows = rows.filter((r) => r.p.group === S.group);
  const cols = PCOLS.filter((c) => rows.some((r) => has(c[2](r.a))));
  const sc = cols.find((c) => c[0] === S.sort) || cols[0];
  const sv0 = (a) => { const v = colVal(sc, a); return has(v) ? v : -Infinity; };
  rows.sort((x, y) => sv0(y.a) - sv0(x.a));
  if (!S.player || !DB.players[S.player] || DB.players[S.player].team !== T) S.player = rows[0] ? rows[0].p.id : null;

  if (S.player) el.append(playerProfile(S.player, ms));

  const tools = h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } },
    seg([['all', 'All'], ['GK', 'GK'], ['DEF', 'DEF'], ['MID', 'MID'], ['FWD', 'FWD']], S.group, (v) => { S.group = v; render(); }, 'Position'),
    seg([[true, 'Per 90'], [false, 'Totals']], S.per90, (v) => { S.per90 = v; render(); }, 'Units'));
  const t = h('table', null,
    h('thead', null, h('tr', null, h('th', { class: 'l', text: 'Player' }), cols.map((c) => h('th', { class: 'sortable' + (c[0] === sc[0] ? ' sorted' : ''), title: PCOL_TIPS[c[0]], onclick: () => { S.sort = c[0]; render(); }, text: c[1] })))),
    h('tbody', null, rows.map((r) => h('tr', { class: r.p.id === S.player ? 'focus' : '', onclick: () => { S.player = r.p.id; render(); window.scrollTo({ top: 0, behavior: 'smooth' }); } },
      h('td', { class: 'l' }, h('span', { class: 'badge', text: r.p.role || r.p.group }), r.p.name),
      cols.map((c) => {
        // Rates and percentages keep their own decimals; counts show 2 per 90 or whole-number totals
        const d = c[4] === false ? c[3] : S.per90 ? 2 : c[0] === 'xg' || c[0] === 'xa' ? 1 : 0;
        return h('td', { text: c[0] === 'onGD' ? signed(colVal(c, r.a), d) : fmt(colVal(c, r.a), d) });
      })))));
  const fbOnly = DB.seasonPS && rows.some((r) => DB.seasonPS[r.p.id]) && !rows.some((r) => perMatchPids().has(r.p.id)); // no per-match stats: FBref season totals
  el.append(card({ title: 'Squad', tools }, `${teamName(T)} · ${fbOnly ? 'season totals from FBref' : rangeLabel()} · ${S.per90 ? 'per 90 minutes' : 'totals'} · click a column to sort, a row to open the player`, h('div', { class: 'tbl-wrap' }, t)));
}
function peerPool(group) {
  return memo('peer|' + group + '|' + S.venue + '|' + leagueRange(), () => {
    const out = [];
    DB.teams.forEach((t) => {
      const ms = scoped(t.id, leagueRange());
      Object.values(DB.players).forEach((p) => { if (p.team === t.id && p.group === group) { const a = aggPlayer(ms, p.id); if (a.min >= 1) out.push({ p, a }); } });
    });
    const maxMin = Math.max(...out.map((x) => x.a.min), 1);
    return out.filter((x) => x.a.min >= Math.min(270, maxMin * 0.3));
  });
}
const PROFILE_METRICS = {
  FWD: ['npxg', 'sh', 'g', 'xa', 'key', 'boxT', 'drbW', 'progC', 'pct', 'rec', 'duel'],
  MID: ['npxg', 'xa', 'key', 'prog', 'progC', 'f3e', 'pct', 'drbW', 'tkl', 'int', 'rec'],
  DEF: ['prog', 'f3e', 'pct', 'progC', 'xa', 'tkl', 'int', 'rec', 'clr', 'duel', 'npxg'],
  GK: ['pa', 'pct', 'prog', 'f3e', 'rec', 'clr'],
};
// Fallback profile for stats-only sources (no xG or pitch locations)
const STATS_PROFILE = {
  FWD: ['g', 'sh', 'ast', 'key', 'drbW', 'pct', 'duel', 'rating', 'onGD', 'ppm'],
  MID: ['ast', 'key', 'pa', 'pct', 'drbW', 'tkl', 'int', 'duel', 'rating', 'onGD', 'ppm'],
  DEF: ['pa', 'pct', 'tkl', 'int', 'duel', 'fls', 'rating', 'onGD', 'ppm'],
  GK: ['savePct', 'gaK', 'cs', 'pa', 'pct', 'rating'],
};
function percentile(pid, group, k) {
  const pool = peerPool(group);
  const mt = PLAYER_METRICS.find((m) => m.k === k);
  const vals = pool.map((x) => playerValue(mt, x.a, true)).filter(has);
  const me = pool.find((x) => x.p.id === pid);
  if (!me || vals.length < 3) return null;
  const v = playerValue(mt, me.a, true);
  if (!has(v)) return null;
  const below = vals.filter((x) => x < v).length, eq = vals.filter((x) => x === v).length;
  return { pct: Math.round((100 * (below + eq / 2)) / vals.length), v, n: vals.length };
}
function pctBars(players, colors) {
  const group = DB.players[players[0]].group;
  const pool = peerPool(group);
  const avail = (k) => { const mt = PLAYER_METRICS.find((m) => m.k === k); return pool.some((x) => has(playerValue(mt, x.a, true))); };
  let keys = (PROFILE_METRICS[group] || PROFILE_METRICS.MID).filter(avail);
  if (keys.length < 6) keys = keys.concat(STATS_PROFILE[group].filter((k) => avail(k) && !keys.includes(k)));
  if (pool.length < 3) return h('p', { class: 'note', style: { marginTop: 0 }, text: `Percentiles need at least 3 ${GROUP_NAME[group].toLowerCase()}s with enough minutes to compare against. Add FBref tables for more teams to rank players across the league.` });
  return h('div', { class: 'pct' }, keys.map((k) => {
    const mt = PLAYER_METRICS.find((m) => m.k === k);
    return h('div', { class: 'pct-row' }, h('div', { class: 'nm', text: mt.l + (mt.p90 ? ' /90' : '') }),
      h('div', { class: 'pct-bars' }, players.map((pid, i) => {
        const r = percentile(pid, DB.players[pid].group, k);
        const bar = h('div', { class: 'pct-bar', tabindex: 0 }, h('div', { class: 'trk' }, h('div', { class: 'fill', style: { width: (r ? r.pct : 0) + '%', background: colors[i] } })), h('span', { class: 't', text: r ? fmt(r.v, mt.d) + ' · ' + ordinal(r.pct) : 'n/a' }));
        hover(bar, () => r ? [{ v: ordinal(r.pct) + ' percentile', strong: true }, { v: DB.players[pid].name + ': ' + fmt(r.v, mt.d) + ' ' + mt.l.toLowerCase() + (mt.p90 ? ' per 90' : '') }, { v: 'vs ' + r.n + ' league ' + GROUP_NAME[DB.players[pid].group].toLowerCase() + 's' }] : [{ v: 'Not enough minutes for a percentile' }]);
        return bar;
      })));
  }));
}
function actionMap(ms, pid, mode, color) {
  const p = pitch();
  const surf = css('--surface');
  ms.forEach((m) => m.events.forEach((e) => {
    if (e.pl !== pid) return;
    if (mode === 'pass' && e.type === 'pass' && e.ok && (progressive(e.x, e.y, e.ex, e.ey) || e.key)) {
      const key = e.key;
      const g = sv('g');
      g.append(sv('line', { x1: e.x, y1: e.y, x2: e.ex, y2: e.ey, stroke: key ? css('--c4') : color, 'stroke-width': key ? 0.7 : 0.45, 'stroke-opacity': key ? 1 : 0.7, 'stroke-linecap': 'round' }));
      g.append(sv('circle', { cx: e.ex, cy: e.ey, r: 0.8, fill: key ? css('--c4') : color }));
      hover(g, () => [{ v: key ? 'Key pass' + (e.xa ? ' · ' + e.xa.toFixed(2) + ' xA' : '') : 'Progressive pass', strong: true }, { v: matchLabel(m, DB.players[pid].team) + ' · ' + Math.floor(e.t / 60 + 1) + "'" }]);
      p.marks.append(g);
    } else if (mode === 'carry' && e.type === 'carry' && progressive(e.x, e.y, e.ex, e.ey)) {
      const g = sv('g');
      g.append(sv('line', { x1: e.x, y1: e.y, x2: e.ex, y2: e.ey, stroke: color, 'stroke-width': 0.5, 'stroke-dasharray': '1 0.8' }));
      g.append(sv('circle', { cx: e.ex, cy: e.ey, r: 0.8, fill: color }));
      hover(g, () => [{ v: 'Progressive carry', strong: true }, { v: matchLabel(m, DB.players[pid].team) }]);
      p.marks.append(g);
    } else if (mode === 'def' && (e.type in DEF_TYPES)) {
      const c = sv('circle', { cx: e.x, cy: e.y, r: 1.2, fill: color, 'fill-opacity': 0.8, stroke: surf, 'stroke-width': 0.3 });
      hover(c, () => [{ v: e.type[0].toUpperCase() + e.type.slice(1), strong: true }, { v: matchLabel(m, DB.players[pid].team) }]);
      p.marks.append(c);
    }
  }));
  return p.svg;
}
function playerProfile(pid, ms) {
  const p = DB.players[pid], a = aggPlayer(ms, pid), A = css('--team-a');
  const shots = [];
  ms.forEach((m) => m.events.forEach((e) => e.type === 'shot' && e.pl === pid && shots.push({ e, m })));
  const head = h('div', { class: 'profile-h' }, h('h2', { text: p.name }),
    h('span', { class: 'sub', text: `${p.num != null ? '#' + p.num + ' · ' : ''}${GROUP_NAME[p.group]}${p.role ? ' (' + p.role + ')' : ''} · ${teamName(p.team)}` }));
  // Only show the numbers this data source actually has
  const gk = p.group === 'GK';
  const items = gk
    ? [[a.min, 'Minutes', 0], [a.st, 'Starts', 0], [a.sota ? (100 * a.saves) / a.sota : NaN, 'Save %', 1, '%'], [a.saves, 'Saves', 0], [a.gaK, 'Conceded', 0], [a.cs, 'Clean sheets', 0], [a.rtN ? a.rt / a.rtN : NaN, 'Avg rating', 2], [100 * safe(a.pc, a.pa), 'Pass completion', 0, '%'], [ppmOf(a), 'Team pts / match', 2]]
    : [[a.min, 'Minutes', 0], [a.st, 'Starts', 0], [a.g, 'Goals', 0], [a.xg, 'xG', 1], [a.sh, 'Shots', 0], [a.ast, 'Assists', 0], [a.xa, 'xA', 1], [a.rtN ? a.rt / a.rtN : NaN, 'Avg rating', 2], [100 * safe(a.pc, a.pa), 'Pass completion', 0, '%'], [a.tkl + a.int, 'Tackles + int', 0],
      [has(a.onG) && has(a.onGA) ? a.onG - a.onGA : NaN, 'On-pitch +/−', 0, '', true], [ppmOf(a), 'Team pts / match', 2]];
  const stats = h('div', { class: 'statline' }, items.filter(([v]) => has(v)).map(([v, l, d, u, sg]) => h('div', null, h('b', { text: (sg ? signed(v, d) : fmt(v, d)) + (u || '') }), h('span', { text: l }))));
  const span = DB.seasonPS && DB.seasonPS[pid] && !perMatchPids().has(pid) ? 'Season totals from ' + (DB.seasonSrc ? 'Sportmonks' : 'FBref') : rangeLabel();
  if (!DB.hasEvents) {
    return card({ title: 'Player profile', span: true }, span, head, stats,
      h('div', { class: 'grid' }, h('div', null, h('div', { class: 'eyebrow', style: { marginBottom: '6px' }, text: 'Percentile vs league ' + GROUP_NAME[p.group].toLowerCase() + 's · per 90' }), pctBars([pid], [A])),
        h('p', { class: 'note', text: 'Heatmaps and action maps need event data with pitch locations, which this data source does not include.' })));
  }
  const hm = heatmap(ms, p.team, 'all', A, pid);
  const grid = h('div', { class: 'grid three' });
  grid.append(h('div', null, h('div', { class: 'eyebrow', style: { marginBottom: '6px' }, text: 'Heatmap · ' + hm.n + ' events' }), hm.el));
  grid.append(h('div', null, h('div', { class: 'eyebrow', style: { marginBottom: '6px' }, text: 'Percentile vs league ' + GROUP_NAME[p.group].toLowerCase() + 's · per 90' }), pctBars([pid], [A])));
  const modes = [['pass', 'Passes'], ['carry', 'Carries'], ['shots', 'Shots'], ['def', 'Defending']];
  const am = h('div', null, h('div', { style: { display: 'flex', justifyContent: 'space-between', gap: '8px', alignItems: 'center', flexWrap: 'wrap', marginBottom: '6px' } }, h('div', { class: 'eyebrow', text: 'Action map' }), seg(modes, S.act, (v) => { S.act = v; render(); }, 'Action map')));
  if (S.act === 'shots') { am.append(shotMap(shots.map((x) => ({ e: x.e })), A, { full: false, matchOf: (e) => matchLabel(shots.find((s) => s.e === e).m, p.team) })); am.append(shotLegend(A)); }
  else {
    am.append(actionMap(ms, pid, S.act, A));
    if (S.act === 'pass') am.append(legend([['Progressive pass', A, 'line'], ['Key pass', css('--c4'), 'line']]));
  }
  grid.append(am);
  return card({ title: 'Player profile', span: true }, span, head, stats, grid);
}

/* ---------- Compare ---------- */
function viewCompare(el) {
  el.append(h('div', { style: { marginBottom: '14px' } }, seg([['teams', 'Teams'], ['players', 'Players']], S.cmpMode, (v) => { S.cmpMode = v; render(); }, 'Compare')));
  if (S.cmpMode === 'players') return comparePlayers(el);
  const A = S.team, B = S.cmp, colA = css('--team-a'), colB = css('--team-b');
  const msA = scoped(A, leagueRange()), msB = scoped(B, leagueRange());
  const aA = teamAgg(A, leagueRange()), aB = teamAgg(B, leagueRange());
  const pickB = h('select', { id: 'cmp-b', onchange: (e) => { S.cmp = e.target.value; render(); } }, DB.teams.filter((t) => t.id !== A).map((t) => h('option', { value: t.id, selected: t.id === B, text: t.name })));
  el.append(h('div', { class: 'hero' }, h('h1', null, h('span', { style: { color: colA }, text: teamName(A) }), h('span', { style: { color: 'var(--muted)' }, text: ' v ' }), h('span', { style: { color: colB }, text: teamName(B) })),
    h('div', { class: 'meta' }, h('div', { class: 'field' }, h('label', { for: 'cmp-b', text: 'Compare with' }), pickB), h('span', { class: 'sub', text: { season: 'Season to date', last5: 'Last 5 matches each', last3: 'Last 3 matches each' }[leagueRange()] }))));
  const grid = h('div', { class: 'grid' });
  el.append(grid);
  const keys = teamHas(['ppg', 'g', 'ga', 'xg', 'xga', 'npxg', 'sh', 'sha', 'sot', 'shIn', 'xgsh', 'boxe', 'spxg', 'cor', 'poss', 'pass', 'ppp', 'direct', 'prog', 'tilt', 'ppda', 'height', 'hto', 'duel', 'fls', 'yc'], aA, aB);
  grid.append(card('Head to head', 'Per-match averages · bars scaled to the league maximum · bold marks the better side', butterfly(teamName(A), teamName(B), keys.map((k) => TM[k]), aA, aB, colA, colB)));
  if (!DB.hasEvents) {
    const selA = boardSelection(A, msA), selB = boardSelection(B, msB);
    if (DB.hasLineups && selA && selB) grid.append(card({ title: 'Usual line-ups', span: true }, 'Most-used formation and XI for each side', h('div', { class: 'twin' },
      [[A, selA, colA], [B, selB, colB]].map(([T, sel, c]) => h('div', null, h('h3', null, h('span', { class: 'swatch', style: { background: c } }), teamName(T), h('span', { class: 'sub', text: sel.form + ' (' + sel.matches.length + ' of ' + scoped(T, leagueRange()).length + ')' })), tacticalBoard(sel, T, 'plan', c))))));
    grid.append(eventsNote('Pitch maps', 'Game states, passing networks, touch maps and shot maps'));
    return;
  }
  grid.append(card('Game states', 'Share of ball-in-play time', h('div', { class: 'twin' },
    [[A, aA], [B, aB]].map(([T, a], i) => h('div', null, h('h3', null, h('span', { class: 'swatch', style: { background: i ? colB : colA } }), teamName(T)), phaseBlock(a, true))))));
  const pnA = passNetwork(msA, A, colA), pnB = passNetwork(msB, B, colB);
  const fl = (pn) => pn.forms.map(([f, c]) => f + ' (' + c + ')').join(', ');
  grid.append(card({ title: 'Shape & passing network', span: true }, 'Most-used XI at average positions, both attacking left to right', h('div', { class: 'twin' },
    h('div', null, h('h3', null, h('span', { class: 'swatch', style: { background: colA } }), teamName(A), h('span', { class: 'sub', text: fl(pnA) })), pnA.el),
    h('div', null, h('h3', null, h('span', { class: 'swatch', style: { background: colB } }), teamName(B), h('span', { class: 'sub', text: fl(pnB) })), pnB.el))));
  const hA = heatmap(msA, A, S.heat, colA), hB = heatmap(msB, B, S.heat, colB);
  const pA = teamPoints(msA, A, S.heat), pB = teamPoints(msB, B, S.heat);
  const dp = pitch();
  dp.heat.append(diffImage(density(pA), density(pB), colA, colB));
  grid.append(card({ title: 'Where they play', span: true, tools: seg(HEAT_MODES, S.heat, (v) => { S.heat = v; render(); }, 'Heatmap type') }, 'Touch maps and the difference between them', h('div', { class: 'twin' },
    h('div', null, h('h3', null, h('span', { class: 'swatch', style: { background: colA } }), teamName(A)), hA.el),
    h('div', null, h('h3', null, h('span', { class: 'swatch', style: { background: colB } }), teamName(B)), hB.el),
    h('div', null, h('h3', { text: 'Difference' }), dp.svg, legend([['More ' + teamName(A), colA], ['More ' + teamName(B), colB]])))));
  const sA = collectShots(msA, A), sB = collectShots(msB, B);
  grid.append(card({ title: 'Shot maps', span: true }, 'Shots for, all matches in range', h('div', { class: 'twin' },
    h('div', null, h('h3', null, h('span', { class: 'swatch', style: { background: colA } }), teamName(A), h('span', { class: 'sub', text: sA.length + ' shots · ' + sA.reduce((s, x) => s + x.e.xg, 0).toFixed(1) + ' xG' })), shotMap(sA, colA, { matchOf: (e) => matchLabel(sA.find((s) => s.e === e).m, A) })),
    h('div', null, h('h3', null, h('span', { class: 'swatch', style: { background: colB } }), teamName(B), h('span', { class: 'sub', text: sB.length + ' shots · ' + sB.reduce((s, x) => s + x.e.xg, 0).toFixed(1) + ' xG' })), shotMap(sB, colB, { matchOf: (e) => matchLabel(sB.find((s) => s.e === e).m, B) })))));
}
function butterfly(nameA, nameB, metrics, aA, aB, colA, colB) {
  const L = leagueAggs();
  return h('div', null, h('div', { class: 'fly-head' }, h('div', { style: { color: colA } , text: nameA }), h('div'), h('div', { style: { color: colB }, text: nameB })),
    h('div', { class: 'fly' }, metrics.map((mt) => {
      const va = mt.f(aA), vb = mt.f(aB);
      const d = Number.isInteger(va) && Number.isInteger(vb) ? 0 : mt.d; // single-match counts read as whole numbers
      const mx = Math.max(va, vb, ...L.map((r) => mt.f(r.a))) || 1;
      const better = mt.dir === 0 ? 0 : (va - vb) * mt.dir;
      const side = (v, c, cls, win) => h('div', { class: 'fly-side ' + cls }, h('div', { class: 'trk' }, h('div', { class: 'b', style: { width: clamp((100 * v) / mx, 0, 100) + '%', background: c } })), h('span', { class: 'v' + (win ? ' win' : ''), text: fmt(v, d) }));
      const row = h('div', { class: 'fly-row', tabindex: 0 }, side(va, colA, 'l', better > 0), h('div', { class: 'lab', text: mt.l + (mt.u && mt.u !== '/match' ? ' (' + mt.u + ')' : '') }), side(vb, colB, 'r', better < 0));
      hover(row, () => [{ v: mt.l, strong: true }, { color: colA, v: fmt(va, d), l: nameA }, { color: colB, v: fmt(vb, d), l: nameB }, mt.tip ? { v: mt.tip } : null, mt.dir === 0 ? { v: 'Style metric · neither side is better' } : null].filter(Boolean));
      return row;
    })));
}
function comparePlayers(el) {
  const colA = css('--team-a'), colB = css('--team-b');
  const eligible = Object.values(DB.players).filter((p) => p.group !== 'GK' || true);
  const mins = {};
  eligible.forEach((p) => (mins[p.id] = aggPlayer(scoped(p.team, leagueRange()), p.id).min));
  const pool = eligible.filter((p) => mins[p.id] >= 90);
  if (pool.length < 2) { el.append(h('p', { class: 'empty', text: 'Not enough players with 90+ minutes to compare.' })); return; }
  if (!S.pA || !DB.players[S.pA]) { const own = pool.filter((p) => p.team === S.team).sort((a, b) => mins[b.id] - mins[a.id]); S.pA = (own.find((p) => p.group === 'FWD') || own[0] || pool[0]).id; }
  if (!S.pB || !DB.players[S.pB] || S.pB === S.pA) { const g = DB.players[S.pA].group; const o = pool.filter((p) => p.group === g && p.team !== DB.players[S.pA].team).sort((a, b) => mins[b.id] - mins[a.id]); S.pB = (o[0] || pool.find((p) => p.id !== S.pA)).id; }
  const sel = (id, val, on) => h('select', { id, onchange: (e) => on(e.target.value) }, DB.teams.map((t) => h('optgroup', { label: t.name }, pool.filter((p) => p.team === t.id).sort((a, b) => a.name.localeCompare(b.name)).map((p) => h('option', { value: p.id, selected: p.id === val, text: `${p.name} · ${p.role || p.group}` })))));
  el.append(h('div', { class: 'hero' }, h('div', { class: 'meta' },
    h('div', { class: 'field' }, h('label', { for: 'pa', text: 'Player A' }), sel('pa', S.pA, (v) => { S.pA = v; render(); })),
    h('div', { class: 'field' }, h('label', { for: 'pb', text: 'Player B' }), sel('pb', S.pB, (v) => { S.pB = v; render(); })),
    h('span', { class: 'sub', text: 'Players with 90+ minutes · ' + { season: 'season to date', last5: 'last 5 team matches', last3: 'last 3 team matches' }[leagueRange()] }))));
  const pA = DB.players[S.pA], pB = DB.players[S.pB];
  const aA = aggPlayer(scoped(pA.team, leagueRange()), pA.id), aB = aggPlayer(scoped(pB.team, leagueRange()), pB.id);
  const grid = h('div', { class: 'grid' });
  el.append(grid);
  const nameLine = (p, c, a) => h('h3', null, h('span', { class: 'swatch', style: { background: c } }), p.name, h('span', { class: 'sub', text: `${teamName(p.team)} · ${p.role || p.group} · ${a.min} min` }));
  const note = pA.group !== pB.group ? 'Different positions: each player is ranked against their own position group, using ' + GROUP_NAME[pA.group].toLowerCase() + ' metrics.' : 'Percentile against league ' + GROUP_NAME[pA.group].toLowerCase() + 's, per 90 minutes';
  grid.append(card('Percentile profile', note, h('div', { style: { marginBottom: '10px' } }, nameLine(pA, colA, aA), nameLine(pB, colB, aB)), pctBars([pA.id, pB.id], [colA, colB])));
  const rows = PLAYER_METRICS.map((mt) => ({ mt, a: playerValue(mt, aA, true), b: playerValue(mt, aB, true) })).filter((r) => has(r.a) || has(r.b));
  grid.append(card('Per 90 numbers', 'All tracked metrics', h('div', { class: 'tbl-wrap' }, h('table', null, h('thead', null, h('tr', null, h('th', { class: 'l', text: 'Metric' }), h('th', { text: pA.name.split(' ').pop(), style: { color: colA } }), h('th', { text: pB.name.split(' ').pop(), style: { color: colB } }))),
    h('tbody', null, rows.map((r) => h('tr', { style: { cursor: 'default' } }, h('td', { class: 'l', text: r.mt.l + (r.mt.p90 ? ' /90' : '') }), h('td', { style: { fontWeight: r.a > r.b ? 700 : 400 }, text: fmt(r.a, r.mt.d) }), h('td', { style: { fontWeight: r.b > r.a ? 700 : 400 }, text: fmt(r.b, r.mt.d) }))))))));
  if (!DB.hasEvents) return;
  const hA = heatmap(scoped(pA.team, leagueRange()), pA.team, 'all', colA, pA.id), hB = heatmap(scoped(pB.team, leagueRange()), pB.team, 'all', colB, pB.id);
  grid.append(card({ title: 'Heatmaps', span: true }, 'All touches, attacking left to right', h('div', { class: 'twin' }, h('div', null, nameLine(pA, colA, aA), hA.el), h('div', null, nameLine(pB, colB, aB), hB.el))));
}

/* ---------- Matches ---------- */
function viewMatches(el) {
  const T = S.team, ms = compMatches(T);
  if (!ms.length) { el.append(h('p', { class: 'empty', text: 'No matches for this filter.' })); return; }
  if (!S.match || !ms.find((m) => m.id === S.match)) S.match = (S.range.startsWith('m:') && ms.find((m) => m.id === S.range.slice(2)) ? S.range.slice(2) : ms[ms.length - 1].id);
  const grid = h('div', { class: 'grid', style: { gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 360px), 1fr))' } });
  el.append(grid);
  const list = h('div', { class: 'mlist' }, ms.slice().reverse().map((m) => {
    const r = result(m, T);
    return h('button', { type: 'button', class: 'mrow', 'aria-current': String(m.id === S.match), onclick: () => { S.match = m.id; render(); } },
      h('span', { class: 'd', text: (m.date ? fmtDate(m.date) : '') + ' · ' + roundLabel(m) }), h('span', { class: 'res ' + r, text: r }),
      h('span', null, (venueOf(m, T) === 'A' ? '@ ' : 'v ') + teamName(oppOf(m, T)) + (m.neutral ? ' (N)' : '')), h('span', { class: 'score', text: goalsFor(m, T) + '–' + goalsAg(m, T) }),
      h('span', { class: 'xg', text: m.pens ? 'pens ' + (m.home === T ? m.pens.f + '–' + m.pens.a : m.pens.a + '–' + m.pens.f) : has(m.ts[T].xg) ? m.ts[T].xg.toFixed(1) + ' – ' + m.ts[T].xga.toFixed(1) + ' xG' : has(m.ts[T].sh) ? m.ts[T].sh + ' – ' + m.ts[T].sha + ' shots' : m.cup ? m.comp : '' }));
  }));
  const report = matchReport(ms.find((m) => m.id === S.match), T);
  grid.append(report, card('Results', teamName(T) + ' · newest first', list));
}
function matchReport(m, T) {
  const O = oppOf(m, T), colA = css('--team-a'), colB = css('--team-b');
  const home = m.home, away = m.away;
  const wrap = h('section', { class: 'card span' });
  const info = m.info || {};
  wrap.append(h('div', { class: 'eyebrow', text: [m.cup ? [m.comp, m.round].filter(Boolean).join(' · ') : `Round ${m.round}`, m.date ? fmtDate(m.date) : null, m.neutral ? 'Neutral venue' : null, info.att ? 'Attendance ' + info.att.toLocaleString('en-GB') : null, info.ref ? 'Referee ' + info.ref : null].filter(Boolean).join(' · ') }));
  const colOf = (id) => (id === T ? colA : colB);
  wrap.append(h('div', { class: 'scoreboard' },
    h('div', null, h('div', { class: 'tn', style: { color: colOf(home) }, text: teamName(home) }), h('div', { class: 'xgs', text: [m.forms[home], has(m.ts[home].xg) ? m.ts[home].xg.toFixed(2) + ' xG' : null].filter(Boolean).join(' · ') })),
    h('div', { class: 'sc', text: m.hg + '–' + m.ag }, m.pens ? h('div', { class: 'xgs', style: { textAlign: 'center' }, text: `${m.pens.f}–${m.pens.a} on penalties` }) : null),
    h('div', null, h('div', { class: 'tn r', style: { color: colOf(away) }, text: teamName(away) }), h('div', { class: 'xgs', style: { textAlign: 'right' }, text: [has(m.ts[away].xg) ? m.ts[away].xg.toFixed(2) + ' xG' : null, m.forms[away]].filter(Boolean).join(' · ') }))));
  const scorers = (id) => m.timeline ? m.timeline.filter((t) => t.kind === 'goal' && t.team === id).map((t) => (DB.players[t.pl] ? DB.players[t.pl].name.split(' ').pop() : t.ogName ? t.ogName.split(' ').pop() : '?') + ' ' + t.min + "'" + (/penalty/i.test(t.detail) ? ' (p)' : /own/i.test(t.detail) ? ' (og)' : '')).join(', ') : m.events.filter((e) => e.type === 'shot' && e.out === 'goal' && e.team === id).map((e) => DB.players[e.pl].name.split(' ').pop() + ' ' + Math.floor(e.t / 60 + 1) + "'" + (e.sp === 'pen' ? ' (p)' : '')).join(', ');
  wrap.append(h('div', { class: 'scoreboard', style: { marginBottom: '16px' } }, h('div', { class: 'sub', text: scorers(home) }), h('div'), h('div', { class: 'sub', style: { textAlign: 'right' }, text: scorers(away) })));
  const grid = h('div', { class: 'grid' });
  wrap.append(grid);
  const statKeys = (aT, aO) => teamHas(['xg', 'sh', 'sot', 'shIn', 'xgsh', 'poss', 'pass', 'prog', 'f3e', 'boxe', 'tilt', 'cor', 'ppda', 'height', 'hto', 'duel', 'fls', 'yc'], aT, aO).map((k) => TM[k]);
  if (!m.events.length) {
    const aT = m.ts[T], aO = m.ts[O];
    const keys = statKeys(aT, aO);
    grid.append(h('div', null, h('div', { class: 'eyebrow', style: { marginBottom: '8px' }, text: 'Match stats' }),
      keys.length ? butterfly(teamName(T), teamName(O), keys, aT, aO, colA, colB) : h('p', { class: 'empty', text: m.cup ? 'Cup match: only the result and match details are recorded (football-data.co.uk covers league matches only).' : m.detail === false ? 'Details for this match have not been downloaded yet.' : 'No match stats in this data.' })));
    const side = h('div', { class: 'stack' });
    if (m.odds) side.append(oddsBlock(m, T, colA, colB));
    if (m.timeline && m.timeline.length) side.append(h('div', null, h('div', { class: 'eyebrow', style: { marginBottom: '8px' }, text: 'Timeline' }), matchTimeline(m, T, colA, colB)));
    if (side.children.length) grid.append(side);
    const lined = (id) => m.lineups[id] && m.lineups[id].length;
    if (lined(T) || lined(O)) {
      const one = (id) => { const sel = lined(id) && boardSelection(id, [m]); return sel ? tacticalBoard(sel, id, 'plan', id === T ? colA : colB) : h('p', { class: 'empty', text: 'No line-up' }); };
      grid.append(h('div', { style: { gridColumn: '1 / -1' } }, h('div', { class: 'eyebrow', style: { marginBottom: '8px' }, text: 'Starting line-ups · both attacking right' }), h('div', { class: 'twin' },
        h('div', null, h('h3', null, h('span', { class: 'swatch', style: { background: colA } }), teamName(T), h('span', { class: 'sub', text: m.forms[T] || '' })), one(T)),
        h('div', null, h('h3', null, h('span', { class: 'swatch', style: { background: colB } }), teamName(O), h('span', { class: 'sub', text: m.forms[O] || '' })), one(O)))));
    }
    return wrap;
  }
  // momentum
  const mom = h('div');
  grid.append(h('div', null, h('div', { class: 'eyebrow', text: 'xG race · cumulative by minute' }), mom, legend([[teamName(T), colA, 'line'], [teamName(O), colB, 'line']])));
  requestAnimationFrame(() => xgRace(mom, m, T, O, colA, colB));
  // shot map full pitch
  const shots = m.events.filter((e) => e.type === 'shot').map((e) => ({ e, mirror: e.team !== T, col: e.team === T ? colA : colB }));
  grid.append(h('div', null, h('div', { class: 'eyebrow', text: `Shot map · ${teamName(T)} attacking right` }), shotMap(shots, colA, { full: true }), shotLegend(css('--ink-2'))));
  // stats
  const aT = m.ts[T], aO = m.ts[O];
  grid.append(h('div', null, h('div', { class: 'eyebrow', style: { marginBottom: '8px' }, text: 'Match stats' }), butterfly(teamName(T), teamName(O), statKeys(aT, aO), aT, aO, colA, colB)));
  grid.append(h('div', null, h('div', { class: 'eyebrow', style: { marginBottom: '8px' }, text: 'Game states' }), h('div', { class: 'twin' }, [[T, aT, colA], [O, aO, colB]].map(([id, a, c]) => h('div', null, h('h3', null, h('span', { class: 'swatch', style: { background: c } }), teamName(id)), phaseBlock(a, true))))));
  const pnT = passNetwork([m], T, colA), pnO = passNetwork([m], O, colB);
  grid.append(h('div', { style: { gridColumn: '1 / -1' } }, h('div', { class: 'eyebrow', style: { marginBottom: '8px' }, text: 'Passing networks · starting XIs, both attacking right' }), h('div', { class: 'twin' },
    h('div', null, h('h3', null, h('span', { class: 'swatch', style: { background: colA } }), teamName(T), h('span', { class: 'sub', text: m.forms[T] || '' })), pnT.el),
    h('div', null, h('h3', null, h('span', { class: 'swatch', style: { background: colB } }), teamName(O), h('span', { class: 'sub', text: m.forms[O] || '' })), pnO.el))));
  return wrap;
}
function oddsBlock(m, T, colA, colB) {
  // Pre-match win/draw/loss chances implied by bookmaker odds, shown from the selected team's side.
  const mine = m.home === T ? m.odds.h : m.odds.a, theirs = m.home === T ? m.odds.a : m.odds.h, O = oppOf(m, T);
  const r = result(m, T);
  const seg = (p, bg, label, cls) => {
    const el = h('div', { class: cls || '', style: { width: 100 * p + '%', background: bg }, tabindex: 0, text: p >= 0.12 ? Math.round(100 * p) + '%' : '' });
    hover(el, () => [{ v: (100 * p).toFixed(0) + '%', strong: true }, { v: label }]);
    return el;
  };
  const verdict = r === 'W' ? (mine >= theirs ? 'Won as favourites' : 'Won as underdogs') : r === 'L' ? (mine >= theirs ? 'Lost as favourites' : 'Lost as underdogs') : 'Drew';
  return h('div', null, h('div', { class: 'eyebrow', style: { marginBottom: '8px' }, text: 'Pre-match odds · ' + verdict }),
    h('div', { class: 'stackbar' }, seg(mine, colA, teamName(T) + ' win'), seg(m.odds.d, css('--muted'), 'Draw'), seg(theirs, colB, teamName(O) + ' win')),
    legend([[teamName(T) + ' win', colA], ['Draw', css('--muted')], [teamName(O) + ' win', colB]]),
    h('p', { class: 'note', text: 'Implied by the average bookmaker odds before kick-off, with the bookmaker margin removed.' }));
}
function matchTimeline(m, T, colA, colB) {
  const items = (m.timeline || []).slice().sort((a, b) => a.min - b.min);
  if (!items.length) return h('p', { class: 'empty', text: 'No match events in this data.' });
  const name = (id) => (DB.players[id] ? DB.players[id].name : '?');
  return h('ol', { class: 'timeline' }, items.map((t) => {
    const icon = { goal: 'Goal', yellow: 'Yellow', red: 'Red', sub: 'Sub' }[t.kind];
    const text = t.kind === 'goal' ? (t.pl ? name(t.pl) : t.ogName || '?') + (t.as ? ' (assist ' + name(t.as).split(' ').pop() + ')' : '') + (/penalty/i.test(t.detail) ? ' · penalty' : /own/i.test(t.detail) ? ' · own goal' : '')
      : t.kind === 'sub' ? name(t.pl) + ' on for ' + name(t.as) : name(t.pl);
    return h('li', { class: 'tl-' + t.kind + (t.team === T ? '' : ' opp') },
      h('span', { class: 'tl-min', text: t.min + "'" }), h('span', { class: 'tl-dot', style: { background: t.team === T ? colA : colB } }),
      h('span', { class: 'tl-kind', text: icon }), h('span', { class: 'tl-text', text: text }));
  }));
}
function xgRace(box, m, T, O, colA, colB) {
  const W = Math.max(280, box.clientWidth || 500), H = 210, mg = { l: 30, r: 12, t: 12, b: 24 };
  const endMin = Math.max(95, ...m.events.map((e) => Math.ceil(e.t / 60) + 1));
  const series = [T, O].map((id) => {
    let c = 0;
    const pts = [[0, 0]];
    m.events.filter((e) => e.type === 'shot' && e.team === id).forEach((e) => { const mn = e.t / 60; pts.push([mn, c]); c += e.xg; pts.push([mn, c, e]); });
    pts.push([endMin, c]);
    return { id, pts, total: c };
  });
  const top = Math.max(1, Math.ceil(Math.max(...series.map((s) => s.total)) * 2) / 2);
  const X = (v) => mg.l + ((W - mg.l - mg.r) * v) / endMin, Y = (v) => mg.t + (H - mg.t - mg.b) * (1 - v / top);
  const svg = sv('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%' });
  const ax = sv('g', { class: 'axis' });
  const st = top > 2 ? 1 : 0.5;
  for (let v = 0; v <= top + 1e-9; v += st) { ax.append(sv('line', { x1: mg.l, x2: W - mg.r, y1: Y(v), y2: Y(v), class: v ? 'grid-line' : 'baseline' })); ax.append(sv('text', { x: mg.l - 6, y: Y(v) + 4, 'text-anchor': 'end', text: v.toFixed(v % 1 ? 1 : 0) })); }
  [0, 15, 30, 45, 60, 75, 90].forEach((mn) => ax.append(sv('text', { x: X(mn), y: H - 6, 'text-anchor': 'middle', text: mn + "'" })));
  ax.append(sv('line', { x1: X(45), x2: X(45), y1: mg.t, y2: H - mg.b, class: 'grid-line', 'stroke-dasharray': '3 3' }));
  svg.append(ax);
  series.forEach((s, i) => {
    const c = i ? colB : colA;
    svg.append(sv('path', { d: s.pts.map((p, k) => (k ? 'L' : 'M') + X(p[0]).toFixed(1) + ' ' + Y(p[1]).toFixed(1)).join(''), fill: 'none', stroke: c, 'stroke-width': 2, 'stroke-linejoin': 'round' }));
    s.pts.filter((p) => p[2]).forEach((p) => {
      const e = p[2], goal = e.out === 'goal';
      const dot = sv('circle', { cx: X(p[0]), cy: Y(p[1]), r: goal ? 5 : 2.5, fill: goal ? c : css('--surface'), stroke: goal ? css('--surface') : c, 'stroke-width': goal ? 2 : 1.5 });
      hover(dot, () => [{ v: (goal ? 'Goal · ' : '') + e.xg.toFixed(2) + ' xG', strong: true }, { v: DB.players[e.pl].name + ' · ' + Math.floor(e.t / 60 + 1) + "'" }, { v: teamName(s.id) + ' total ' + p[1].toFixed(2) + ' xG' }]);
      svg.append(dot);
    });
    svg.append(sv('text', { x: W - mg.r, y: Y(s.total) - 6, 'text-anchor': 'end', class: 'lbl', text: s.total.toFixed(2) }));
  });
  box.append(svg);
}

/* ---------- Data ---------- */
// football-data.co.uk season folder, e.g. 2627 for 2026/27 (seasons roll over in July).
function seasonCode(d = new Date()) {
  const y = d.getUTCMonth() >= 6 ? d.getUTCFullYear() : d.getUTCFullYear() - 1;
  return String(y % 100).padStart(2, '0') + String((y + 1) % 100).padStart(2, '0');
}
const FB_FIELD_NAMES = { min: 'minutes', st: 'starts', n: 'appearances', g: 'goals', ast: 'assists', xg: 'xG', npxg: 'npxG', xa: 'xAG', prog: 'progressive passes', progC: 'progressive carries', sh: 'shots', sot: 'shots on target', key: 'key passes', f3e: 'passes into final third', pc: 'passes completed', pa: 'passes', tkl: 'tackles', int: 'interceptions', clr: 'clearances', touch: 'touches', boxT: 'touches in box', drb: 'take-ons', drbW: 'successful take-ons', rec: 'recoveries', fls: 'fouls', yc: 'yellow cards', gaK: 'goals conceded', sota: 'shots on target faced', saves: 'saves', cs: 'clean sheets', onG: 'team goals while on the pitch', onGA: 'team goals conceded while on the pitch', ppm: 'team points per match', subs: 'substitute appearances' };
function flash(msg, cls) {
  setTimeout(() => { const n = document.querySelector('#main'); if (n) n.prepend(h('p', { class: 'status ' + (cls || 'ok'), role: 'status', style: { marginTop: 0, marginBottom: '12px' }, text: msg })); }, 0);
}
// Add FBref season totals (one or more tables) to a team in the loaded season.
// opts.restore: replaying saved data at start-up (no render, message or re-save); opts.nosave: the caller saves.
function addFbref(texts, teamId, statusEl, opts = {}) {
  const say = (msg) => { if (statusEl) { statusEl.className = 'status err'; statusEl.textContent = msg; } };
  if (DB.source === 'demo') { say('Load a real season first (for example this season’s football-data.co.uk file), then add FBref player stats to it.'); return false; }
  const r = attachFbref(DB, teamId, texts);
  if (!r.tables) { say(r.errors[0] || 'No FBref player table found.'); return false; }
  cache.clear();
  if (opts.restore) return true;
  if (!opts.nosave) saveFbref(teamId, teamName(teamId), texts);
  const n = Object.values(DB.players).filter((p) => p.team === teamId && DB.seasonPS[p.id]).length;
  const parts = [];
  if (r.fields.length) parts.push(`${r.fields.map((f) => FB_FIELD_NAMES[f] || f).join(', ')} for ${r.rowsRead} ${teamName(teamId)} player${r.rowsRead === 1 ? '' : 's'} (${n} in the squad view)`);
  const fx = r.fixtures;
  if (fx) {
    parts.push(`formations, possession, attendance and referees for ${fx.matched} of ${fx.played - fx.cups} ${teamName(teamId)} league matches` + (fx.cups ? `, ${fx.cups} cup tie${fx.cups > 1 ? 's' : ''}` : '') + (fx.upcoming ? `, plus ${fx.upcoming} upcoming fixtures` : ''));
    if (fx.unmatched.length) parts.push(`not matched to the loaded season (usually cup games): ${fx.unmatched.slice(0, 4).join('; ')}${fx.unmatched.length > 4 ? '…' : ''}`);
  }
  if (r.records) parts.push(`${teamName(teamId)}’s all-time record against ${r.records.clubs} clubs (${r.records.games.toLocaleString('en-GB')} matches)`);
  S.team = teamId; S.player = null; S.sort = 'min'; S.per90 = true; S.form = null; S.opp = null;
  S.tab = r.fields.length ? 'players' : r.records ? 'opponents' : 'tactics';
  render();
  flash('Added ' + parts.join('. ') + '.' + (r.errors.length ? ' ' + r.errors.join(' ') : '') + ' Paste more FBref tables in the Data tab to fill in more.');
  return true;
}
// Attach an API-Football cup download (full match detail) to the loaded season
function addAfCup(parsed, texts, statusEl, opts = {}) {
  const say = (msg) => { if (statusEl) { statusEl.className = 'status err'; statusEl.textContent = msg; } return false; };
  if (DB.source === 'demo' || DB.source === 'sample' || DB.transient && !DB.pastSeason) return say('Load the league season first (for example this season’s football-data.co.uk file), then add the cup file to it.');
  const lg = afCupLeague(parsed);
  const sk = lg && lg.season ? lg.season + '/' + String((lg.season + 1) % 100).padStart(2, '0') : '';
  if (sk && DB.season && sk !== DB.season) return say(`This ${lg.name} file is for ${sk}, but ${DB.season} is loaded. Pick ${sk} with Season at the top first (or download --season ${String(DB.season).slice(0, 4)}).`);
  const r = attachApiFootballCups(DB, parsed);
  cache.clear();
  if (opts.restore) return true;
  const files = texts.filter((t) => parsed.some((p) => p.name === t.name)).map((f) => ({ name: f.name, text: f.text }));
  if (DB.pastSeason) { const k = DB.season; Promise.all(files.map((f) => pastAddLayer(k, f))).then(refreshSeasons); }
  else saveLayers(files);
  S.comp = 'all'; S.tab = 'matches'; S.match = null;
  render();
  flash(`Added ${r.comp} ${sk}: ${r.matches} match${r.matches === 1 ? '' : 'es'}${r.detailed ? ` (${r.detailed} with line-ups, team and player stats)` : ''}${r.upcoming ? `, plus ${r.upcoming} upcoming` : ''}. Use Competition at the top to see cups with or without the league.`);
  return true;
}
// Attach Sportmonks downloads (line-ups, events, per-player match stats) to the loaded season
function addSportmonks(files, statusEl, opts = {}) {
  const say = (msg) => { if (statusEl) { statusEl.className = 'status err'; statusEl.textContent = msg; } return false; };
  if (DB.source === 'demo') return say('Load the season file first (for example this season’s football-data.co.uk file), then add the Sportmonks file to it.');
  // A Sportmonks file for another season goes with that season
  const other = files.filter((f) => { const k = seasonKey(f.data.season && f.data.season.name); return k && DB.season && k !== DB.season; });
  if (other.length && !opts.restore) {
    const f = other[0], k = seasonKey(f.data.season.name);
    if (!SEASONS.list.some((x) => x.season === k) && !(SEASONS.real && SEASONS.real.season === k)) return say(`This Sportmonks file is for ${k}. Add that season’s football-data.co.uk file first (Data tab, Seasons), then this file.`);
    if (SEASONS.real && SEASONS.real.season === k) { DB = SEASONS.real; cache.clear(); return addSportmonks(files, statusEl, opts); }
    pastAddLayer(k, { name: f.name, text: f.text }).then(async (ok) => {
      await refreshSeasons();
      delete SEASON_DB[k];
      if (loadSeason(k)) { S.tab = 'players'; render(); }
      flash(`Added Sportmonks line-ups and player stats to ${k}.` + (ok ? '' : ' This browser would not save it, so it will be gone when you reload.'), ok ? 'ok' : 'err');
    });
    return true;
  }
  let last = null;
  for (const f of files) {
    const r = attachSportmonks(DB, f.data);
    if (!r.matched) return say(`None of the ${r.finished} matches in ${f.name} match the loaded season (${DB.label}). Check it is the same league and season.`);
    last = r;
  }
  cache.clear();
  if (opts.restore) return true;
  if (!opts.nosave) {
    if (DB.pastSeason) { const k = DB.season; Promise.all(files.map((f) => pastAddLayer(k, { name: f.name, text: f.text }))).then(refreshSeasons); } // goes with that past season
    else saveLayers(files.map((f) => ({ name: f.name, text: f.text })));
  }
  S.player = null; S.form = null; S.tab = 'players'; S.sort = 'min';
  render();
  flash(`Added Sportmonks data for ${last.matched} of ${last.finished} matches: line-ups, formations, goals, assists, cards, substitutions and player match stats for every club` +
    (last.upcoming ? `, plus ${last.upcoming} upcoming fixtures` : '') + (last.unmatched.length ? `. Not matched: ${last.unmatched.slice(0, 3).join('; ')}` : '') + '.');
  return true;
}
function fbrefCard() {
  const st = h('div', { class: 'status', role: 'status' });
  if (DB.source === 'demo') return card('Player stats from FBref', 'Season totals for each player', h('p', { class: 'note', style: { marginTop: 0 }, text: 'Load a real season first (this season’s football-data.co.uk file is quickest). Then come back here to add FBref player stats to Aberdeen or any other team.' }));
  const ta = h('textarea', { id: 'fb-paste', rows: 6, placeholder: 'Paste an FBref player table here', spellcheck: 'false' });
  const sel = h('select', { id: 'fb-team' }, DB.teams.map((t) => h('option', { value: t.id, selected: t.id === S.team, text: t.name })));
  const go = () => { if (!ta.value.trim()) { st.className = 'status err'; st.textContent = 'Paste a table first.'; return; } addFbref([{ name: 'Pasted table', text: ta.value }], sel.value, st); };
  return card('Player stats from FBref', 'Season totals for each player · nothing leaves your browser', h('div', { class: 'prose' },
    h('ol', null,
      h('li', null, 'Open the team’s squad page on FBref, e.g. ', h('a', { href: 'https://fbref.com/en/squads/8bbab7cf/Aberdeen-Stats', target: '_blank', rel: 'noopener', text: 'Aberdeen' }), '.'),
      h('li', null, 'Above the ', h('b', { text: 'Standard Stats' }), ' table, open ', h('b', { text: 'Share & Export' }), ' and choose ', h('b', { text: 'Get table as CSV (for Excel)' }), '. Copy all the text that appears. Selecting and copying the table itself also works.'),
      h('li', null, 'Paste it below, choose the team, and add it. Repeat with Shooting, Goalkeeping and Playing Time (and Passing, Defensive Actions and Possession where FBref has them) for more columns, and with other teams to compare players across the league.'),
      h('li', null, 'Also paste the team’s ', h('b', { text: 'Scores & Fixtures' }), ' table: it adds each match’s formations, possession, attendance and referee, plus the upcoming fixtures.'))),
    h('div', { class: 'field', style: { marginBottom: '8px' } }, h('label', { for: 'fb-team', text: 'Team' }), sel),
    h('div', { class: 'field' }, h('label', { for: 'fb-paste', text: 'FBref table' }), ta),
    h('div', { style: { marginTop: '10px', display: 'flex', gap: '8px', flexWrap: 'wrap' } }, h('button', { class: 'btn', type: 'button', onclick: go, text: 'Add player stats' })),
    st,
    h('p', { class: 'note', text: 'FBref figures are season totals, so the match filters do not change them. Data: FBref.com.' }));
}
// Import file texts ({name, text}): a new season (CSV/JSON), or FBref tables added to the loaded one.
// opts.restore replays saved data quietly at start-up. Returns true when something was loaded.
function importTexts(texts, statusEl, opts = {}) {
  const fail = (msg) => { if (statusEl) { statusEl.className = 'status err'; statusEl.textContent = msg; } return false; };
  const prevSnap = DB && DB.snapshot ? DB.label : null; // replacing the built-in snapshot with a newer file for the same season
  // CSV files (football-data.co.uk) and JSON files (API-Football, StatsBomb) are told apart by content.
  const csv = [], parsed = [], fb = [], sm = [], evb = [];
  texts.forEach((f) => {
    const t = f.text.replace(/^﻿/, '').trimStart();
    if (t[0] === '[' || t[0] === '{') { const data = JSON.parse(t); if (smIsBundle(data)) sm.push({ name: f.name, text: f.text, data }); else if (data && data.source === 'touchline-events') evb.push(data); else parsed.push({ name: f.name, data }); }
    else if (fdIsCSV(fdParseCSV(t))) csv.push({ name: f.name, rows: fdParseCSV(t) });
    else if (fbIsTable(fbParse(t)) || fbIsFixtures(fbParse(t)) || fbIsRecords(fbParse(t))) fb.push({ name: f.name, text: t });
  });
  // Event data (from tools/fetch-statsbomb.mjs): shown for this visit, not saved, so saved season data stays as it is
  if (evb.length) {
    DB = eventsDB(evb[0]); DB.source = 'import'; DB.transient = true;
    cache.clear();
    S.team = DB.teams[0].id; S.cmp = (DB.teams[1] || DB.teams[0]).id;
    S.range = 'season'; S.player = null; S.match = null; S.pA = S.pB = null; S.form = null; S.opp = null; S.loss = null; S.comp = 'all';
    S.tab = 'press';
    render();
    flash(`Loaded ${evb[0].label}: ${DB.matches.length} matches with every event${evb[0].with360 ? ` (${evb[0].with360} with 360 player positions)` : ''}. Event files are not saved in the browser, so your saved data comes back when you reload. Data: ${evb[0].attribution}.`);
    return true;
  }
  if (!csv.length && !parsed.length && !fb.length && !sm.length) return fail('These files are not in a format Touchline Lab reads. Use a football-data.co.uk CSV, an FBref player table, the Sportmonks or API-Football download, or StatsBomb event files.');
  // FBref tables and Sportmonks files add to the season already loaded
  if (!csv.length && !parsed.length) {
    let ok = true;
    if (fb.length) ok = addFbref(fb, S.team, statusEl, { ...opts, quiet: sm.length > 0 }) && ok;
    if (sm.length) ok = addSportmonks(sm, statusEl, opts) && ok;
    return ok;
  }
  // API-Football cup files (League Cup, Scottish Cup) add to the season already loaded
  if (!csv.length && parsed.length && isApiFootball(parsed) && afCupLeague(parsed)) return addAfCup(parsed, texts, statusEl, opts);
  const kind = csv.length ? 'fd' : isApiFootball(parsed) ? 'af' : 'sb';
  const { db, errors } = kind === 'fd' ? importFootballData(csv) : kind === 'af' ? importApiFootball(parsed) : importStatsBomb(parsed);
  // An older season than the current one is kept as a past season, not instead of it
  if (kind === 'fd' && !opts.restore && db.matches.length && SEASONS.real && db.season && db.season < SEASONS.real.season) {
    pastAddPrimary(db.season, texts).then(async (ok) => {
      await refreshSeasons();
      delete SEASON_DB[db.season];
      if (loadSeason(db.season)) { S.tab = 'seasons'; render(); }
      flash(`Added ${db.label} as a past season. Your ${SEASONS.real.season} data is unchanged.` + (ok ? '' : ' This browser would not save it, so it will be gone when you reload.'), ok ? 'ok' : 'err');
    });
    return true;
  }
  if (!db.matches.length) {
    return fail(kind !== 'sb' ? (errors[0] || 'No finished matches found.') : 'No matches found. Use a football-data.co.uk CSV, the API-Football file from the download script, or StatsBomb event files (each must include the two "Starting XI" events).');
  }
  DB = prepareDB(db);
  cache.clear();
  const counts = {};
  DB.matches.forEach((m) => [m.home, m.away].forEach((t) => (counts[t] = (counts[t] || 0) + 1)));
  const abd = DB.teams.find((t) => /aberdeen/i.test(t.name));
  S.team = abd ? abd.id : Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
  S.form = null; S.shape = 'plan';
  S.cmp = (DB.teams.find((t) => t.id !== S.team) || DB.teams[0]).id;
  S.range = 'season'; S.player = null; S.match = null; S.pA = null; S.pB = null;
  if (fb.length) addFbref(fb, S.team, statusEl, { ...opts, nosave: true, restore: true });
  if (sm.length) addSportmonks(sm, statusEl, { restore: true }); // dropped together with the season file
  if (opts.restore) return true;
  if (errors.length && kind === 'fd') flash(errors[0], 'err');
  S.tab = fb.length ? 'players' : kind === 'sb' ? 'press' : 'overview';
  render();
  if (kind === 'sb') { DB.transient = true; flash(`Loaded ${DB.matches.length} StatsBomb match${DB.matches.length === 1 ? '' : 'es'}${DB.matches.some((m) => m.events.some((e) => e.ff)) ? ' with 360 player positions' : ''}. Event files are not saved in the browser, so your saved data comes back when you reload.`); return true; }
  // An updated file for the same season keeps the FBref tables already added to it
  const label = DB.label, thisDB = DB;
  carriedFbref(label).then(async (keep) => {
    if (!keep.length && prevSnap === label) keep = snapshotFbref(DB); // keep the built-in FBref tables too
    const man = await carriedManual(label);
    let lay = await carriedLayers(label);
    if (!lay.length && prevSnap === label && SNAP) lay = (SNAP.layers || []).slice(); // keep the built-in Sportmonks data too
    if ((keep.length || man.length || lay.length) && DB === thisDB) {
      keep.forEach((f) => { if (DB.teamById[f.team]) addFbref(f.texts, f.team, null, { restore: true }); });
      applyLayers(lay);
      man.forEach((e) => applyManual(DB, e));
      DB.manual = man.slice();
      cache.clear();
      render();
      const kept = [keep.length ? `${keep.length} FBref table${keep.length > 1 ? 's' : ''}` : '', lay.length ? 'Sportmonks data' : '', man.length ? `${man.length} match${man.length > 1 ? 'es' : ''} you added` : ''].filter(Boolean).join(', ');
      flash(`Updated ${label}. Your ${kept} ${keep.length + man.length + lay.length > 1 ? 'were' : 'was'} added back.`);
    }
    const ok = await savePrimary(texts, label, keep, man, lay);
    if (S.tab === 'data') render();
    if (!ok) flash('Loaded, but this browser would not save it, so it will be gone when you reload the page.', 'err');
  });
  return true;
}
// Hand-entered cup ties and fixtures, for competitions the data sources don't cover
function addMatchCard() {
  if (DB.source === 'demo') return null;
  const T = S.team, st = h('div', { class: 'status', role: 'status' });
  const inp = (id, a) => h('input', { id, ...a });
  const dl = (id, items) => h('datalist', { id }, items.map((v) => h('option', { value: v })));
  const date = inp('am-date', { type: 'date', required: true });
  const time = inp('am-time', { type: 'time' });
  const comp = inp('am-comp', { type: 'text', list: 'am-comps', value: 'League Cup', autocomplete: 'off' });
  const round = inp('am-round', { type: 'text', list: 'am-rounds', placeholder: 'e.g. Semi-final', autocomplete: 'off' });
  const opp = inp('am-opp', { type: 'text', list: 'am-teams', placeholder: 'Opponent', autocomplete: 'off' });
  const venue = h('select', { id: 'am-venue' }, [['H', 'Home'], ['A', 'Away'], ['N', 'Neutral venue']].map(([v, l]) => h('option', { value: v, text: l })));
  const gf = inp('am-gf', { type: 'number', min: 0, max: 30, inputmode: 'numeric', placeholder: '–' });
  const ga = inp('am-ga', { type: 'number', min: 0, max: 30, inputmode: 'numeric', placeholder: '–' });
  const pf = inp('am-pf', { type: 'number', min: 0, max: 30, inputmode: 'numeric', placeholder: '–' });
  const pa = inp('am-pa', { type: 'number', min: 0, max: 30, inputmode: 'numeric', placeholder: '–' });
  const field = (label, el, id) => h('div', { class: 'field' }, h('label', { for: id, text: label }), el);
  const num = (el) => (el.value === '' ? null : Math.max(0, parseInt(el.value, 10)));
  const err = (msg) => { st.className = 'status err'; st.textContent = msg; };
  const form = h('form', { class: 'am-form', onsubmit: async (ev) => {
    ev.preventDefault();
    const e = { team: T, teamName: teamName(T), date: date.value, time: time.value, comp: comp.value.trim() || 'Cup', round: round.value.trim(), opp: opp.value.trim(), venue: venue.value, gf: num(gf), ga: num(ga) };
    if (!e.date) return err('Enter the date.');
    if (!e.opp) return err('Enter the opponent.');
    if ((e.gf == null) !== (e.ga == null)) return err('Enter both scores for a played match, or leave both blank for an upcoming one.');
    if (e.gf != null && (DB.leagueComp && e.comp === DB.leagueComp || /^(scottish )?premiership$/i.test(e.comp))) return err('League results come from the season file. Use this form for cup ties and other competitions.');
    const p1 = num(pf), p2 = num(pa);
    if (e.gf != null && e.gf === e.ga && p1 != null && p2 != null && p1 !== p2) e.pens = { f: p1, a: p2 };
    e.id = e.team + '|' + e.date + '|' + fbTeamKey(e.opp);
    applyManual(DB, e);
    DB.manual = (DB.manual || []).filter((x) => x.id !== e.id).concat(e);
    cache.clear();
    const saved = await saveManual(e);
    render();
    flash(`${e.gf != null ? 'Added the result' : 'Added the fixture'}: ${e.comp}${e.round ? ' ' + e.round.toLowerCase() : ''} v ${e.opp} on ${fmtDate(e.date)}.` + (saved ? '' : ' This browser would not save it, so it will be gone when you reload.'), saved ? 'ok' : 'err');
  } },
    h('div', { class: 'am-grid' },
      field('Date', date, 'am-date'), field('Kick-off (optional)', time, 'am-time'),
      field('Competition', comp, 'am-comp'), field('Round', round, 'am-round'),
      field('Opponent', opp, 'am-opp'), field('Venue', venue, 'am-venue')),
    h('div', { class: 'am-score' },
      h('span', { class: 'eyebrow', text: 'Score' }), field(teamName(T), gf, 'am-gf'), h('span', { text: '–' }), field('Opponent', ga, 'am-ga'),
      h('span', { class: 'eyebrow', text: 'Penalties' }), field(teamName(T), pf, 'am-pf'), h('span', { text: '–' }), field('Opponent', pa, 'am-pa')),
    h('p', { class: 'note', style: { margin: '4px 0 10px' }, text: 'Leave the score blank for an upcoming match. Penalties only for a level tie settled by a shootout.' }),
    h('button', { class: 'btn', type: 'submit', text: 'Add match' }),
    dl('am-comps', ['League Cup', 'Scottish Cup', 'Europa League', 'Conference League', 'Champions League', 'Friendly']),
    dl('am-rounds', ['Group stage', 'Round of 16', 'Quarter-final', 'Semi-final', 'Final', 'First round', 'Second round', 'Third round', 'Fourth round', 'Fifth round']),
    dl('am-teams', DB.teams.filter((t) => t.id !== T).map((t) => t.name)));
  const mine = (DB.manual || []).filter((e) => e.team === T).sort((a, b) => a.date.localeCompare(b.date));
  const list = mine.length ? h('div', { class: 'mlist', style: { marginTop: '12px' } }, mine.map((e) => {
    let armed = false;
    const rm = h('button', { class: 'btn ghost', type: 'button', style: { padding: '3px 10px', fontSize: '12.5px' }, text: 'Remove' });
    rm.addEventListener('click', async () => {
      if (!armed) { armed = true; rm.textContent = 'Click to confirm'; return; }
      await removeManual(e.id);
      // Rebuild from the saved log so the match is fully gone
      if (await loadRealData()) { render(); flash('Removed ' + e.opp + ' on ' + fmtDate(e.date) + '.'); }
    });
    return h('div', { class: 'mrow', style: { cursor: 'default', gridTemplateColumns: '1fr auto' } },
      h('span', null, `${fmtDate(e.date)} · ${e.comp}${e.round ? ' ' + e.round : ''} · ${e.venue === 'A' ? '@ ' : 'v '}${e.opp}${e.venue === 'N' ? ' (N)' : ''} · ${e.gf != null ? e.gf + '–' + e.ga + (e.pens ? ` (${e.pens.f}–${e.pens.a} pens)` : '') : 'upcoming'}`), rm);
  })) : null;
  return card('Add a match', `Cup ties and fixtures for ${teamName(T)} that the data sources don’t include · saved in this browser`, form, st,
    list ? h('div', null, h('div', { class: 'eyebrow', style: { marginTop: '14px' }, text: 'Matches you added' }), list) : null);
}
function showDemo() {
  DB = DEMO; cache.clear();
  S.team = 'ABE'; S.cmp = 'CEL'; S.range = 'season'; S.player = null; S.match = null; S.pA = S.pB = null; S.form = null; S.opp = null;
}
// Switch between the synthetic demo season and real data (saved imports or the built-in snapshot)
function sourceSwitch() {
  const rows = [];
  const onReal = DB.source !== 'demo' && DB.source !== 'sample' && !DB.transient;
  if (!onReal && (STORE.meta || SNAP)) rows.push(h('div', { class: 'saved' }, h('div', null, h('b', { text: 'Real data' }), h('div', { class: 'sub', text: STORE.meta ? 'Your saved imports' : `Built-in 2026/27 data to ${fmtDate(SNAP.asOf)}` })),
    h('button', { class: 'btn', type: 'button', text: 'Back to real data', onclick: async () => { if (await loadRealData()) { S.tab = 'overview'; render(); } } })));
  if (SAMPLE && DB.source !== 'sample') rows.push(h('div', { class: 'saved' }, h('div', null, h('b', { text: 'Event data sample' }), h('div', { class: 'sub', text: SAMPLE.label + ' from StatsBomb’s free data: every pass, shot and tackle with its location, and player positions at each loss of the ball.' })),
    h('button', { class: 'btn ghost', type: 'button', text: 'Open the sample', onclick: () => { loadSample(); S.tab = 'press'; render(); } })));
  if (DB.source !== 'demo') rows.push(h('div', { class: 'saved' }, h('div', null, h('b', { text: 'Demo season' }), h('div', { class: 'sub', text: 'Synthetic data with pitch locations, for trying the heatmaps, shot maps and passing networks. Its players are invented.' })),
    h('button', { class: 'btn ghost', type: 'button', text: 'Switch to demo season', onclick: () => { showDemo(); S.tab = 'overview'; render(); } })));
  return rows.length ? h('div', { class: 'stack' }, rows) : null;
}
function savedPanel() {
  const m = STORE.meta;
  const wrap = h('div', { class: 'saved', role: 'status' });
  if (STORE.ok === false) {
    wrap.append(h('p', { class: 'note', style: { margin: 0 }, text: 'This browser is not letting the page save data (for example in a private window), so imports last until you reload.' }));
    return wrap;
  }
  if (!m) {
    wrap.append(h('p', { class: 'note', style: { margin: 0 }, text: 'Imports are saved in this browser and restored the next time you open Touchline Lab. Nothing is uploaded.' }));
    return wrap;
  }
  const when = new Date(m.savedAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const what = [m.label || m.files.join(', ')];
  if (m.fbTables) what.push(`${m.fbTables} FBref table${m.fbTables > 1 ? 's' : ''} (${m.fbTeams.join(', ')})`);
  if (m.layers && m.layers.length) what.push(m.layers.length + ' downloaded file' + (m.layers.length > 1 ? 's' : '') + ' (Sportmonks, cups)');
  if (m.manual) what.push(`${m.manual} match${m.manual > 1 ? 'es' : ''} you added`);
  let armed = false;
  const btn = h('button', { class: 'btn ghost', type: 'button', text: 'Forget saved data' });
  btn.addEventListener('click', async () => {
    if (!armed) { armed = true; btn.textContent = 'Click again to forget it'; return; }
    await forgetSaved();
    if (!loadSnapshot()) showDemo();
    render();
    flash(DB.snapshot ? `Saved data forgotten. Showing the built-in data (to ${fmtDate(DB.snapshot)}).` : 'Saved data forgotten. Showing the demo season.');
  });
  wrap.append(h('div', null, h('b', { text: 'Saved in this browser' }), h('div', { class: 'sub', text: what.join(' + ') + ' · last saved ' + when })), btn);
  return wrap;
}
function viewData(el) {
  const status = h('div', { class: 'status', role: 'status' });
  const input = h('input', { type: 'file', id: 'file', accept: '.json,.csv,application/json,text/csv', multiple: true, hidden: true, onchange: (e) => load(e.target.files) });
  const drop = h('div', { class: 'drop' },
    h('p', { style: { margin: '0 0 10px' } }, 'Drop a football-data.co.uk CSV, the API-Football file from the download script, or StatsBomb event files (one ', h('code', { text: '<match_id>.json' }), ' per match, plus the competition’s ', h('code', { text: 'matches.json' }), ').'),
    h('button', { class: 'btn', type: 'button', onclick: () => input.click(), text: 'Choose files' }), input);
  ['dragenter', 'dragover'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', (e) => load(e.dataTransfer.files));
  async function load(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    status.className = 'status';
    status.textContent = 'Reading ' + files.length + ' file' + (files.length > 1 ? 's' : '') + '…';
    try {
      const texts = await Promise.all(files.map(async (f) => ({ name: f.name, text: await f.text() })));
      importTexts(texts, status);
    } catch (err) {
      status.className = 'status err';
      status.textContent = 'Could not read the files: ' + err.message + '. Check they are a football-data.co.uk CSV, or API-Football or StatsBomb JSON files.';
    }
  }
  const prose = h('div', { class: 'prose' },
    h('p', null, 'The pitch charts in Touchline Lab (heatmaps, shot maps, passing networks, game states) are computed from match events with pitch coordinates. Tables, rankings, line-ups and formations also work from plain match and player stats.'),
    h('h3', { text: 'What you are looking at now' }),
    DB.source === 'demo'
      ? h('p', null, 'A synthetic 12-team season to date (12 rounds, 72 matches, about 1,600 events per match). Club names are real; players, results and every number are generated by a seeded simulation with different style settings per club (pressing height, directness, width, formation). Use it to explore the tools, not to judge real teams.')
      : h('p', null, `${DB.label}: ${DB.matches.length} matches, ${DB.teams.length} teams. Team rankings and player percentiles compare only within these matches.`),
    h('h3', { text: 'Getting real Aberdeen data' }),
    h('ul', null,
      h('li', null, h('b', { text: 'Event data for the Scottish Premiership' }), ' (needed for heatmaps and passing networks) comes from commercial providers such as Hudl StatsBomb, Opta (Stats Perform) and Wyscout. Clubs and media usually license it. If you can get StatsBomb-format exports, drop them in below.'),
      h('li', null, h('b', { text: 'Free practice data: ' }), h('a', { href: 'https://github.com/statsbomb/open-data', target: '_blank', rel: 'noopener', text: 'StatsBomb Open Data' }), ' on GitHub has full event data for selected competitions (World Cups, Euros, some league seasons). The Scottish Premiership is not included, but it is the quickest way to load real matches here and test team comparisons.'),
      h('li', null, h('b', { text: 'This season, free: ' }), 'football-data.co.uk has results, shots, corners, fouls, cards and bookmaker odds for every Scottish Premiership match, updated during the season. See the steps below.'),
      h('li', null, h('b', { text: 'Player stats, line-ups and formations' }), ': use the API-Football download below (free plan: past seasons only). Without event locations, the pitch maps stay empty.')));
  const fdUrl = 'https://www.football-data.co.uk/mmz4281/' + seasonCode() + '/SC0.csv';
  el.append(h('div', { class: 'grid' },
    card('Data source', DB.label + (DB.snapshot ? ` · built-in data to ${fmtDate(DB.snapshot)}` : ''), prose, sourceSwitch()),
    fbrefCard(),
    card('Line-ups and player stats from Sportmonks', 'Free plan: Scottish Premiership, every club, every match', h('div', { class: 'prose' },
      h('ol', null,
        h('li', null, 'Create a free account at ', h('a', { href: 'https://my.sportmonks.com', target: '_blank', rel: 'noopener', text: 'my.sportmonks.com' }), ' and an API token.'),
        h('li', null, 'Install ', h('a', { href: 'https://nodejs.org', target: '_blank', rel: 'noopener', text: 'Node.js' }), ' (18 or newer), download the Touchline Lab repository, and in its folder run:', h('pre', { class: 'cmd', text: 'SPORTMONKS_TOKEN=your_token node tools/fetch-sportmonks.mjs' }), 'On Windows PowerShell: ', h('code', { text: '$env:SPORTMONKS_TOKEN="your_token"' }), ' first, then the node command.'),
        h('li', null, 'Drop the saved ', h('code', { text: 'sportmonks-501-<season>.json' }), ' into the import box, after the season file. Run it again after each round to update.')),
      h('p', null, 'Adds starting line-ups with positions, formations, goals with assists, cards, substitutions and per-player match stats (minutes, touches, passes, key passes, shots, tackles, interceptions, recoveries, duels, dribbles, saves and ratings) for every club. Player stats then follow the match filters, and percentiles compare against the whole league.'),
      h('p', null, 'The free plan covers the Premiership only, not the League Cup or Scottish Cup, and has no xG (football-data.co.uk provides team xG).'))),
    seasonsCard(),
    addMatchCard(),
    card('This season from football-data.co.uk', 'Free, no account or key · results, team stats and odds', h('div', { class: 'prose' },
      h('ol', null,
        h('li', null, 'Download this season’s Scottish Premiership file: ', h('a', { href: fdUrl, target: '_blank', rel: 'noopener', text: fdUrl.replace('https://www.', '') }), '. If the link does not work, go to ', h('a', { href: 'https://www.football-data.co.uk/scotlandm.php', target: '_blank', rel: 'noopener', text: 'football-data.co.uk/scotlandm.php' }), ' and click Premiership for the season you want.'),
        h('li', null, 'Drop the downloaded ', h('code', { text: 'SC0.csv' }), ' into the import box.')),
      h('p', null, 'You get the league table, form, results, xG, shots, shots on target, corners, fouls and cards per match, plus pre-match odds. The app turns the odds into expected points, so you can see which teams are doing better or worse than the market expected.'),
      h('p', null, 'There are no player stats or line-ups in this file, and older seasons have no xG. The site keeps it updated through the season, so download it again for the latest results.'))),
    card('Import data', 'football-data.co.uk, API-Football or StatsBomb files · they stay in your browser, nothing is uploaded', drop, status, savedPanel(),
      h('p', { class: 'note' }, 'StatsBomb: the quickest route is ', h('code', { text: 'node tools/fetch-statsbomb.mjs --list' }), ' then ', h('code', { text: 'node tools/fetch-statsbomb.mjs --competition 55 --season 282' }), ' (Euro 2024), which saves one file with every event and the 360 player positions; drop it here. Raw files from the open-data repository also work: events from data/events/, 360 files from data/three-sixty/ and data/matches/<competition_id>/<season_id>.json. Event data is shown for the visit and not saved, so your saved season stays.')),
    card('Cup matches from API-Football', 'League Cup and Scottish Cup with the same detail as league matches · paid plan for the current season', h('div', { class: 'prose' },
      h('ol', null,
        h('li', null, 'On your own computer (API-Football flags downloads from shared cloud servers), with Node.js 18+ and the Touchline Lab repository, run:', h('pre', { class: 'cmd', text: 'API_FOOTBALL_KEY=your_key node tools/fetch-api-football.mjs --league 185 --season 2026' }), '185 is the Scottish League Cup and 181 the Scottish Cup; the season is the starting year (2026 = 2026/27).'),
        h('li', null, 'Drop the saved ', h('code', { text: 'api-football-185-2026.json' }), ' into the import box. It is added to the season on screen and saved with your other imports.')),
      h('p', null, 'Each tie comes in with line-ups and formations, goals, cards and substitutions, team stats and player stats. Team and player numbers, Key players and the match list then follow the Competition filter at the top (All competitions, League only, Cups only); the league table always stays league only.'))),
    card('Real Aberdeen data from API-Football', 'Free plan: seasons 2022/23 to 2024/25, about 95 matches a day', h('div', { class: 'prose' },
      h('ol', null,
        h('li', null, 'Get a free key at ', h('a', { href: 'https://dashboard.api-football.com', target: '_blank', rel: 'noopener', text: 'dashboard.api-football.com' }), '.'),
        h('li', null, 'Install ', h('a', { href: 'https://nodejs.org', target: '_blank', rel: 'noopener', text: 'Node.js' }), ' (version 18 or newer), download the Touchline Lab repository, and in its folder run:', h('pre', { class: 'cmd', text: 'API_FOOTBALL_KEY=your_key node tools/fetch-api-football.mjs --season 2024' }), 'On Windows PowerShell: ', h('code', { text: '$env:API_FOOTBALL_KEY="your_key"' }), ' first, then the node command.'),
        h('li', null, 'Drop the saved ', h('code', { text: 'api-football-179-2024.json' }), ' into the import box. Season years are the starting year, so 2024 means 2024/25. League 179 is the Scottish Premiership; ', h('code', { text: '--find "Premiership"' }), ' lists others.')),
      h('p', null, 'You get results, league table, line-ups and formations, team match stats (shots, possession, passing, corners, cards, and xG where the feed has it) and player stats with ratings. Heatmaps, passing networks and game states still need event data with pitch locations.'),
      h('p', null, 'The free plan fetches one match per request, so a full 228-match season takes about three days. Run the same command once a day: Aberdeen\u2019s matches come first, finished matches are kept, and the league table is complete from day one. Paid plans cover the current season and fetch it in one go.')))));
}

function seasonsCard() {
  const all = allSeasons();
  const prev = seasonCode(new Date(Date.now() - 365 * 864e5));
  const url = 'https://www.football-data.co.uk/mmz4281/' + prev + '/SC0.csv';
  const list = all.length > 1 ? h('div', { class: 'mlist', style: { marginTop: '10px' } }, all.map((x) => {
    const e = x.entry, rm = e && e.saved ? h('button', { class: 'btn ghost', type: 'button', style: { padding: '3px 10px', fontSize: '12.5px' }, text: 'Remove' }) : null;
    if (rm) { let armed = false; rm.addEventListener('click', async () => { if (!armed) { armed = true; rm.textContent = 'Click to confirm'; return; } await pastRemove(x.season); delete SEASON_DB[x.season]; await refreshSeasons(); if (DB.pastSeason && DB.season === x.season) await loadRealData(); render(); flash('Removed your saved files for ' + x.season + '.'); }); }
    const what = x.current ? 'current season' : (e.src === 'built-in' ? 'built in' : 'saved in this browser') + ' · results and team stats' + (e.layers.length ? ' + line-ups and player stats' : '');
    return h('div', { class: 'mrow', style: { cursor: 'default', gridTemplateColumns: 'auto 1fr auto auto' } }, h('b', { text: x.season }), h('span', { class: 'sub', text: what }),
      h('button', { class: 'btn ghost', type: 'button', style: { padding: '3px 10px', fontSize: '12.5px' }, text: DB.season === x.season ? 'Showing' : 'Open', disabled: DB.season === x.season, onclick: () => { if (loadSeason(x.season)) { S.tab = 'overview'; render(); } } }), rm || h('span'));
  })) : null;
  return card('Seasons', 'Earlier seasons to compare with this one · pick one with Season at the top of the page', h('div', { class: 'prose' },
    h('ol', null,
      h('li', null, 'Download a past season’s file from football-data.co.uk, e.g. ', h('a', { href: url, target: '_blank', rel: 'noopener', text: url.replace('https://www.', '') }), ' (the folder is the two season years: 2425 = 2024/25), and drop it into the import box. It is added as a past season; this season’s data stays as it is.'),
      h('li', null, 'For line-ups and player stats in that season, run ', h('code', { text: 'node tools/fetch-sportmonks.mjs --list-seasons' }), ' for the season ids, then ', h('code', { text: 'SPORTMONKS_TOKEN=… node tools/fetch-sportmonks.mjs --season <id>' }), ', and drop the saved file in.')),
    h('p', null, 'The Seasons tab then compares them: positions, points, goals and shots by season, a points race against earlier seasons, and players’ numbers season by season.')), list);
}

/* ---------- Boot ---------- */
function boot() {
  buildShell();
  const loading = h('p', { class: 'empty', text: 'Generating demo season…' });
  mainEl.append(loading);
  setTimeout(async () => {
    DEMO = DB = prepareDB(buildDemo());
    const hash = (location.hash || '').slice(1);
    if (TABS.some(([k]) => k === hash)) S.tab = hash;
    // Bring back the last imported season (and FBref tables) saved in this browser
    loading.textContent = 'Loading your saved data…';
    const restored = await restoreSaved();
    if (!(restored && restored.ok)) loadSnapshot(); // no saved imports: open on the built-in real data, if this build has it
    await refreshSeasons();
    render();
    if (restored && restored.error) flash(restored.error, 'err');
    else if (restored && STORE.meta) flash(`Restored your saved data: ${STORE.meta.label || STORE.meta.files.join(', ')}${STORE.meta.fbTables ? ` + ${STORE.meta.fbTables} FBref table${STORE.meta.fbTables > 1 ? 's' : ''}` : ''}. Manage it in the Data tab.`);
  }, 20);
  let rt, lastW = window.innerWidth;
  window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => { if (DB && Math.abs(window.innerWidth - lastW) > 40) { lastW = window.innerWidth; const y = window.scrollY; render(); window.scrollTo(0, y); } }, 250); });
  const rerender = () => DB && render();
  try { matchMedia('(prefers-color-scheme: dark)').addEventListener('change', rerender); } catch (e) {}
  new MutationObserver(rerender).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
}
boot();
