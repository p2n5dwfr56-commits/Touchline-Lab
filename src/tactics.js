'use strict';
/* =====================================================================
   Tactics tab: formation usage, tactical line-up board, shape numbers
   ===================================================================== */

// Fallback pitch positions by role, for imported formations without a template.
const ROLE_POS = {
  GK: [6, 40], RB: [36, 70], LB: [36, 10], RCB: [26, 54], LCB: [26, 26], CB: [22, 40], RWB: [56, 74], LWB: [56, 6],
  DM: [46, 40], RDM: [48, 50], LDM: [48, 30], CM: [58, 40], RCM: [58, 52], LCM: [58, 28], RM: [64, 70], LM: [64, 10],
  AM: [76, 40], RAM: [80, 54], LAM: [80, 26], RW: [82, 68], LW: [82, 12], ST: [94, 40], RS: [90, 48], LS: [90, 32],
};
const SHAPE_MODES = [['plan', 'Formation'], ['in', 'With the ball'], ['out', 'Without the ball'], ['shift', 'Shift']];

function formRows(form, n) {
  // Rows of outfield players, back to front, as slot indexes into an 11-player line-up (GK = 0).
  const parts = String(form || '').split('-').map(Number).filter((x) => x > 0);
  if (parts.reduce((s, x) => s + x, 0) !== n - 1) return null;
  const rows = [];
  let i = 1;
  parts.forEach((c) => { rows.push(Array.from({ length: c }, (_, k) => i + k)); i += c; });
  return rows;
}
function slotTemplate(form, role, idx) {
  const f = FORMATIONS[form];
  if (f && f[idx] && f[idx][0] === role) return [f[idx][1], f[idx][2]];
  return ROLE_POS[role] || [60, 40];
}

/* Average positions of players for one team over a set of matches. */
function avgPositions(matches, T) {
  const acc = {};
  const add = (pid, kind, x, y) => {
    const a = (acc[pid] = acc[pid] || { in: [0, 0, 0], out: [0, 0, 0] })[kind];
    a[0] += x; a[1] += y; a[2]++;
  };
  matches.forEach((m) => m.events.forEach((e) => {
    if (e.team !== T || !e.pl) return;
    if (e.type === 'pass' || e.type === 'carry' || e.type === 'dribble' || e.type === 'shot') add(e.pl, 'in', e.x, e.y);
    else if (e.type in DEF_TYPES || e.type === 'duel') add(e.pl, 'out', e.x, e.y);
    if (e.type === 'pass' && e.ok && e.rc) add(e.rc, 'in', e.ex, e.ey);
  }));
  const out = {};
  Object.entries(acc).forEach(([pid, a]) => {
    out[pid] = {
      in: a.in[2] ? [a.in[0] / a.in[2], a.in[1] / a.in[2]] : null, nIn: a.in[2],
      out: a.out[2] ? [a.out[0] / a.out[2], a.out[1] / a.out[2]] : null, nOut: a.out[2],
    };
  });
  return out;
}

