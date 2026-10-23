'use strict';
/* =====================================================================
   Wyscout (Hudl) API v3 import
   Reads match files from GET /v3/matches/{id}/events with
   fetch=teams,players,match,substitutions,formations (one file per match),
   or the bundle written by tools/fetch-wyscout.mjs. Wyscout pitch
   coordinates are 0-100 with each team attacking left to right and y = 0
   on the attacking team's left, as StatsBomb's, so they scale straight
   onto the app's 120 x 80 pitch. Shots carry Wyscout's own xG.
   ===================================================================== */

const WY_ROLE = {
  gk: 'GK', rb: 'RB', lb: 'LB', rcb: 'RCB', lcb: 'LCB', cb: 'CB', rcb3: 'RCB', lcb3: 'LCB', rb5: 'RWB', lb5: 'LWB', rwb: 'RWB', lwb: 'LWB',
  dmf: 'DM', rdmf: 'RDM', ldmf: 'LDM', rcmf: 'RCM', lcmf: 'LCM', rcmf3: 'RCM', lcmf3: 'LCM', cmf: 'CM', amf: 'AM', ramf: 'RAM', lamf: 'LAM',
  rw: 'RW', lw: 'LW', rwf: 'RW', lwf: 'LW', cf: 'ST', ss: 'ST', rcf: 'RS', lcf: 'LS',
};
const WY_GROUP = { GKP: 'GK', DEF: 'DEF', MID: 'MID', FWD: 'FWD' };
const wyIsMatch = (d) => d && Array.isArray(d.events) && d.events.length > 0 && d.events[0].type && 'primary' in d.events[0].type && d.events[0].location !== undefined;
const wyIsFile = (d) => wyIsMatch(d) || (d && d.source === 'wyscout' && Array.isArray(d.matches));
const wyX = (v) => Math.round(Math.max(0, Math.min(100, v)) * 12) / 10, wyY = (v) => Math.round(Math.max(0, Math.min(100, v)) * 8) / 10;

