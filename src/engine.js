'use strict';
/* =====================================================================
   Touchline Lab engine
   - One event model for every source (StatsBomb-style: 120 x 80 yards,
     each team's events in its own frame, attacking left -> right).
   - Demo season generator (synthetic, seeded) and StatsBomb JSON import.
   - Metrics: team & player aggregates, possession phases, densities.
   ===================================================================== */

const PL = 120, PW = 80;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function gauss(r) {
  let u = 0, v = 0;
  while (!u) u = r();
  while (!v) v = r();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/* ---------- Formations: in-possession base positions (team frame) ---------- */
const FORMATIONS = {
  '4-2-3-1': [['GK', 6, 40], ['RB', 36, 70], ['RCB', 26, 52], ['LCB', 26, 28], ['LB', 36, 10], ['RDM', 48, 48], ['LDM', 48, 32], ['RW', 78, 68], ['AM', 76, 40], ['LW', 78, 12], ['ST', 94, 40]],
  '4-3-3': [['GK', 6, 40], ['RB', 38, 70], ['RCB', 26, 52], ['LCB', 26, 28], ['LB', 38, 10], ['DM', 46, 40], ['RCM', 62, 54], ['LCM', 62, 26], ['RW', 86, 70], ['LW', 86, 10], ['ST', 96, 40]],
  '4-4-2': [['GK', 6, 40], ['RB', 34, 70], ['RCB', 24, 52], ['LCB', 24, 28], ['LB', 34, 10], ['RM', 62, 70], ['RCM', 52, 48], ['LCM', 52, 32], ['LM', 62, 10], ['RS', 90, 48], ['LS', 90, 32]],
  '3-5-2': [['GK', 6, 40], ['RCB', 26, 60], ['CB', 22, 40], ['LCB', 26, 20], ['RWB', 58, 74], ['RCM', 56, 52], ['DM', 46, 40], ['LCM', 56, 28], ['LWB', 58, 6], ['RS', 90, 48], ['LS', 90, 32]],
  '3-4-2-1': [['GK', 6, 40], ['RCB', 26, 60], ['CB', 22, 40], ['LCB', 26, 20], ['RWB', 60, 74], ['RCM', 50, 48], ['LCM', 50, 32], ['LWB', 60, 6], ['RAM', 80, 54], ['LAM', 80, 26], ['ST', 96, 40]],
  '3-4-3': [['GK', 6, 40], ['RCB', 26, 60], ['CB', 22, 40], ['LCB', 26, 20], ['RWB', 56, 74], ['RCM', 50, 48], ['LCM', 50, 32], ['LWB', 56, 6], ['RW', 84, 64], ['ST', 96, 40], ['LW', 84, 16]],
  '4-1-4-1': [['GK', 6, 40], ['RB', 36, 70], ['RCB', 26, 52], ['LCB', 26, 28], ['LB', 36, 10], ['DM', 44, 40], ['RM', 70, 70], ['RCM', 62, 50], ['LCM', 62, 30], ['LM', 70, 10], ['ST', 94, 40]],
};
const ROLE_GROUP = {
  GK: 'GK', RB: 'DEF', LB: 'DEF', RCB: 'DEF', LCB: 'DEF', CB: 'DEF', RWB: 'DEF', LWB: 'DEF',
  DM: 'MID', RDM: 'MID', LDM: 'MID', RCM: 'MID', LCM: 'MID', CM: 'MID', AM: 'MID', RM: 'MID', LM: 'MID', RAM: 'MID', LAM: 'MID',
  RW: 'FWD', LW: 'FWD', ST: 'FWD', RS: 'FWD', LS: 'FWD',
};
const GROUP_NAME = { GK: 'Goalkeeper', DEF: 'Defender', MID: 'Midfielder', FWD: 'Forward' };

/* ---------- Demo league (synthetic style profiles, not real ratings) ---------- */
const DEMO_TEAMS = [
  { id: 'ABE', name: 'Aberdeen', q: 0.62, dir: 0.45, press: 0.56, width: 0.62, form: '4-2-3-1', alt: '3-4-2-1' },
  { id: 'CEL', name: 'Celtic', q: 0.9, dir: 0.16, press: 0.82, width: 0.7, form: '4-3-3' },
  { id: 'RAN', name: 'Rangers', q: 0.82, dir: 0.28, press: 0.74, width: 0.66, form: '4-2-3-1', alt: '4-3-3' },
  { id: 'HEA', name: 'Hearts', q: 0.68, dir: 0.4, press: 0.62, width: 0.55, form: '3-4-2-1' },
  { id: 'HIB', name: 'Hibernian', q: 0.6, dir: 0.46, press: 0.55, width: 0.6, form: '3-5-2', alt: '4-4-2' },
  { id: 'MOT', name: 'Motherwell', q: 0.56, dir: 0.26, press: 0.63, width: 0.58, form: '4-3-3' },
  { id: 'DUN', name: 'Dundee United', q: 0.55, dir: 0.56, press: 0.5, width: 0.52, form: '3-5-2' },
  { id: 'STM', name: 'St Mirren', q: 0.5, dir: 0.56, press: 0.48, width: 0.6, form: '3-4-3', alt: '3-5-2' },
  { id: 'KIL', name: 'Kilmarnock', q: 0.48, dir: 0.68, press: 0.45, width: 0.64, form: '4-4-2' },
  { id: 'FAL', name: 'Falkirk', q: 0.47, dir: 0.38, press: 0.52, width: 0.56, form: '4-1-4-1' },
  { id: 'DND', name: 'Dundee', q: 0.44, dir: 0.55, press: 0.42, width: 0.5, form: '4-4-2', alt: '4-1-4-1' },
  { id: 'LIV', name: 'Livingston', q: 0.42, dir: 0.72, press: 0.45, width: 0.62, form: '4-4-2' },
];
const FIRST = ['Callum', 'Lewis', 'Ross', 'Jamie', 'Euan', 'Connor', 'Kieran', 'Fraser', 'Ryan', 'Scott', 'Liam', 'Aaron', 'Owen', 'Jack', 'Finlay', 'Cameron', 'Murray', 'Dylan', 'Ethan', 'Logan', 'Rory', 'Blair', 'Alfie', 'Mateo', 'Jonas', 'Kofi', 'Luca', 'Niko', 'Tomas', 'Yusuf', 'Andre', 'Emil', 'Rhys', 'Calvin', 'Declan', 'Hamish', 'Ewan', 'Marcus', 'Sami', 'Oskar', 'Theo', 'Adam'];
const LAST = ['MacLeod', 'Ferguson', 'Murray', 'Cairns', 'Duthie', 'Strachan', 'Gillespie', 'Moffat', 'Rennie', 'Baird', 'Lennox', 'Kerr', 'Crawford', 'Shand', 'Forbes', 'Urquhart', 'Gordon', 'Munro', 'Robertson', 'Tait', 'Ritchie', 'Hendry', 'Petrie', 'McKenzie', 'Dalgleish', 'Ogilvie', 'Fyfe', 'Wallace', 'Buchan', 'Innes', 'Sutherland', 'Grant', 'Mensah', 'Okafor', 'Lindqvist', 'Haugen', 'Novak', 'Rossi', 'Moreau', 'Silva', 'Kowalski', 'Jansen', 'Varga', 'Brennan', 'Doyle', 'Keane', 'Byrne', 'Hughes', 'Price', 'Lloyd', 'Sinclair', 'Ross', 'Bell', 'Stewart', 'Paterson', 'Mair', 'Christie', 'Allan'];

function xgOf(x, y, head) {
  const dx = Math.max(0.5, PL - x), dy = Math.abs(y - 40);
  const d = Math.hypot(dx, dy);
  let a = Math.atan2(8 * dx, dx * dx + dy * dy - 16);
  if (a < 0) a += Math.PI;
  let lg = -1.55 + 1.7 * a - 0.085 * d;
  if (head) lg -= 0.9;
  return clamp(1 / (1 + Math.exp(-lg)), 0.01, 0.92);
}

function buildDemo(seed = 20262027) {
  const R = mulberry32(seed);
  const teams = DEMO_TEAMS.map((t) => ({ id: t.id, name: t.name, style: t }));
  const players = {};
  const squads = {};
  const used = new Set();
  let pid = 0;
  const pick = (a) => a[Math.floor(R() * a.length)];
  const newName = () => { for (;;) { const n = pick(FIRST) + ' ' + pick(LAST); if (!used.has(n)) { used.add(n); return n; } } };

  for (const t of DEMO_TEAMS) {
    const sq = [];
    const nums = new Set([1]);
    const num = () => { for (;;) { const n = 2 + Math.floor(R() * 34); if (!nums.has(n)) { nums.add(n); return n; } } };
    const mk = (group, role, rank) => {
      const p = {
        id: 'p' + pid++, team: t.id, name: newName(), num: group === 'GK' && rank === 0 ? 1 : num(), group, role, rank,
        q: clamp(t.q + gauss(R) * 0.06 - rank * 0.04, 0.2, 0.98),
        fin: clamp(0.5 + gauss(R) * 0.18 + (group === 'FWD' ? 0.15 : 0), 0, 1),
        dri: clamp(0.4 + gauss(R) * 0.18 + (group === 'FWD' ? 0.15 : group === 'MID' ? 0.05 : -0.1), 0, 1),
      };
      players[p.id] = p;
      sq.push(p);
    };
    FORMATIONS[t.form].forEach((s) => mk(ROLE_GROUP[s[0]], s[0], 0));
    mk('GK', 'GK', 1);
    ['DEF', 'DEF', 'DEF', 'MID', 'MID', 'MID', 'FWD', 'FWD', 'MID'].forEach((g, i) => mk(g, null, i < 6 ? 1 : 2));
    squads[t.id] = sq;
  }

  // Double round robin (circle method); play the first 12 rounds to date.
  const ids = DEMO_TEAMS.map((t) => t.id);
  const n = ids.length;
  const rounds = [];
  const arr = ids.slice();
  for (let r = 0; r < n - 1; r++) {
    const pairs = [];
    for (let i = 0; i < n / 2; i++) {
      const a = arr[i], b = arr[n - 1 - i];
      pairs.push(r % 2 === 0 ? [a, b] : [b, a]);
    }
    rounds.push(pairs);
    arr.splice(1, 0, arr.pop());
  }
  const all = rounds.concat(rounds.map((rd) => rd.map(([a, b]) => [b, a])));
  const ROUNDS_PLAYED = 12;
  const start = Date.UTC(2026, 7, 1); // Sat 1 Aug 2026
  const matches = [];
  for (let r = 0; r < ROUNDS_PLAYED; r++) {
    const date = new Date(start + r * 7 * 864e5).toISOString().slice(0, 10);
    all[r].forEach(([h, a], k) => {
      const ht = DEMO_TEAMS.find((t) => t.id === h), at = DEMO_TEAMS.find((t) => t.id === a);
      matches.push(simMatch('m' + (r + 1) + '-' + k, r + 1, date, ht, at, players, squads, R));
    });
  }
  return { source: 'demo', label: 'Demo season 2026/27 (synthetic)', teams, players, matches };
}

function simMatch(mid, round, date, H, A, players, squads, R) {
  const events = [], poss = [];
  let t = 0, per = 1, eid = 0;

  function lineup(team, form) {
    const avail = squads[team.id].filter(() => R() > 0.07).sort((a, b) => a.rank - b.rank || b.q - a.q);
    const by = { GK: [], DEF: [], MID: [], FWD: [] };
    avail.forEach((p) => by[p.group].push(p));
    const slots = FORMATIONS[form].map(([role, x, y]) => {
      const g = ROLE_GROUP[role];
      let list = by[g];
      if (!list.length) list = by.MID.length ? by.MID : by.DEF.length ? by.DEF : by.FWD;
      let i = list.findIndex((p) => p.role === role);
      if (i < 0 || R() < 0.08) { const j = list.findIndex((p) => p.rank > 0); i = j >= 0 && (i < 0 || R() < 0.5) ? j : Math.max(i, 0); }
      const p = list.splice(i, 1)[0];
      return { role, x, y, group: g, pid: p.id };
    });
    const bench = [].concat(by.GK, by.DEF, by.MID, by.FWD);
    const subs = [];
    const outfield = slots.map((s, i) => i).filter((i) => i > 0);
    const nsubs = 2 + Math.floor(R() * 3);
    for (let k = 0; k < nsubs && bench.length; k++) {
      const pool = outfield.filter((i) => !subs.some((s) => s.slot === i));
      const w = pool.map((i) => (slots[i].group === 'FWD' ? 3 : slots[i].group === 'MID' ? 2 : 1));
      let u = R() * w.reduce((a, b) => a + b, 0), slot = pool[0];
      for (let j = 0; j < pool.length; j++) { u -= w[j]; if (u <= 0) { slot = pool[j]; break; } }
      let bi = bench.findIndex((p) => p.group === slots[slot].group);
      if (bi < 0) bi = bench.findIndex((p) => p.group !== 'GK');
      if (bi < 0) break;
      const on = bench.splice(bi, 1)[0];
      subs.push({ t: 3300 + Math.round(R() * 1700), slot, on: on.id });
    }
    subs.sort((a, b) => a.t - b.t);
    return { slots, subs };
  }

  const sides = [H, A].map((tm, i) => {
    const form = tm.alt && R() < 0.22 ? tm.alt : tm.form;
    const lu = lineup(tm, form);
    return { i, tm, form, slots: lu.slots, subs: lu.subs, subsDone: [], q: tm.q + (i === 0 ? 0.03 : 0) + gauss(R) * 0.03, start: lu.slots.map((s) => ({ ...s })) };
  });
  const P = (s, slot) => players[s.slots[slot].pid];

  function applySubs() {
    for (const s of sides) {
      while (s.subs.length && per === 2 && t >= s.subs[0].t) {
        const sb = s.subs.shift();
        s.subsDone.push({ min: Math.floor(sb.t / 60), off: s.slots[sb.slot].pid, on: sb.on });
        s.slots[sb.slot].pid = sb.on;
      }
    }
  }

  function actor(s, x, y, exclude, defensive) {
    let tot = 0;
    const w = s.slots.map((p, k) => {
      if (k === exclude) return 0;
      let px, py;
      if (p.role === 'GK') { px = defensive ? 3 : 6 + Math.max(0, x - 60) * 0.05; py = 40; }
      else if (defensive) { px = p.x * 0.78 + (x - 45) * 0.32; py = p.y + (y - 40) * 0.25; }
      else { px = p.x + (x - 60) * 0.3; py = p.y + (y - 40) * 0.18; }
      const dx = x - px, dy = y - py;
      let wk = Math.exp(-((dx * dx) / 450 + (dy * dy) / 338)) + 1e-6;
      if (p.role === 'GK') wk *= defensive ? (x < 18 && Math.abs(y - 40) < 20 ? 2.5 : 0.01) : x < 30 ? 1.2 : 0.005;
      tot += wk;
      return wk;
    });
    let u = R() * tot;
    for (let k = 0; k < w.length; k++) { u -= w[k]; if (u <= 0) return k; }
    return exclude === 10 ? 9 : 10;
  }

  let cur, S;
  function startPoss(s, type, x, y, slot) {
    cur = { i: poss.length, team: s.tm.id, startT: Math.round(t), per, startType: type, startX: x };
    poss.push(cur);
    S = { s, slot: slot == null ? actor(s, x, y, -1, false) : slot, x, y, lastPass: null, head: false, sp: null };
  }
  function E(s, slot, type, x, y, o) {
    const e = { id: mid + ':' + eid++, per, t: Math.round(t), team: s.tm.id, pl: s.slots[slot].pid, type, x: +x.toFixed(1), y: +y.toFixed(1), pos: cur.i };
    if (o) for (const k in o) if (o[k] !== undefined) e[k] = typeof o[k] === 'number' && k !== 'xg' && k !== 'xa' ? +o[k].toFixed(1) : o[k];
    events.push(e);
    return e;
  }
  const opp = (s) => sides[1 - s.i];

  function kickoff(s) {
    const st = s.slots.findIndex((p) => p.group === 'FWD');
    startPoss(s, 'kickoff', 60, 40, st >= 0 ? st : 10);
  }
  function goalKick(s) { startPoss(s, 'gk', 6, 40, 0); }

  function shoot(opts = {}) {
    const s = S.s, o = opp(s), p = P(s, S.slot);
    let x = S.x, y = S.y, xg;
    if (opts.pen) { x = 108; y = 40; xg = 0.78; }
    else if (opts.fk) xg = clamp(xgOf(x, y) * 0.55, 0.03, 0.12);
    else xg = xgOf(x, y, opts.head);
    const g = R() < xg * (0.74 + 0.34 * p.fin) * (1.06 - o.q * 0.12);
    let out = 'goal';
    if (!g) { const r = R(); out = r < 0.4 ? 'saved' : r < 0.66 ? 'blocked' : 'off'; }
    const sp = opts.pen ? 'pen' : opts.fk ? 'fk' : S.sp || undefined;
    E(s, S.slot, 'shot', x, y, { xg: +xg.toFixed(3), out, head: opts.head || undefined, sp });
    const lp = S.lastPass;
    if (lp && lp.rc === p.id && !opts.pen && !opts.fk) { lp.key = true; lp.xa = +xg.toFixed(3); if (g) lp.ast = true; }
    t += 2;
    if (out === 'goal') { t += 50 + R() * 30; kickoff(o); }
    else if ((out === 'saved' || out === 'blocked') && R() < 0.42) { t += 22 + R() * 12; corner(s); }
    else if (out === 'saved') { t += 6 + R() * 6; goalKick(o); }
    else { t += 20 + R() * 12; goalKick(o); }
  }

  function corner(s) {
    const cy = R() < 0.5 ? 0.5 : 79.5;
    startPoss(s, 'setpiece', 119.5, cy);
    S.slot = actor(s, 100, cy < 40 ? 15 : 65, 0, false);
    S.sp = 'corner';
    pass({ corner: true });
  }

  function foulOrTackle(o, s, x, y) {
    // o tackles s at (x,y) in s frame
    const ox = PL - x, oy = PW - y;
    const d = actor(o, ox, oy, -1, true);
    if (R() < 0.15) {
      E(o, d, 'foul', ox, oy);
      t += 14 + R() * 16;
      if (x > 102 && Math.abs(y - 40) < 20 && R() < 0.7) {
        startPoss(s, 'setpiece', 108, 40);
        let best = 1, bf = -1;
        s.slots.forEach((sl, k) => { if (k && players[sl.pid].fin > bf) { bf = players[sl.pid].fin; best = k; } });
        S.slot = best;
        shoot({ pen: true });
        return;
      }
      startPoss(s, 'setpiece', x, y, S.slot);
      S.sp = 'fk';
      if (x > 90 && Math.abs(y - 40) < 18 && R() < 0.35) shoot({ fk: true });
      return;
    }
    startPoss(o, 'recovery', ox, oy, d);
    E(o, d, 'tackle', ox, oy, { ok: true });
    t += 1;
  }

  function pass(opts = {}) {
    const s = S.s, o = opp(s), p = P(s, S.slot), tm = s.tm;
    const x = S.x, y = S.y, dq = s.q - o.q;
    let tx, ty, cross = false;
    const long = !opts.corner && R() < (x < 50 ? tm.dir * 0.3 : tm.dir * 0.07);
    if (opts.corner) { tx = 106 + R() * 9; ty = 40 + gauss(R) * 8; cross = true; }
    else if (x > 84 && (y < 20 || y > 60) && R() < 0.38 + tm.width * 0.1) { cross = true; tx = 104 + R() * 12; ty = 40 + gauss(R) * 9; }
    else if (long) { tx = x + 26 + R() * 28; ty = 40 + gauss(R) * 22; }
    else {
      tx = x + 5 + tm.dir * 6 + gauss(R) * 11 - (x > 96 ? 8 : 0);
      ty = y + gauss(R) * 13 + (40 - y) * 0.08 + (tm.width - 0.5) * (y > 40 ? 6 : -6);
    }
    tx = clamp(tx, 1, 119);
    if (ty < 1.5) ty = clamp(3 - ty + R() * 4, 1.5, 30); else if (ty > 78.5) ty = clamp(157 - ty - R() * 4, 50, 78.5); // bounce targets off the touchline
    const len = Math.hypot(tx - x, ty - y);
    const intoBox = tx > 102 && Math.abs(ty - 40) < 20;
    let pk = 0.87 + p.q * 0.08 + dq * 0.12 - len * 0.003 - (intoBox ? 0.2 : 0) - (tx > 80 ? 0.04 : 0) - (x < 45 ? o.tm.press * 0.07 : 0) + (tx < x ? 0.06 : 0) - (cross ? 0.3 : 0) + (opts.corner ? 0.08 : 0);
    const ok = R() < clamp(pk, 0.1, 0.97);
    const e = E(s, S.slot, 'pass', x, y, { ex: tx, ey: ty, ok, cross: cross || undefined, sp: opts.corner ? 'corner' : S.sp && len < 60 ? S.sp : undefined });
    S.sp = opts.corner ? 'corner' : null;
    t += 1.5 + len * 0.05 + R() * 1.5;
    const rc = actor(s, tx, ty, S.slot, false);
    const ox = PL - tx, oy = PW - ty;
    if (len > 32 && !cross && R() < 0.65) {
      const d = actor(o, ox, oy, -1, true);
      E(s, rc, 'duel', tx, ty, { ok });
      E(o, d, 'duel', ox, oy, { ok: !ok });
    }
    if (ok) {
      e.rc = s.slots[rc].pid;
      S.lastPass = e; S.slot = rc; S.x = tx; S.y = ty;
      if (cross && intoBox && R() < (opts.corner ? 0.55 : 0.45)) S.head = true;
      return;
    }
    if (ty < 2 || ty > 78 || R() < 0.16) {
      t += 9 + R() * 12;
      startPoss(o, 'throw', ox, oy > 40 ? 79.5 : 0.5);
      return;
    }
    if (cross) {
      const d = actor(o, ox, oy, -1, true);
      startPoss(o, 'recovery', ox, oy, d);
      E(o, d, 'clearance', ox, oy);
      t += 2.5;
      const lx = clamp(ox + 18 + R() * 18, 1, 119), ly = clamp(oy + gauss(R) * 14, 1, 79);
      if (R() < 0.55) { const k = actor(o, lx, ly, -1, false); S.slot = k; S.x = lx; S.y = ly; E(o, k, 'recovery', lx, ly); }
      else { startPoss(s, 'recovery', PL - lx, PW - ly); E(s, S.slot, 'recovery', PL - lx, PW - ly); }
      return;
    }
    const f = 0.45 + R() * 0.55;
    const ix = PL - (x + (tx - x) * f), iy = PW - (y + (ty - y) * f);
    const d = actor(o, ix, iy, -1, true);
    startPoss(o, 'recovery', ix, iy, d);
    if (R() < 0.3) E(o, d, 'interception', ix, iy, { ok: true });
    else E(o, d, 'recovery', ix, iy);
  }

  function carry() {
    const s = S.s, o = opp(s), x = S.x, y = S.y, dq = s.q - o.q;
    const dx = (3 + R() * 8) * (x > 100 ? 0.4 : 1), dy = gauss(R) * 4;
    const ex = clamp(x + dx, 1, 119), ey = clamp(y + dy, 1, 79);
    const lost = 0.05 + (x < 45 ? o.tm.press * 0.05 : 0) + (x > 80 ? 0.04 : 0) - dq * 0.04;
    if (R() < lost) {
      const mx = (x + ex) / 2, my = (y + ey) / 2;
      E(s, S.slot, 'carry', x, y, { ex: mx, ey: my });
      t += 2;
      S.x = mx; S.y = my;
      foulOrTackle(o, s, mx, my);
      return;
    }
    E(s, S.slot, 'carry', x, y, { ex, ey });
    S.x = ex; S.y = ey;
    t += 1.5 + dx * 0.15 + R() * 1.5;
  }

  function dribble() {
    const s = S.s, o = opp(s), p = P(s, S.slot), x = S.x, y = S.y;
    const ok = R() < 0.46 + p.dri * 0.2 + (s.q - o.q) * 0.2;
    E(s, S.slot, 'dribble', x, y, { ok });
    t += 2.5;
    if (ok) { S.x = clamp(x + 4 + R() * 6, 1, 119); S.y = clamp(y + gauss(R) * 5, 1, 79); }
    else foulOrTackle(o, s, x, y);
  }

  function step() {
    applySubs();
    const s = S.s, p = P(s, S.slot), x = S.x, y = S.y, dq = s.q - opp(s).q;
    if (S.head) { S.head = false; shoot({ head: true }); return; }
    const inBox = x > 102 && Math.abs(y - 40) < 20, edge = x > 86 && Math.abs(y - 40) < 24;
    const ps = (inBox ? 0.085 : edge ? 0.024 : 0) * (1 + dq * 0.3);
    if (ps && R() < ps) { shoot(); return; }
    const r = R();
    if (r < 0.7 || (x < 30 && r < 0.86)) pass();
    else if (x > 55 && R() < 0.22 + p.dri * 0.25) dribble();
    else carry();
  }

  for (per = 1; per <= 2; per++) {
    t = per === 1 ? 0 : 2700;
    const end = t + 2700 + 60 + R() * 200;
    kickoff(sides[per === 1 ? 0 : 1]);
    let guard = 0;
    while (t < end && guard++ < 5000) step();
  }

  // minutes played
  const minutes = {}, subs = {};
  for (const s of sides) {
    s.start.forEach((sl) => (minutes[sl.pid] = 90));
    s.subsDone.forEach((sb) => { minutes[sb.off] = Math.max(1, sb.min); minutes[sb.on] = Math.max(1, 90 - sb.min); });
    subs[s.tm.id] = s.subsDone;
  }
  const goals = (id) => events.filter((e) => e.type === 'shot' && e.out === 'goal' && e.team === id).length;
  return {
    id: mid, round, date, home: H.id, away: A.id, hg: goals(H.id), ag: goals(A.id),
    forms: { [H.id]: sides[0].form, [A.id]: sides[1].form },
    lineups: { [H.id]: sides[0].start.map((s) => ({ pid: s.pid, role: s.role })), [A.id]: sides[1].start.map((s) => ({ pid: s.pid, role: s.role })) },
    subs, minutes, events, poss,
  };
}

/* ---------- StatsBomb open-data import ---------- */
function sbFormation(n) { return n ? String(n).split('').join('-') : null; }
function sbGroup(pos) {
  if (!pos) return 'MID';
  if (/Goalkeeper/.test(pos)) return 'GK';
  if (/Wing Back|Back/.test(pos)) return 'DEF';
  if (/Forward|Striker|Wing$/.test(pos)) return 'FWD';
  return 'MID';
}
const SB_ROLE = {
  Goalkeeper: 'GK', 'Right Back': 'RB', 'Left Back': 'LB', 'Right Center Back': 'RCB', 'Left Center Back': 'LCB', 'Center Back': 'CB',
  'Right Wing Back': 'RWB', 'Left Wing Back': 'LWB', 'Right Defensive Midfield': 'RDM', 'Left Defensive Midfield': 'LDM', 'Center Defensive Midfield': 'DM',
  'Right Center Midfield': 'RCM', 'Left Center Midfield': 'LCM', 'Center Midfield': 'CM', 'Right Midfield': 'RM', 'Left Midfield': 'LM',
  'Right Attacking Midfield': 'RAM', 'Left Attacking Midfield': 'LAM', 'Center Attacking Midfield': 'AM', 'Right Wing': 'RW', 'Left Wing': 'LW',
  'Right Center Forward': 'RS', 'Left Center Forward': 'LS', 'Center Forward': 'ST', 'Secondary Striker': 'ST',
};
const PLAY_PATTERN = { 'From Corner': 'setpiece', 'From Free Kick': 'setpiece', 'From Throw In': 'throw', 'From Goal Kick': 'gk', 'From Keeper': 'gk', 'From Kick Off': 'kickoff' };

function importStatsBomb(files) {
  // files: [{name, data}] - events arrays (one per match) and optional matches arrays
  const meta = {};
  files.forEach((f) => {
    if (Array.isArray(f.data) && f.data.length && f.data[0].match_id && f.data[0].home_team) f.data.forEach((m) => (meta[m.match_id] = m));
  });
  const teams = {}, players = {}, matches = [];
  const tid = (t) => { const id = 't' + t.id; if (!teams[id]) teams[id] = { id, name: t.name, style: null }; return id; };
  const errors = [];
  files.forEach((f) => {
    const d = f.data;
    if (!Array.isArray(d) || !d.length || !d[0].type || !('index' in d[0])) { if (!(Array.isArray(d) && d[0] && d[0].match_id)) errors.push(f.name); return; }
    const mid = String(f.name).replace(/\.json$/i, '');
    const mm = meta[mid];
    const xi = d.filter((e) => e.type.name === 'Starting XI');
    if (xi.length < 2) { errors.push(f.name); return; }
    const forms = {}, lineups = {}, minutes = {}, subs = {};
    const posOf = {};
    xi.forEach((e) => {
      const t = tid(e.team);
      forms[t] = sbFormation(e.tactics && e.tactics.formation);
      lineups[t] = (e.tactics ? e.tactics.lineup : []).map((l) => {
        const id = 'p' + l.player.id;
        const role = SB_ROLE[l.position.name] || 'CM';
        if (!players[id]) players[id] = { id, team: t, name: l.player.name, num: l.jersey_number, group: sbGroup(l.position.name), role };
        posOf[id] = role;
        minutes[id] = 0;
        return { pid: id, role };
      });
      subs[t] = [];
    });
    const homeT = mm ? tid(mm.home_team.home_team_id ? { id: mm.home_team.home_team_id, name: mm.home_team.home_team_name } : mm.home_team) : tid(xi[0].team);
    const awayT = mm ? tid(mm.away_team.away_team_id ? { id: mm.away_team.away_team_id, name: mm.away_team.away_team_name } : mm.away_team) : tid(xi[1].team);
    const pmap = {};
    const poss = [];
    const evs = [];
    let lastT = 0;
    const onAt = {};
    Object.keys(minutes).forEach((p) => (onAt[p] = 0));
    d.forEach((e) => {
      const type = e.type.name;
      const t = (e.minute || 0) * 60 + (e.second || 0);
      if (e.period > 4) return;
      lastT = Math.max(lastT, t);
      if (!(e.possession in pmap)) {
        pmap[e.possession] = poss.length;
        poss.push({ i: poss.length, team: tid(e.possession_team), startT: t, per: e.period, startType: PLAY_PATTERN[e.play_pattern && e.play_pattern.name] || 'recovery', startX: e.location ? e.location[0] : 60 });
      }
      const team = tid(e.team);
      if (type === 'Substitution') {
        const off = 'p' + e.player.id, on = 'p' + e.substitution.replacement.id;
        if (!players[on]) players[on] = { id: on, team, name: e.substitution.replacement.name, num: null, group: players[off] ? players[off].group : 'MID', role: posOf[off] || 'CM' };
        subs[team] && subs[team].push({ min: e.minute, off, on });
        if (off in onAt) { minutes[off] += t - onAt[off]; delete onAt[off]; }
        onAt[on] = t; minutes[on] = minutes[on] || 0;
        return;
      }
      if (!e.player || !e.location) {
        if (type === 'Own Goal For') evs.push({ id: e.id, per: e.period, t, team, pl: null, type: 'og', x: 60, y: 40, pos: pmap[e.possession] });
        return;
      }
      const pl = 'p' + e.player.id;
      if (!players[pl]) players[pl] = { id: pl, team, name: e.player.name, num: null, group: sbGroup(e.position && e.position.name), role: SB_ROLE[e.position && e.position.name] || 'CM' };
      const [x, y] = e.location;
      const base = { id: e.id, per: e.period, t, team, pl, x, y, pos: pmap[e.possession] };
      let ev = null;
      if (type === 'Pass') {
        const p = e.pass;
        const ptype = p.type && p.type.name;
        if (ptype === 'Kick Off' && !p.end_location) return;
        ev = { ...base, type: 'pass', ex: p.end_location[0], ey: p.end_location[1], ok: !p.outcome };
        if (p.cross) ev.cross = true;
        if (ptype === 'Corner') ev.sp = 'corner';
        else if (ptype === 'Free Kick') ev.sp = 'fk';
        else if (ptype === 'Throw-in') ev.sp = 'throw';
        if (p.recipient) ev.rc = 'p' + p.recipient.id;
        if (p.shot_assist || p.goal_assist) ev.key = true;
        if (p.goal_assist) ev.ast = true;
        if (p.assisted_shot_id) ev._shot = p.assisted_shot_id;
      } else if (type === 'Carry') {
        ev = { ...base, type: 'carry', ex: e.carry.end_location[0], ey: e.carry.end_location[1] };
      } else if (type === 'Shot') {
        const s = e.shot, o = s.outcome && s.outcome.name;
        ev = { ...base, type: 'shot', xg: s.statsbomb_xg || 0, out: o === 'Goal' ? 'goal' : o === 'Saved' || o === 'Saved To Post' ? 'saved' : o === 'Blocked' ? 'blocked' : 'off' };
        if (s.body_part && s.body_part.name === 'Head') ev.head = true;
        if (s.type && s.type.name === 'Penalty') ev.sp = 'pen';
        else if (s.type && s.type.name === 'Free Kick') ev.sp = 'fk';
      } else if (type === 'Dribble') {
        ev = { ...base, type: 'dribble', ok: !!(e.dribble.outcome && e.dribble.outcome.name === 'Complete') };
      } else if (type === 'Interception') {
        const o = e.interception && e.interception.outcome && e.interception.outcome.name;
        ev = { ...base, type: 'interception', ok: !/Lost/.test(o || '') };
      } else if (type === 'Ball Recovery') {
        if (e.ball_recovery && e.ball_recovery.recovery_failure) return;
        ev = { ...base, type: 'recovery' };
      } else if (type === 'Clearance') {
        ev = { ...base, type: 'clearance' };
      } else if (type === 'Foul Committed') {
        ev = { ...base, type: 'foul' };
      } else if (type === 'Duel') {
        const dt = e.duel.type && e.duel.type.name, o = e.duel.outcome && e.duel.outcome.name;
        if (dt === 'Tackle') ev = { ...base, type: 'tackle', ok: /Won|Success/.test(o || '') };
        else ev = { ...base, type: 'duel', ok: false };
      } else if (type === 'Miscontrol' || type === 'Dispossessed') {
        ev = { ...base, type: 'loss' };
      } else if (type === 'Block') {
        ev = { ...base, type: 'block' };
      }
      if (ev) evs.push(ev);
    });
    // attach xA from assisted shots
    const byId = {};
    evs.forEach((e) => (byId[e.id] = e));
    evs.forEach((e) => { if (e._shot && byId[e._shot]) e.xa = byId[e._shot].xg; delete e._shot; });
    const end = Math.max(5400, lastT);
    Object.keys(onAt).forEach((p) => (minutes[p] += end - onAt[p]));
    Object.keys(minutes).forEach((p) => (minutes[p] = Math.round(minutes[p] / 60)));
    const goalsFor = (id) => evs.filter((e) => (e.type === 'shot' && e.out === 'goal' && e.team === id && e.per <= 4) || (e.type === 'og' && e.team === id)).length;
    const date = mm ? mm.match_date : '';
    matches.push({ id: mid, round: mm && mm.match_week ? mm.match_week : matches.length + 1, date, home: homeT, away: awayT, hg: goalsFor(homeT), ag: goalsFor(awayT), forms, lineups, subs, minutes, events: evs.filter((e) => e.type !== 'og'), poss });
  });
  matches.sort((a, b) => (a.date || '').localeCompare(b.date || '') || a.round - b.round);
  return { db: { source: 'import', label: 'Imported StatsBomb data', teams: Object.values(teams), players, matches }, errors };
}

/* ---------- Metrics ---------- */
const PHASES = ['bu', 'pr', 'f3', 'tr', 'sp'];
const PHASE_IN = { bu: 'Build-up', pr: 'Progression', f3: 'Final third', tr: 'Attacking transition', sp: 'Set piece' };
const PHASE_OUT = { bu: 'High press', pr: 'Mid block', f3: 'Low block', tr: 'Defensive transition', sp: 'Defending set piece' };
const DEF_TYPES = { tackle: 1, interception: 1, recovery: 1, clearance: 1, foul: 1, block: 1 };
const PPDA_TYPES = { tackle: 1, interception: 1, foul: 1 };
const ON_BALL = { pass: 1, carry: 1, shot: 1, dribble: 1, loss: 1 };
const inBox = (x, y) => x > 102 && y > 18 && y < 62;
function progressive(x, y, ex, ey) {
  if (ex < x) return false;
  const gain = Math.hypot(PL - x, 40 - y) - Math.hypot(PL - ex, 40 - ey);
  const need = x < 60 && ex < 60 ? 32.8 : x < 60 ? 16.4 : 10.9;
  return gain >= need;
}

function blankTeam() {
  const o = { n: 0, w: 0, d: 0, l: 0, pts: 0, g: 0, ga: 0, xg: 0, xga: 0, npxg: 0, npxga: 0, sh: 0, sha: 0, sot: 0, pa: 0, pc: 0, posT: 0, oposT: 0, ppdaPass: 0, ppdaDef: 0, f3p: 0, of3p: 0, prog: 0, f3e: 0, boxe: 0, cross: 0, spxg: 0, hto: 0, defX: 0, defN: 0, fwd: 0, dist: 0, poss: 0, possMid: 0, possF3: 0, possBox: 0, possShot: 0, possGoal: 0, duel: 0, duelW: 0, tkl: 0, int: 0, rec: 0, drb: 0, drbW: 0, trSh: 0, trXg: 0, cor: 0, fls: 0, yc: 0, shIn: 0, ph: {}, oph: {} };
  PHASES.forEach((k) => { o.ph[k] = 0; o.oph[k] = 0; });
  return o;
}
function blankPlayer() {
  return { n: 0, min: 0, st: 0, touch: 0, boxT: 0, pa: 0, pc: 0, prog: 0, progC: 0, f3e: 0, key: 0, ast: 0, xa: 0, cross: 0, sh: 0, sot: 0, g: 0, xg: 0, npxg: 0, drb: 0, drbW: 0, tkl: 0, int: 0, rec: 0, clr: 0, fls: 0, duel: 0, duelW: 0, ca: 0, rt: 0, rtN: 0 };
}
function phaseOf(e, p, team) {
  const x = e.team === team ? e.x : PL - e.x;
  const dt = e.t - p.startT;
  if (p.startType === 'setpiece' && dt < 12) return 'sp';
  if (p.startType === 'recovery' && dt < 7 && p.n > 2) return 'tr';
  return x < 40 ? 'bu' : x < 80 ? 'pr' : 'f3';
}

function prepareMatch(m) {
  const ev = m.events;
  ev.sort((a, b) => a.per - b.per || a.t - b.t);
  for (let i = 0; i < ev.length; i++) {
    const e = ev[i], n = ev[i + 1];
    e.dur = n && n.pos === e.pos && n.per === e.per ? clamp(n.t - e.t, 0, 8) : 2;
  }
  m.poss.forEach((p) => { p.maxX = p.startX || 0; p.box = false; p.shot = false; p.goal = false; p.n = 0; });
  ev.forEach((e) => {
    const p = m.poss[e.pos];
    if (!p || e.team !== p.team) return;
    p.n++;
    p.maxX = Math.max(p.maxX, e.x, e.ok !== false && e.ex != null ? e.ex : 0);
    if (inBox(e.x, e.y) || (e.ok && e.ex != null && inBox(e.ex, e.ey))) p.box = true;
    if (e.type === 'shot') { p.shot = true; if (e.out === 'goal') p.goal = true; }
  });
  const teams = [m.home, m.away];
  m.ts = {};
  m.ps = {};
  teams.forEach((T) => {
    const O = T === m.home ? m.away : m.home;
    const s = blankTeam();
    s.n = 1;
    const gf = T === m.home ? m.hg : m.ag, ga = T === m.home ? m.ag : m.hg;
    s.g = gf; s.ga = ga;
    if (gf > ga) { s.w = 1; s.pts = 3; } else if (gf === ga) { s.d = 1; s.pts = 1; } else s.l = 1;
    ev.forEach((e) => {
      const p = m.poss[e.pos];
      if (p) {
        if (p.team === T) { s.posT += e.dur; s.ph[phaseOf(e, p, T)] += e.dur; }
        else if (p.team === O) { s.oposT += e.dur; s.oph[phaseOf(e, p, O)] += e.dur; }
      }
      if (e.team === T) {
        if (e.type === 'pass') {
          if (e.sp === 'throw') return;
          s.pa++;
          if (e.ok) {
            s.pc++;
            if (progressive(e.x, e.y, e.ex, e.ey)) s.prog++;
            if (e.x < 80 && e.ex >= 80) s.f3e++;
            if (!inBox(e.x, e.y) && inBox(e.ex, e.ey)) s.boxe++;
            s.fwd += Math.max(0, e.ex - e.x);
            s.dist += Math.hypot(e.ex - e.x, e.ey - e.y);
          }
          if (e.x >= 80) s.f3p++;
          if (e.cross) s.cross++;
          if (e.sp === 'corner') s.cor++;
        } else if (e.type === 'carry') {
          if (e.x < 80 && e.ex >= 80) s.f3e++;
          if (!inBox(e.x, e.y) && inBox(e.ex, e.ey)) s.boxe++;
        } else if (e.type === 'shot') {
          s.sh++; s.xg += e.xg;
          if (inBox(e.x, e.y)) s.shIn++;
          if (e.sp !== 'pen') s.npxg += e.xg;
          if (e.out === 'goal' || e.out === 'saved') s.sot++;
          if (e.sp) s.spxg += e.xg;
          else if (p && p.team === T && phaseOf(e, p, T) === 'sp') s.spxg += e.xg;
          if (p && p.team === T && phaseOf(e, p, T) === 'tr') { s.trSh++; s.trXg += e.xg; }
        } else if (e.type === 'dribble') { s.drb++; if (e.ok) s.drbW++; s.duel++; if (e.ok) s.duelW++; }
        else if (e.type === 'duel') { s.duel++; if (e.ok) s.duelW++; }
        if (DEF_TYPES[e.type]) {
          s.defX += e.x; s.defN++;
          if (e.type === 'tackle') { s.tkl++; s.duel++; if (e.ok) s.duelW++; }
          if (e.type === 'interception') s.int++;
          if (e.type === 'recovery') s.rec++;
          if ((e.type === 'tackle' || e.type === 'interception' || e.type === 'recovery') && e.x >= 76) s.hto++;
        }
        if (PPDA_TYPES[e.type] && e.x >= 48) s.ppdaDef++;
        if (e.type === 'foul') s.fls++;
      } else if (e.team === O) {
        if (e.type === 'pass' && e.sp !== 'throw') {
          if (e.x <= 72) s.ppdaPass++;
          if (e.x >= 80) s.of3p++;
        } else if (e.type === 'shot') {
          s.sha++; s.xga += e.xg;
          if (e.sp !== 'pen') s.npxga += e.xg;
        }
      }
    });
    m.poss.forEach((p) => {
      if (p.team !== T || p.n === 0) return;
      s.poss++;
      if (p.maxX >= 40) s.possMid++;
      if (p.maxX >= 80) s.possF3++;
      if (p.box) s.possBox++;
      if (p.shot) s.possShot++;
      if (p.goal) s.possGoal++;
    });
    s.yc = NaN; // cards are not in the event model
    m.ts[T] = s;
  });
  // players
  const P = (id) => (m.ps[id] = m.ps[id] || blankPlayer());
  Object.entries(m.minutes).forEach(([id, min]) => { const s = P(id); s.n = 1; s.min = min; });
  Object.values(m.lineups).forEach((lu) => lu.forEach((l) => (P(l.pid).st = 1)));
  ev.forEach((e) => {
    if (!e.pl) return;
    const s = P(e.pl);
    // Touches: on-ball actions; carries and receptions belong to the same touch sequence
    if ((ON_BALL[e.type] && e.type !== 'carry') || DEF_TYPES[e.type]) s.touch++;
    if (ON_BALL[e.type] && inBox(e.x, e.y)) s.boxT++;
    switch (e.type) {
      case 'pass':
        if (e.sp === 'throw') break;
        s.pa++;
        if (e.ok) {
          s.pc++;
          if (progressive(e.x, e.y, e.ex, e.ey)) s.prog++;
          if (e.x < 80 && e.ex >= 80) s.f3e++;
          if (e.rc && inBox(e.ex, e.ey)) P(e.rc).boxT++;
        }
        if (e.key) s.key++;
        if (e.ast) s.ast++;
        if (e.xa) s.xa += e.xa;
        if (e.cross) s.cross++;
        break;
      case 'carry':
        if (progressive(e.x, e.y, e.ex, e.ey)) s.progC++;
        if (e.x < 80 && e.ex >= 80) s.ca++;
        break;
      case 'shot':
        s.sh++; s.xg += e.xg;
        if (e.sp !== 'pen') s.npxg += e.xg;
        if (e.out === 'goal' || e.out === 'saved') s.sot++;
        if (e.out === 'goal') s.g++;
        break;
      case 'dribble': s.drb++; s.duel++; if (e.ok) { s.drbW++; s.duelW++; } break;
      case 'tackle': s.tkl++; s.duel++; if (e.ok) s.duelW++; break;
      case 'interception': s.int++; break;
      case 'recovery': s.rec++; break;
      case 'clearance': s.clr++; break;
      case 'foul': s.fls++; break;
      case 'duel': s.duel++; if (e.ok) s.duelW++; break;
    }
  });
  return m;
}

function addInto(a, b) {
  for (const k in b) {
    if (typeof b[k] === 'number') a[k] = Number.isNaN(a[k]) ? NaN : (a[k] || 0) + b[k]; // a missing stat stays missing
    else if (b[k] && typeof b[k] === 'object') { a[k] = a[k] || {}; for (const j in b[k]) a[k][j] = (a[k][j] || 0) + b[k][j]; }
  }
  return a;
}
function aggTeam(matches, T) { const a = blankTeam(); a.n = 0; matches.forEach((m) => m.ts[T] && addInto(a, m.ts[T])); return a; }
function aggPlayer(matches, pid) { const a = blankPlayer(); matches.forEach((m) => m.ps[pid] && addInto(a, m.ps[pid])); return a; }

// NaN marks a stat the data source does not provide; it propagates so the UI can hide it.
const safe = (a, b) => (Number.isNaN(a) || Number.isNaN(b) ? NaN : b ? a / b : 0);
const has = (v) => v != null && Number.isFinite(v);
/* Team metric catalogue. dir: 1 higher is better, -1 lower is better, 0 neutral (style) */
const TEAM_METRICS = [
  { k: 'ppg', l: 'Points per game', f: (a) => safe(a.pts, a.n), d: 2, dir: 1, grp: 'Results' },
  { k: 'g', l: 'Goals', u: '/match', f: (a) => safe(a.g, a.n), d: 2, dir: 1, grp: 'Attack' },
  { k: 'xg', l: 'xG', u: '/match', f: (a) => safe(a.xg, a.n), d: 2, dir: 1, grp: 'Attack' },
  { k: 'npxg', l: 'Non-penalty xG', u: '/match', f: (a) => safe(a.npxg, a.n), d: 2, dir: 1, grp: 'Attack' },
  { k: 'sh', l: 'Shots', u: '/match', f: (a) => safe(a.sh, a.n), d: 1, dir: 1, grp: 'Attack' },
  { k: 'xgsh', l: 'xG per shot', f: (a) => safe(a.xg, a.sh), d: 3, dir: 1, grp: 'Attack' },
  { k: 'sot', l: 'Shots on target', u: '%', f: (a) => 100 * safe(a.sot, a.sh), d: 0, dir: 1, grp: 'Attack' },
  { k: 'boxe', l: 'Box entries', u: '/match', f: (a) => safe(a.boxe, a.n), d: 1, dir: 1, grp: 'Attack' },
  { k: 'spxg', l: 'Set-piece xG', u: '/match', f: (a) => safe(a.spxg, a.n), d: 2, dir: 1, grp: 'Attack' },
  { k: 'trxg', l: 'Transition xG', u: '/match', f: (a) => safe(a.trXg, a.n), d: 2, dir: 1, grp: 'Attack' },
  { k: 'ga', l: 'Goals against', u: '/match', f: (a) => safe(a.ga, a.n), d: 2, dir: -1, grp: 'Defence' },
  { k: 'xga', l: 'xG against', u: '/match', f: (a) => safe(a.xga, a.n), d: 2, dir: -1, grp: 'Defence' },
  { k: 'sha', l: 'Shots against', u: '/match', f: (a) => safe(a.sha, a.n), d: 1, dir: -1, grp: 'Defence' },
  { k: 'ppda', l: 'PPDA', f: (a) => safe(a.ppdaPass, a.ppdaDef), d: 1, dir: -1, grp: 'Defence', tip: 'Opponent passes in their own 60% of the pitch per defensive action there. Lower means a more aggressive press.' },
  { k: 'height', l: 'Defensive action height', u: 'yd', f: (a) => safe(a.defX, a.defN), d: 1, dir: 1, grp: 'Defence', tip: 'Average distance from own goal line of tackles, interceptions, recoveries, clearances and fouls.' },
  { k: 'hto', l: 'High turnovers', u: '/match', f: (a) => safe(a.hto, a.n), d: 1, dir: 1, grp: 'Defence', tip: 'Ball won within 44 yards (40 m) of the opponent goal.' },
  { k: 'duel', l: 'Duels won', u: '%', f: (a) => 100 * safe(a.duelW, a.duel), d: 0, dir: 1, grp: 'Defence' },
  { k: 'poss', l: 'Possession', u: '%', f: (a) => 100 * safe(a.posT, a.posT + a.oposT), d: 1, dir: 0, grp: 'Style' },
  { k: 'tilt', l: 'Field tilt', u: '%', f: (a) => 100 * safe(a.f3p, a.f3p + a.of3p), d: 1, dir: 1, grp: 'Style', tip: 'Share of all final-third passes in the match made by this team.' },
  { k: 'pass', l: 'Pass completion', u: '%', f: (a) => 100 * safe(a.pc, a.pa), d: 1, dir: 0, grp: 'Style' },
  { k: 'ppp', l: 'Passes per possession', f: (a) => safe(a.pa, a.poss), d: 2, dir: 0, grp: 'Style' },
  { k: 'direct', l: 'Directness', u: '%', f: (a) => 100 * safe(a.fwd, a.dist), d: 0, dir: 0, grp: 'Style', tip: 'Share of completed pass distance that goes forward.' },
  { k: 'prog', l: 'Progressive passes', u: '/match', f: (a) => safe(a.prog, a.n), d: 1, dir: 1, grp: 'Style' },
  { k: 'f3e', l: 'Final-third entries', u: '/match', f: (a) => safe(a.f3e, a.n), d: 1, dir: 1, grp: 'Style' },
  { k: 'cross', l: 'Crosses', u: '/match', f: (a) => safe(a.cross, a.n), d: 1, dir: 0, grp: 'Style' },
  { k: 'shIn', l: 'Shots from inside the box', u: '%', f: (a) => 100 * safe(a.shIn, a.sh), d: 0, dir: 1, grp: 'Attack' },
  { k: 'cor', l: 'Corners', u: '/match', f: (a) => safe(a.cor, a.n), d: 1, dir: 1, grp: 'Attack' },
  { k: 'fls', l: 'Fouls committed', u: '/match', f: (a) => safe(a.fls, a.n), d: 1, dir: 0, grp: 'Defence' },
  { k: 'yc', l: 'Yellow cards', u: '/match', f: (a) => safe(a.yc, a.n), d: 2, dir: -1, grp: 'Defence' },
  { k: 'possShot', l: 'Possessions ending in a shot', u: '%', f: (a) => 100 * safe(a.possShot, a.poss), d: 1, dir: 1, grp: 'Style' },
];
const PLAYER_METRICS = [
  { k: 'g', l: 'Goals', f: (a) => a.g, p90: true, d: 2 },
  { k: 'xg', l: 'xG', f: (a) => a.xg, p90: true, d: 2 },
  { k: 'npxg', l: 'Non-penalty xG', f: (a) => a.npxg, p90: true, d: 2 },
  { k: 'sh', l: 'Shots', f: (a) => a.sh, p90: true, d: 2 },
  { k: 'ast', l: 'Assists', f: (a) => a.ast, p90: true, d: 2 },
  { k: 'xa', l: 'xA', f: (a) => a.xa, p90: true, d: 2 },
  { k: 'key', l: 'Key passes', f: (a) => a.key, p90: true, d: 2 },
  { k: 'pa', l: 'Passes', f: (a) => a.pa, p90: true, d: 1 },
  { k: 'pct', l: 'Pass completion %', f: (a) => 100 * safe(a.pc, a.pa), d: 0 },
  { k: 'prog', l: 'Progressive passes', f: (a) => a.prog, p90: true, d: 2 },
  { k: 'progC', l: 'Progressive carries', f: (a) => a.progC, p90: true, d: 2 },
  { k: 'f3e', l: 'Passes into final third', f: (a) => a.f3e, p90: true, d: 2 },
  { k: 'boxT', l: 'Touches in box', f: (a) => a.boxT, p90: true, d: 2 },
  { k: 'drbW', l: 'Successful dribbles', f: (a) => a.drbW, p90: true, d: 2 },
  { k: 'tkl', l: 'Tackles', f: (a) => a.tkl, p90: true, d: 2 },
  { k: 'int', l: 'Interceptions', f: (a) => a.int, p90: true, d: 2 },
  { k: 'rec', l: 'Ball recoveries', f: (a) => a.rec, p90: true, d: 2 },
  { k: 'clr', l: 'Clearances', f: (a) => a.clr, p90: true, d: 2 },
  { k: 'duel', l: 'Duels won %', f: (a) => 100 * safe(a.duelW, a.duel), d: 0 },
  { k: 'touch', l: 'Touches', f: (a) => a.touch, p90: true, d: 1 },
  { k: 'fls', l: 'Fouls committed', f: (a) => a.fls, p90: true, d: 2 },
  { k: 'rating', l: 'Average match rating', f: (a) => (a.rtN ? a.rt / a.rtN : NaN), d: 2 },
];
function playerValue(mt, a, per90) { const v = mt.f(a); return per90 && mt.p90 ? safe(v * 90, a.min) : v; }

/* ---------- Database prep & selectors ---------- */
function prepareDB(db) {
  db.matches.forEach((m) => { if (!m.ts) prepareMatch(m); }); // stats-only sources arrive with ts/ps already built
  db.hasEvents = db.matches.some((m) => m.events && m.events.length);
  db.teamById = {};
  db.teams.forEach((t) => (db.teamById[t.id] = t));
  db.teams.sort((a, b) => a.name.localeCompare(b.name));
  return db;
}
function leagueTable(db, matches) {
  const rows = db.teams.map((t) => ({ team: t, a: aggTeam(matches || db.matches, t.id) })).filter((r) => r.a.n);
  rows.sort((x, y) => y.a.pts - x.a.pts || (y.a.g - y.a.ga) - (x.a.g - x.a.ga) || y.a.g - x.a.g || x.team.name.localeCompare(y.team.name));
  rows.forEach((r, i) => (r.pos = i + 1));
  return rows;
}

/* ---------- Spatial helpers ---------- */
function density(points, nx = 60, ny = 40, sigma = 2.2) {
  const g = new Float32Array(nx * ny);
  points.forEach(([x, y, w]) => {
    const i = clamp(Math.floor((x / PL) * nx), 0, nx - 1), j = clamp(Math.floor((y / PW) * ny), 0, ny - 1);
    g[j * nx + i] += w == null ? 1 : w;
  });
  // separable gaussian blur
  const rad = Math.ceil(sigma * 3), k = [];
  let ks = 0;
  for (let i = -rad; i <= rad; i++) { const v = Math.exp(-(i * i) / (2 * sigma * sigma)); k.push(v); ks += v; }
  const tmp = new Float32Array(nx * ny), out = new Float32Array(nx * ny);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { let s = 0; for (let q = -rad; q <= rad; q++) { const ii = clamp(i + q, 0, nx - 1); s += g[j * nx + ii] * k[q + rad]; } tmp[j * nx + i] = s / ks; }
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { let s = 0; for (let q = -rad; q <= rad; q++) { const jj = clamp(j + q, 0, ny - 1); s += tmp[jj * nx + i] * k[q + rad]; } out[j * nx + i] = s / ks; }
  return { nx, ny, v: out };
}

if (typeof module !== 'undefined') module.exports = { buildDemo, prepareDB, importStatsBomb, aggTeam, aggPlayer, leagueTable, TEAM_METRICS, PLAYER_METRICS, playerValue, density, PHASES };