/* Per-match shape numbers for a team, from its starting XI. */
function shapeStats(m, T) {
  return memo('shape|' + m.id + '|' + T, () => {
    const lu = m.lineups[T] || [];
    const pos = avgPositions([m], T);
    const grp = (pid) => (DB.players[pid] ? DB.players[pid].group : 'MID');
    const mean = (arr) => (arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : null);
    const pick = (g, kind, min) => lu.filter((l) => grp(l.pid) === g && pos[l.pid] && pos[l.pid][kind] && pos[l.pid][kind === 'in' ? 'nIn' : 'nOut'] >= min).map((l) => pos[l.pid][kind]);
    const defIn = pick('DEF', 'in', 5), defOut = pick('DEF', 'out', 2);
    let attIn = pick('FWD', 'in', 5);
    if (!attIn.length) attIn = pick('MID', 'in', 5);
    const outfield = lu.filter((l) => grp(l.pid) !== 'GK' && pos[l.pid] && pos[l.pid].in && pos[l.pid].nIn >= 5).map((l) => pos[l.pid].in[1]);
    const lineIn = mean(defIn.map((p) => p[0])), lineOut = mean(defOut.map((p) => p[0])), att = mean(attIn.map((p) => p[0]));
    return {
      lineIn, lineOut,
      length: lineIn != null && att != null ? att - lineIn : null,
      width: outfield.length >= 4 ? Math.max(...outfield) - Math.min(...outfield) : null,
    };
  });
}
const SHAPE_METRICS = [
  { k: 'lineIn', l: 'Back-line height with the ball', u: 'yd', tip: 'Average distance from own goal of the starting defenders’ on-ball actions.' },
  { k: 'lineOut', l: 'Back-line height without the ball', u: 'yd', tip: 'Average distance from own goal of the starting defenders’ tackles, interceptions, recoveries and duels.' },
  { k: 'length', l: 'Team length with the ball', u: 'yd', tip: 'Gap between the average positions of the back line and the most advanced line. Smaller means more compact.' },
  { k: 'width', l: 'Team width with the ball', u: 'yd', tip: 'Distance between the widest outfield players’ average positions.' },
];
function shapeAgg(matches, T) {
  const out = {};
  SHAPE_METRICS.forEach((mt) => {
    const vals = matches.map((m) => shapeStats(m, T)[mt.k]).filter((v) => v != null);
    out[mt.k] = vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null;
  });
  return out;
}

/* Choose the XI and formation to show on the board. */
function boardSelection(T, ms) {
  const forms = {};
  ms.forEach((m) => { const f = m.forms[T] || '?'; (forms[f] = forms[f] || []).push(m); });
  const used = Object.entries(forms).sort((a, b) => b[1].length - a[1].length);
  if (!used.length) return null;
  let form = S.form && forms[S.form] ? S.form : used[0][0];
  const fms = forms[form];
  // For each slot, the player with most starts there; keep the role from the most common one.
  const n = Math.max(...fms.map((m) => (m.lineups[T] || []).length));
  const slots = [];
  const taken = new Set();
  for (let i = 0; i < n; i++) {
    const cnt = {}, roles = {};
    fms.forEach((m) => { const l = (m.lineups[T] || [])[i]; if (l) { cnt[l.pid] = (cnt[l.pid] || 0) + 1; roles[l.role] = (roles[l.role] || 0) + 1; } });
    const ranked = Object.entries(cnt).sort((a, b) => b[1] - a[1]);
    const main = ranked.find(([pid]) => !taken.has(pid)) || ranked[0];
    if (!main) continue;
    taken.add(main[0]);
    const role = Object.entries(roles).sort((a, b) => b[1] - a[1])[0][0];
    slots.push({ i, pid: main[0], role, starts: main[1], others: ranked.filter(([pid]) => pid !== main[0]) });
  }
  return { form, used, matches: fms, slots };
}