function importWyscout(files) {
  const games = [];
  files.forEach((f) => { const d = f.data; if (wyIsMatch(d)) games.push(d); else if (d && d.source === 'wyscout') d.matches.forEach((m) => wyIsMatch(m) && games.push(m)); });
  const teams = {}, players = {}, matches = [], errors = [];
  const tid = (id, name) => { const k = 'w' + id; if (!teams[k]) teams[k] = { id: k, name: name || 'Team ' + id, style: null }; else if (name && /^Team /.test(teams[k].name)) teams[k].name = name; return k; };
  games.forEach((g) => {
    const mt = g.match || {}, td = mt.teamsData || {};
    const sides = Object.values(td);
    const homeD = sides.find((s) => s.side === 'home'), awayD = sides.find((s) => s.side === 'away');
    const tname = (id) => (g.teams && g.teams[id] && g.teams[id].team && g.teams[id].team.name) || (g.events.find((e) => e.team && e.team.id == id) || { team: {} }).team.name;
    if (!homeD || !awayD) { errors.push('match ' + (mt.wyId || '?') + ' has no home/away teams'); return; }
    const H = tid(homeD.teamId, tname(homeD.teamId)), A = tid(awayD.teamId, tname(awayD.teamId));
    // Players: names, positions
    Object.entries(g.players || {}).forEach(([t, list]) => (list || []).forEach((x) => {
      const p = x.player || x;
      const id = 'w' + p.wyId;
      // The familiar name: Wyscout's short name unless it is an initial ("G. Frabotta"), else first + last name
      const short = String(p.shortName || '').trim();
      const name = (short && !/\./.test(short) ? short : [String(p.firstName || '').trim().split(/\s+/)[0], String(p.lastName || '').trim()].filter(Boolean).join(' ')).replace(/\s+/g, ' ') || short || 'Player ' + p.wyId;
      players[id] = players[id] || { id, team: tid(t), name, num: null, group: WY_GROUP[p.role && p.role.code3] || 'MID', role: null };
      players[id].team = tid(t);
    }));
    const addP = (pl, T) => { if (!pl || !pl.id) return null; const id = 'w' + pl.id; if (!players[id]) players[id] = { id, team: T, name: pl.name || 'Player ' + pl.id, num: null, group: /gk/i.test(pl.position || '') ? 'GK' : 'MID', role: null }; return id; };
    // Line-ups and formations from the first formation of the first half
    const forms = {}, lineups = { [H]: [], [A]: [] }, minutes = {}, subs = { [H]: [], [A]: [] };
    [[homeD, H], [awayD, A]].forEach(([s, T]) => {
      const fset = g.formations && g.formations[s.teamId] && g.formations[s.teamId]['1H'];
      const first = fset && Object.values(fset)[0], scheme = first && Object.keys(first)[0], fx = scheme && first[scheme];
      const posOf = {};
      if (fx) { forms[T] = fx.scheme || scheme; (fx.players || []).forEach((o) => Object.values(o).forEach((q) => (posOf['w' + q.playerId] = WY_ROLE[String(q.position).toLowerCase()] || null))); }
      const lu = (s.formation && s.formation.lineup) || [];
      lineups[T] = lu.map((q) => { const id = 'w' + q.playerId; if (players[id]) { players[id].num = q.shirtNumber; players[id].role = players[id].role || posOf[id]; } return { pid: id, role: posOf[id] || (players[id] && players[id].group === 'GK' ? 'GK' : 'CM') }; });
      // Order like the other sources: goalkeeper first
      lineups[T].sort((a, b) => (a.role === 'GK' ? -1 : b.role === 'GK' ? 1 : 0));
      lu.forEach((q) => (minutes['w' + q.playerId] = 90));
      ((s.formation && s.formation.bench) || []).forEach((q) => { if (players['w' + q.playerId]) players['w' + q.playerId].num = q.shirtNumber; });
    });
    // Substitutions: {teamId: {period: {secondsIntoPeriod: {in:[], out:[]}}}}
    Object.entries(g.substitutions || {}).forEach(([t, byPer]) => {
      const T = tid(t);
      Object.entries(byPer || {}).forEach(([per, at]) => Object.entries(at || {}).forEach(([sec, sw]) => {
        const min = Math.max(1, Math.round(({ '1H': 0, '2H': 45, E1: 90, E2: 105 }[per] || 0) + Number(sec) / 60));
        const ins = (sw.in || []).map((x) => 'w' + x.playerId), outs = (sw.out || []).map((x) => 'w' + x.playerId);
        outs.forEach((off, i) => { const on = ins[i]; if (!on) return; subs[T] && subs[T].push({ min, off, on }); minutes[off] = Math.min(minutes[off] || 90, min); minutes[on] = Math.max(1, 90 - min); if (players[on] && players[off] && !players[on].role) players[on].role = players[off].role; });
      }));
    });
    // Possessions
    const pmap = {}, poss = [];
    const evs = [];
    const perOf = { '1H': 1, '2H': 2, E1: 3, E2: 4 };
    let lastPer = 0;
    const sorted = g.events.slice().sort((a, b) => (perOf[a.matchPeriod] || 9) - (perOf[b.matchPeriod] || 9) || a.minute * 60 + a.second - (b.minute * 60 + b.second));
    const shotById = {};
    sorted.forEach((e) => { if (e.shot) shotById[e.id] = e; });
    sorted.forEach((e) => {
      const per = perOf[e.matchPeriod];
      if (!per || !e.team || !e.location) return;
      const t = e.minute * 60 + e.second;
      const team = tid(e.team.id, e.team.name);
      const sec = (e.type && e.type.secondary) || [], prim = e.type && e.type.primary;
      let pos;
      if (e.possession && e.possession.id != null) {
        if (!(e.possession.id in pmap)) {
          const ty = e.possession.types || [];
          const startType = per !== lastPer ? 'kickoff' : ty.includes('corner') || ty.includes('free_kick') || ty.includes('set_piece_attack') || ty.includes('penalty') ? 'setpiece' : ty.includes('throw_in') ? 'throw' : ty.includes('goal_kick') ? 'gk' : 'recovery';
          pmap[e.possession.id] = poss.length;
          const sl = e.possession.startLocation || e.location;
          poss.push({ i: poss.length, team: tid(e.possession.team.id, e.possession.team.name), startT: t, per, startType, startX: wyX(sl.x) });
          lastPer = per;
        }
        pos = pmap[e.possession.id];
      }
      const pl = addP(e.player, team);
      const x = wyX(e.location.x), y = wyY(e.location.y);
      const base = { id: String(e.id), per, t, team, pl, x, y, pos };
      const push = (o) => evs.push({ ...base, ...o });
      if (prim === 'interception') push({ type: 'interception', ok: true });
      if (sec.includes('recovery') && prim !== 'interception' && !(prim === 'duel' && e.groundDuel && e.groundDuel.duelType === 'defensive_duel')) push({ type: 'recovery' });
      if (e.shot) {
        const s = e.shot;
        const out = s.isGoal ? 'goal' : s.onTarget ? 'saved' : /^b/.test(s.goalZone || '') ? 'blocked' : 'off';
        push({ type: 'shot', xg: Number(s.xg) || 0, out, head: s.bodyPart === 'head_or_other' || sec.includes('head_shot') || undefined, sp: prim === 'penalty' ? 'pen' : prim === 'free_kick' ? 'fk' : undefined });
      } else if (e.pass && e.pass.endLocation) {
        const p = e.pass;
        const o = { type: 'pass', ex: wyX(p.endLocation.x), ey: wyY(p.endLocation.y), ok: !!p.accurate };
        if (sec.includes('cross')) o.cross = true;
        if (prim === 'corner') o.sp = 'corner'; else if (prim === 'free_kick') o.sp = 'fk'; else if (prim === 'throw_in') o.sp = 'throw';
        if (p.accurate && p.recipient && p.recipient.id) o.rc = addP(p.recipient, team);
        if (sec.includes('shot_assist') || sec.includes('key_pass')) o.key = true;
        if (sec.includes('assist')) o.ast = true;
        if (o.key) { const sh = e.relatedEventId && shotById[e.relatedEventId]; o._xa = sh ? Number(sh.shot.xg) || 0 : null; }
        push(o);
      }
      if (e.carry && e.carry.endLocation) push({ type: 'carry', ex: wyX(e.carry.endLocation.x), ey: wyY(e.carry.endLocation.y) });
      if (prim === 'duel') {
        const gd = e.groundDuel, ad = e.aerialDuel;
        // A defensive duel is a tackle when it is a sliding tackle or wins the ball; otherwise a duel
        if (gd && gd.duelType === 'defensive_duel') {
          if (sec.includes('sliding_tackle') || gd.recoveredPossession) push({ type: 'tackle', ok: !!(gd.recoveredPossession || gd.stoppedProgress) });
          else push({ type: 'duel', ok: !!gd.stoppedProgress });
          if (gd.recoveredPossession) push({ type: 'recovery' });
        }
        else if (gd && gd.duelType === 'offensive_duel' && (gd.takeOn || sec.includes('dribble'))) push({ type: 'dribble', ok: !!(gd.keptPossession || gd.progressedWithBall) });
        else if (gd || ad) push({ type: 'duel', ok: ad ? !!ad.firstTouch : !!(gd.keptPossession || gd.recoveredPossession) });
      }
      if (prim === 'clearance') push({ type: 'clearance' });
      if (prim === 'infraction' && sec.includes('foul')) push({ type: 'foul' });
      if (prim === 'touch' && sec.includes('loss')) push({ type: 'loss' });
      if (prim === 'shot_against' || sec.includes('shot_block')) { if (sec.includes('shot_block')) push({ type: 'block' }); }
    });
    // xA: the shot a key pass set up (linked event, else the team's next shot within 10 s)
    evs.forEach((e, i) => {
      if (e.type !== 'pass' || !e.key) return;
      if (e._xa == null) { const sh = evs.slice(i + 1).find((x) => x.type === 'shot' && x.team === e.team && x.per === e.per && x.t - e.t <= 10); e._xa = sh ? sh.xg : 0; }
      e.xa = e._xa;
    });
    evs.forEach((e) => delete e._xa);
    const score = (s) => (s && s.score != null ? Number(s.score) : null);
    let hg = score(homeD), ag = score(awayD);
    const goals = (T) => evs.filter((e) => e.type === 'shot' && e.out === 'goal' && e.team === T).length;
    if (hg == null) hg = goals(H); if (ag == null) ag = goals(A);
    const date = String(mt.dateutc || '').slice(0, 10);
    const pens = homeD.scoreP || awayD.scoreP ? { f: Number(homeD.scoreP) || 0, a: Number(awayD.scoreP) || 0 } : null;
    matches.push({ id: 'wy' + (mt.wyId || matches.length), round: mt.gameweek || matches.length + 1, date, home: H, away: A, hg, ag, pens, forms, lineups, subs, minutes, events: evs, poss, info: { label: mt.label || '' } });
  });
  // Most-used role per player
  const rc = {};
  matches.forEach((m) => Object.values(m.lineups).forEach((lu) => lu.forEach((l) => { rc[l.pid] = rc[l.pid] || {}; rc[l.pid][l.role] = (rc[l.pid][l.role] || 0) + 1; })));
  Object.entries(rc).forEach(([pid, r]) => { if (players[pid]) players[pid].role = Object.entries(r).sort((a, b) => b[1] - a[1])[0][0]; });
  matches.sort((a, b) => (a.date || '').localeCompare(b.date || '') || a.round - b.round);
  if (!games.length) errors.push('No Wyscout match events found.');
  return { db: { source: 'import', label: 'Wyscout data', teams: Object.values(teams), players, matches }, errors };
}

if (typeof module !== 'undefined') module.exports = { importWyscout, wyIsFile };