function tacticalBoard(sel, T, mode, color) {
  const p = pitch();
  const pos = avgPositions(sel.matches, T);
  const surf = css('--surface'), ink2 = css('--ink-2'), muted = css('--muted');
  const at = (s, kind) => {
    if (kind === 'plan') return slotTemplate(sel.form, s.role, s.i);
    const q = pos[s.pid];
    return q && q[kind] ? q[kind] : slotTemplate(sel.form, s.role, s.i);
  };
  const rows = formRows(sel.form, sel.slots.length);
  const drawUnits = (kind, opacity, dash) => {
    if (!rows) return;
    rows.forEach((r) => {
      const pts = r.map((i) => sel.slots.find((s) => s.i === i)).filter(Boolean).map((s) => at(s, kind)).sort((a, b) => a[1] - b[1]);
      if (pts.length < 2) return;
      p.marks.append(sv('polyline', { points: pts.map((q) => q[0].toFixed(1) + ',' + q[1].toFixed(1)).join(' '), fill: 'none', stroke: ink2, 'stroke-opacity': opacity, 'stroke-width': 0.5, 'stroke-dasharray': dash || null, 'stroke-linejoin': 'round' }));
    });
  };
  // Back-line guide for the measured views
  if (mode !== 'plan') {
    const kind = mode === 'shift' ? 'in' : mode;
    const defs = sel.slots.filter((s) => DB.players[s.pid] && DB.players[s.pid].group === 'DEF').map((s) => at(s, kind)[0]);
    if (defs.length) {
      const x = defs.reduce((s, v) => s + v, 0) / defs.length;
      p.heat.append(sv('line', { x1: x, x2: x, y1: 0, y2: 80, stroke: color, 'stroke-width': 0.4, 'stroke-dasharray': '1.2 1', 'stroke-opacity': 0.8 }));
      p.heat.append(sv('text', { x: x + 1, y: 3.2, class: 'dir', fill: muted, text: 'Back line ' + x.toFixed(0) + ' yd' }));
    }
  }
  if (mode === 'shift') {
    drawUnits('out', 0.35, '1 1');
    drawUnits('in', 0.6);
    sel.slots.forEach((s) => {
      const a = at(s, 'out'), b = at(s, 'in');
      p.marks.append(sv('line', { x1: a[0], y1: a[1], x2: b[0], y2: b[1], stroke: color, 'stroke-width': 0.45, 'stroke-opacity': 0.7 }));
      p.marks.append(sv('circle', { cx: a[0], cy: a[1], r: 1.6, fill: surf, stroke: color, 'stroke-width': 0.45 }));
    });
  } else drawUnits(mode, 0.55);
  sel.slots.forEach((s) => {
    const pl = DB.players[s.pid];
    if (!pl) return;
    const [x, y] = at(s, mode === 'shift' ? 'in' : mode);
    const g = sv('g', { tabindex: 0 });
    g.append(sv('circle', { cx: x, cy: y, r: 3.4, fill: color, stroke: surf, 'stroke-width': 0.5 }));
    g.append(sv('text', { x, y: y + 1.1, 'text-anchor': 'middle', 'font-size': 3, 'font-weight': 700, fill: '#fff', style: 'font-family: var(--font-display)', text: pl.num != null ? pl.num : s.role }));
    g.append(sv('text', { x, y: y + 6.3, 'text-anchor': 'middle', 'font-size': 2.5, 'font-weight': 600, fill: css('--ink'), text: pl.name.split(' ').pop() }));
    if (mode === 'plan') g.append(sv('text', { x, y: y - 4.4, 'text-anchor': 'middle', 'font-size': 2.1, fill: muted, text: s.role }));
    const q = pos[s.pid];
    hover(g, () => [
      { v: pl.name, strong: true },
      { v: s.role + ' · ' + s.starts + (s.starts === 1 ? ' start' : ' starts') + ' in this slot' },
      q && q.in ? { v: 'With the ball: ' + q.in[0].toFixed(0) + ' yd from own goal (' + q.nIn + ' actions)' } : null,
      q && q.out ? { v: 'Without the ball: ' + q.out[0].toFixed(0) + ' yd (' + q.nOut + ' actions)' } : null,
    ].filter(Boolean));
    p.marks.append(g);
  });
  p.svg.setAttribute('aria-label', 'Tactical line-up, ' + sel.form);
  return p.svg;
}

function lineupList(sel, T, single) {
  const rows = formRows(sel.form, sel.slots.length);
  const order = rows ? [[0]].concat(rows).reverse() : [sel.slots.map((s) => s.i)];
  const minutes = {};
  sel.matches.forEach((m) => Object.entries(m.minutes).forEach(([pid, mn]) => (minutes[pid] = (minutes[pid] || 0) + mn)));
  const list = h('div', { class: 'xi' });
  order.forEach((r) => {
    const unit = h('div', { class: 'xi-unit' });
    r.map((i) => sel.slots.find((s) => s.i === i)).filter(Boolean).sort((a, b) => slotTemplate(sel.form, a.role, a.i)[1] - slotTemplate(sel.form, b.role, b.i)[1]).forEach((s) => {
      const pl = DB.players[s.pid];
      if (!pl) return;
      const alt = s.others.slice(0, 2).map(([pid, c]) => DB.players[pid].name.split(' ').pop() + ' ' + c).join(', ');
      unit.append(h('div', { class: 'xi-row' },
        h('span', { class: 'badge', text: s.role }),
        h('span', { class: 'xi-name' }, h('a', { href: '#players', onclick: (e) => { e.preventDefault(); S.tab = 'players'; S.player = pl.id; render(); window.scrollTo({ top: 0 }); }, text: pl.name }),
          h('small', { text: single ? (minutes[pl.id] || 0) + ' min' : s.starts + ' of ' + sel.matches.length + ' starts' + (alt ? ' · also ' + alt : '') }))));
    });
    list.append(unit);
  });
  // Substitutions
  const subs = [];
  sel.matches.forEach((m) => (m.subs[T] || []).forEach((sb) => subs.push(sb)));
  if (single && subs.length) {
    list.append(h('div', { class: 'eyebrow', style: { marginTop: '10px' }, text: 'Substitutions' }),
      h('ul', { class: 'subs' }, subs.map((sb) => h('li', null, h('b', { text: sb.min + "'" }), ' ', DB.players[sb.on] ? DB.players[sb.on].name : '?', h('span', { class: 'sub', text: ' for ' + (DB.players[sb.off] ? DB.players[sb.off].name : '?') })))));
  } else if (subs.length) {
    const first = sel.matches.map((m) => Math.min(...(m.subs[T] || []).map((s) => s.min))).filter(isFinite);
    list.append(h('p', { class: 'note', text: `${(subs.length / sel.matches.length).toFixed(1)} substitutions per match · first change on average at ${Math.round(first.reduce((s, v) => s + v, 0) / (first.length || 1))}'` }));
  }
  return list;
}

function viewTactics(el) {
  if (!DB.hasLineups) return missingNote('Tactics', 'Line-ups and formations', el);
  const T = S.team, ms = scoped(T).filter((m) => (m.lineups[S.team] || []).length), A = css('--team-a');
  const single = S.range.startsWith('m:') && ms.length === 1;
  const sel = boardSelection(T, ms);
  el.append(h('div', { class: 'hero' }, h('h1', { text: teamName(T) }), h('div', { class: 'meta' }, h('span', { text: rangeLabel() + ' · ' + ms.length + (ms.length === 1 ? ' match' : ' matches') }))));
  if (!sel) { el.append(h('p', { class: 'empty', text: 'No line-up data for this selection.' })); return; }
  const grid = h('div', { class: 'grid' });
  el.append(grid);

  // Tactical line-up board
  const formTools = sel.used.length > 1 && !single
    ? seg(sel.used.map(([f, list]) => [f, f + ' (' + list.length + ')']), sel.form, (v) => { S.form = v; render(); }, 'Formation') : null;
  if (!DB.hasEvents) S.shape = 'plan';
  const modeTools = DB.hasEvents ? seg(SHAPE_MODES, S.shape, (v) => { S.shape = v; render(); }, 'Shape view') : null;
  const caption = {
    plan: 'Listed formation with the usual player in each slot',
    in: 'Average position of each player’s on-ball actions and passes received',
    out: 'Average position of each player’s defensive actions',
    shift: 'Hollow = without the ball, solid = with the ball',
  }[S.shape];
  const boardCard = card({ title: 'Tactical line-up · ' + sel.form, span: true, tools: h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } }, formTools, modeTools) },
    (single ? 'Starting XI' : `Most-used XI in ${sel.form} (${sel.matches.length} of ${ms.length} matches)`) + ' · ' + caption + ' · attacking left to right');
  boardCard.append(h('div', { class: 'board' }, h('div', { class: 'board-pitch' }, tacticalBoard(sel, T, S.shape, A),
    S.shape === 'out' ? h('p', { class: 'note', text: 'Defensive positions come from tackles, interceptions, recoveries and duels, so a single match gives only a rough picture.' }) : null),
  lineupList(sel, T, single)));
  grid.append(boardCard);

  // Formations used
  const all = boardSelection(T, ms);
  const ft = h('table', null,
    h('thead', null, h('tr', null, ['Formation', 'Played', 'W', 'D', 'L', 'Pts/G', 'xG', 'xGA', 'Poss'].map((c, i) => h('th', { class: i ? '' : 'l', text: c })))),
    h('tbody', null, all.used.map(([f, list]) => {
      const a = aggTeam(list, T);
      return h('tr', { class: f === sel.form ? 'focus' : '', onclick: () => { S.form = f; render(); }, title: 'Show ' + f + ' on the board' },
        h('td', { class: 'l', text: f }), h('td', { text: list.length }), h('td', { text: a.w }), h('td', { text: a.d }), h('td', { text: a.l }),
        h('td', { text: (a.pts / a.n).toFixed(2) }), h('td', { text: fmt(a.xg / a.n, 2) }), h('td', { text: fmt(a.xga / a.n, 2) }), h('td', { text: has(TM.poss.f(a)) ? TM.poss.f(a).toFixed(0) + '%' : '–' }));
    })));
  grid.append(card('Formations used', 'Per-match averages in each starting formation · click a row to show it', h('div', { class: 'tbl-wrap' }, ft)));

  // Shape numbers vs league (need pitch locations)
  if (!DB.hasEvents) { grid.append(againstShape(T, ms)); return; }
  const mine = shapeAgg(ms, T);
  const league = leagueAggs().map((r) => ({ id: r.team.id, s: shapeAgg(scoped(r.team.id, leagueRange()), r.team.id) }));
  grid.append(card('Shape numbers', 'Measured from starting XIs · bar scaled from league lowest to highest', hbars(SHAPE_METRICS.map((mt) => {
    const vals = league.map((r) => r.s[mt.k]).filter((v) => v != null);
    const lo = Math.min(...vals), hi = Math.max(...vals), v = mine[mt.k];
    const rank = vals.filter((x) => x > (v == null ? -Infinity : v)).length + 1;
    return {
      label: mt.l, value: v == null ? 0 : v - lo + (hi - lo) * 0.08, max: (hi - lo) * 1.08 || 1, color: css('--c1'),
      text: v == null ? '–' : v.toFixed(1) + ' yd',
      tip: () => [{ v: v == null ? 'Not enough data' : v.toFixed(1) + ' yd', strong: true }, { v: mt.l }, { v: ordinal(rank) + ' highest of ' + vals.length + ' · league ' + lo.toFixed(1) + '–' + hi.toFixed(1) }, { v: mt.tip }],
    };
  })), h('p', { class: 'note', text: 'These describe style rather than quality: a high line and a short team suit pressing sides, a deep line suits counter-attacking ones.' })));

  grid.append(againstShape(T, ms));
}
function againstShape(T, ms) {
  const fam = (f) => { const d = String(f || '').split('-')[0]; return d === '3' ? 'Back three' : d === '4' ? 'Back four' : d === '5' ? 'Back five' : 'Other'; };
  const byFam = {};
  ms.forEach((m) => { const k = fam(m.forms[oppOf(m, T)]); (byFam[k] = byFam[k] || []).push(m); });
  const famRows = Object.entries(byFam).sort((a, b) => b[1].length - a[1].length);
  return card('Against each shape', 'Results by the opponent’s starting back line', h('div', { class: 'tbl-wrap' }, h('table', null,
    h('thead', null, h('tr', null, ['Opponent', 'Played', 'W', 'D', 'L', 'Pts/G', 'xG', 'xGA', 'Formations faced'].map((c, i) => h('th', { class: i === 0 || i === 8 ? 'l' : '', text: c })))),
    h('tbody', null, famRows.map(([k, list]) => {
      const a = aggTeam(list, T);
      const faced = {};
      list.forEach((m) => { const f = m.forms[oppOf(m, T)] || '?'; faced[f] = (faced[f] || 0) + 1; });
      return h('tr', { style: { cursor: 'default' } }, h('td', { class: 'l', text: k }), h('td', { text: list.length }), h('td', { text: a.w }), h('td', { text: a.d }), h('td', { text: a.l }),
        h('td', { text: (a.pts / a.n).toFixed(2) }), h('td', { text: fmt(a.xg / a.n, 2) }), h('td', { text: fmt(a.xga / a.n, 2) }),
        h('td', { class: 'l sub', text: Object.entries(faced).sort((x, y) => y[1] - x[1]).map(([f, c]) => f + ' ×' + c).join(', ') }));
    })))));
}
