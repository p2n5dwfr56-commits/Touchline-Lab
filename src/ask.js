'use strict';
/* =====================================================================
   Ask AI
   A prompt box that asks Claude (on the viewer's own Claude account, via
   the page's `sample` capability) to build a custom table or chart from
   the data loaded in the app. Claude reads the data only through the
   read-only page functions below, and must answer with numbers they
   return; the answer is a small JSON object the page renders.
   ===================================================================== */

const ASK = { sample: null, state: 'idle', busy: null, history: [], limits: null }; // state: idle | pending | ready | none
const ASK_EXAMPLES = [
  'Top 10 Aberdeen players by ball wins per 90 (500+ minutes)',
  'Aberdeen’s xG for and against in every match, as a chart',
  'Which teams have the best pass completion, and where do Aberdeen rank?',
  'Compare Aberdeen’s home and away record and shots per match',
  'Kevin Nisbet’s match ratings this season',
  'Which Premiership defenders win the most headers per 90?',
];
try { ASK.history = JSON.parse(localStorage.getItem('tl-ask') || '[]').slice(0, 8); } catch (e) { ASK.history = []; }
const askSave = () => { try { localStorage.setItem('tl-ask', JSON.stringify(ASK.history.slice(0, 8))); } catch (e) { /* storage off */ } };

// Resolve the capability once; null when this view can't ask Claude
function askInit() {
  if (ASK.state !== 'idle') return;
  if (!(window.claude && window.claude.use)) { ASK.state = 'none'; return; }
  ASK.state = 'pending';
  const done = async (s) => {
    ASK.sample = s || null;
    if (s) ASK.limits = await s.limits().catch(() => null);
    ASK.state = s ? 'ready' : 'none';
    if (S.tab === 'ask') render();
  };
  try { window.claude.use('sample').then(done, () => done(null)); } catch (e) { done(null); }
}

/* ---------- Page functions Claude may call (read-only) ---------- */
const r2a = (v) => (has(v) ? Math.round(v * 100) / 100 : null);
const findTeam = (q) => { const k = fbTeamKey(q); return DB.teams.find((t) => fbTeamKey(t.name) === k || t.id === q) || DB.teams.find((t) => fbTeamKey(t.name).includes(k)); };
function findPlayer(q) {
  const s = String(q || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const all = Object.values(DB.players);
  const norm = (n) => n.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  return all.find((p) => norm(p.name) === s) || all.find((p) => norm(p.name).includes(s)) || all.find((p) => s.split(/\s+/).every((w) => norm(p.name).includes(w)));
}
const P_FIELDS = ['min', 'n', 'st', 'g', 'ast', 'xg', 'xa', 'sh', 'sot', 'key', 'bcc', 'pa', 'pc', 'tkl', 'tklW', 'int', 'rec', 'clr', 'blk', 'duel', 'duelW', 'aerW', 'aerL', 'drb', 'drbW', 'fls', 'yc', 'saves', 'gaK', 'cs', 'onG', 'onGA'];
function playerRow(p, a) {
  const o = { name: p.name, team: teamName(p.team), position: p.role || p.group, group: p.group };
  P_FIELDS.forEach((k) => { if (has(a[k])) o[k] = r2a(a[k]); });
  if (a.rtN) o.rating = r2a(a.rt / a.rtN);
  return o;
}
// When this view can't run page tools: the main data goes into the prompt instead (kept small)
function askData() {
  const T = S.team;
  const pick = (t) => ASK_TOOLS(() => {}).find((x) => x.name === t).execute;
  const data = { league_table: pick('league_table')(), [teamName(T) + ' matches']: pick('team_matches')({ team: teamName(T) }), [teamName(T) + ' players']: DB.hasPlayers ? pick('players')({ team: teamName(T) }) : [] };
  return '\n\nThe tools are not available in this view, so here is the data (JSON). Use only this:\n' + JSON.stringify(data).slice(0, 120000);
}
const ASK_TOOLS = (progress) => [
  {
    name: 'league_table', description: 'The league table for the season on screen: position, team, played, won, drawn, lost, goals for/against, points, and xG/xGA where available. Always league matches only.',
    execute: () => { progress('Reading the league table…'); return leagueTable(DB, null).map((r) => ({ pos: r.pos, team: r.team.name, p: r.a.n, w: r.a.w, d: r.a.d, l: r.a.l, gf: r.a.g, ga: r.a.ga, pts: r.a.pts, xg: r2a(r.a.xg), xga: r2a(r.a.xga) })); },
  },
  {
    name: 'team_metric_all_teams', description: 'One team metric for every team, sorted best first, over the current Matches/Venue/Competition filters. metric is a key from the metric list in the prompt. Returns [{team, value, rank}].',
    inputSchema: { type: 'object', properties: { metric: { type: 'string' } }, required: ['metric'] },
    execute: (i) => {
      const mt = TM[String(i.metric)];
      if (!mt) throw new Error('Unknown metric. Use one of: ' + Object.keys(TM).join(', '));
      progress('Comparing teams: ' + mt.l + '…');
      const rows = leagueAggs().map((r) => ({ team: r.team.name, value: r2a(mt.f(r.a)) })).filter((r) => r.value != null);
      rows.sort((a, b) => (mt.dir === -1 ? a.value - b.value : b.value - a.value));
      return { metric: mt.l + (mt.u ? ' (' + mt.u + ')' : ''), higher_is_better: mt.dir !== -1, rows: rows.map((r, k) => ({ ...r, rank: k + 1 })) };
    },
  },
  {
    name: 'team_matches', description: 'Every match for one team under the current filters, oldest first: date, competition, round, opponent, venue (H/A/N), score, result, and per-match team stats (xg, xga, shots, shots against, shots on target, possession %, pass completion %, corners, fouls, tackles, interceptions, recoveries, duels won %).',
    inputSchema: { type: 'object', properties: { team: { type: 'string', description: 'Team name' } }, required: ['team'] },
    execute: (i) => {
      const t = findTeam(String(i.team || ''));
      if (!t) throw new Error('No such team in this season. Teams: ' + DB.teams.map((x) => x.name).join(', '));
      progress('Reading ' + t.name + '’s matches…');
      return teamMatches(t.id).map((m) => {
        const s = m.ts[t.id] || {};
        return { date: m.date, comp: m.cup ? m.comp : 'League', round: m.cup ? m.round : m.round, opponent: teamName(oppOf(m, t.id)), venue: venueOf(m, t.id), score: goalsFor(m, t.id) + '-' + goalsAg(m, t.id), result: result(m, t.id),
          xg: r2a(s.xg), xga: r2a(s.xga), shots: r2a(s.sh), shots_against: r2a(s.sha), on_target: r2a(s.sot), possession: r2a(has(s.posT) && has(s.oposT) ? (100 * s.posT) / (s.posT + s.oposT) : NaN), pass_pct: r2a(s.pa ? (100 * s.pc) / s.pa : NaN), corners: r2a(s.cor), fouls: r2a(s.fls), tackles: r2a(s.tkl), interceptions: r2a(s.int), recoveries: r2a(s.rec), duels_won_pct: r2a(s.duel ? (100 * s.duelW) / s.duel : NaN) };
      });
    },
  },
  {
    name: 'players', description: 'Player totals under the current filters. Optional team (name), group (GK, DEF, MID, FWD), min_minutes, sort_by (a field below, e.g. aerW), per90 (sort by sort_by per 90 minutes) and limit (default 40, max 80). Returns rows sorted by sort_by (else minutes), highest first, each with name, team, position and totals (min, n apps, st starts, g, ast, xg, xa, sh, sot, key passes, bcc big chances created, pa passes, pc completed, tkl, tklW tackles won, int, rec, clr, blk, duel, duelW, aerW/aerL headers won/lost, drb, drbW, fls, yc, saves, gaK conceded, cs, onG/onGA team goals while on, rating). Divide by min and multiply by 90 for per-90 numbers.',
    inputSchema: { type: 'object', properties: { team: { type: 'string' }, group: { type: 'string', enum: ['GK', 'DEF', 'MID', 'FWD'] }, min_minutes: { type: 'number' }, sort_by: { type: 'string' }, per90: { type: 'boolean' }, limit: { type: 'number' } } },
    execute: (i) => {
      const t = i.team ? findTeam(String(i.team)) : null;
      if (i.team && !t) throw new Error('No such team. Teams: ' + DB.teams.map((x) => x.name).join(', '));
      const minM = Number(i.min_minutes) || 0, g = i.group ? String(i.group).toUpperCase() : null;
      progress('Reading player stats' + (t ? ' for ' + t.name : ' for the league') + '…');
      const rows = Object.values(DB.players).filter((p) => (!t || p.team === t.id) && (!g || p.group === g) && DB.teamById[p.team] && !DB.teamById[p.team].nonLeague)
        .map((p) => ({ p, a: aggPlayer(scoped(p.team, leagueRange()), p.id) })).filter((x) => x.a.min > 0 && x.a.min >= minM)
        .map((x) => ({ ...x, key: !i.sort_by ? x.a.min : String(i.sort_by) === 'rating' ? (x.a.rtN ? x.a.rt / x.a.rtN : -1) : has(x.a[String(i.sort_by)]) ? (i.per90 ? (x.a[String(i.sort_by)] * 90) / x.a.min : x.a[String(i.sort_by)]) : -1 }))
        .sort((x, y) => y.key - x.key).slice(0, Math.min(80, Math.max(1, Number(i.limit) || 40)));
      return rows.map((x) => playerRow(x.p, x.a));
    },
  },
  {
    name: 'player_matches', description: 'One player, match by match under the current filters: date, opponent, minutes and that match’s stats (rating, goals, assists, shots, key passes, passes completed, tackles, interceptions, recoveries, duels won, headers won).',
    inputSchema: { type: 'object', properties: { player: { type: 'string', description: 'Player name' } }, required: ['player'] },
    execute: (i) => {
      const p = findPlayer(i.player);
      if (!p) throw new Error('No player matching "' + i.player + '"');
      progress('Reading ' + p.name + '’s matches…');
      const ms = scoped(p.team).filter((m) => m.ps && m.ps[p.id]);
      if (!ms.length) return { player: p.name, team: teamName(p.team), note: 'No match-by-match stats for this player in this data (season totals only).', totals: playerRow(p, aggPlayer(scoped(p.team), p.id)) };
      return { player: p.name, team: teamName(p.team), matches: ms.map((m) => { const s = m.ps[p.id]; return { date: m.date, opponent: teamName(oppOf(m, p.team)), venue: venueOf(m, p.team), min: s.min, rating: s.rtN ? r2a(s.rt / s.rtN) : null, g: r2a(s.g), ast: r2a(s.ast), sh: r2a(s.sh), key: r2a(s.key), pc: r2a(s.pc), tkl: r2a(s.tkl), int: r2a(s.int), rec: r2a(s.rec), duelW: r2a(s.duelW), aerW: r2a(s.aerW) }; }) };
    },
  },
];

function askPrompt(q) {
  const metrics = TEAM_METRICS.filter((m) => leagueAggs().some((r) => has(m.f(r.a)))).map((m) => `${m.k} = ${m.l}${m.u ? ' (' + m.u + ')' : ''}`).join('; ');
  return [
    'You are the analyst inside Touchline Lab, a football stats app. Answer the user’s question with a custom table and/or chart built ONLY from numbers returned by the tools. Never invent, estimate or recall numbers from memory; if the data cannot answer the question, say so in the summary and return no table.',
    '',
    'Data on screen: ' + DB.label + (DB.season ? ' (season ' + DB.season + ')' : '') + '. It has ' + dataHas() + '.',
    'Current filters (the tools already apply them): team ' + teamName(S.team) + '; matches ' + rangeLabel() + '; venue ' + S.venue + '; competition ' + (S.comp === 'league' ? 'league only' : S.comp === 'cups' ? 'cups only' : 'all competitions') + '.',
    'Teams: ' + DB.teams.map((t) => t.name).join(', ') + '.',
    'Team metric keys for team_metric_all_teams: ' + metrics + '.',
    'Per-90 = total × 90 ÷ minutes. Round to sensible precision. When filtering players by minutes, say the threshold. For league-wide player rankings, call players with sort_by (and per90) rather than reading everyone.',
    'Only the season on screen is available; if the question needs another season, say the user should pick it with Season at the top and ask again.',
    '',
    'Reply with only one JSON object of this shape:',
    '{"title": "short title", "summary": "1-3 plain sentences answering the question", "table": {"columns": ["Player", "Min", "Ball wins /90"], "rows": [["Name", 812, 9.4]]} or null, "chart": {"type": "bar" or "line", "labels": ["..."], "series": [{"name": "...", "values": [1.2]}]} or null, "note": "optional caveat about the data, or empty"}',
    'Keep tables to 30 rows or fewer. A chart’s series values must line up with its labels. Use a line chart for match-by-match or over-time data, a bar chart for rankings.',
    '',
    'Question: ' + q,
  ].join('\n');
}

/* ---------- Rendering an answer ---------- */
function askAnswer(ans) {
  const out = h('div', { class: 'ask-answer' });
  if (ans.summary) out.append(h('p', { class: 'ask-summary', text: String(ans.summary) }));
  const ch = ans.chart;
  if (ch && Array.isArray(ch.labels) && Array.isArray(ch.series) && ch.labels.length && ch.series.length) {
    const labels = ch.labels.slice(0, 60).map(String);
    const pal = [css('--team-a'), css('--ink-2'), css('--c1'), css('--c3'), css('--c2')];
    const series = ch.series.slice(0, 5).map((s, i) => ({ name: String(s.name || 'Series ' + (i + 1)), color: pal[i], dash: i === 1 ? '5 4' : null, values: labels.map((_, k) => { const v = Number((s.values || [])[k]); return Number.isFinite(v) ? v : NaN; }) }));
    if (ch.type === 'line' && labels.length > 1) {
      const box = h('div');
      out.append(box);
      const all = series.flatMap((s) => s.values).filter(has);
      const zero = all.length && Math.min(...all) >= 0 && Math.min(...all) < 0.35 * Math.max(...all);
      setTimeout(() => lineChart(box, { labels, series, zero, yFmt: (v) => (Math.abs(v) >= 10 ? v.toFixed(0) : v.toFixed(1)), tipFor: (k) => [{ v: labels[k], strong: true }].concat(series.map((s) => ({ color: s.color, v: fmt(s.values[k], 2), l: s.name }))) }), 0);
      out.append(legend(series.map((s) => [s.name, s.color, s.dash ? 'line line-dash' : 'line'])));
    } else {
      const max = Math.max(...series.flatMap((s) => s.values).filter(has).map(Math.abs), 1e-9);
      out.append(h('div', { class: 'ask-bars' }, labels.map((l, k) => h('div', { class: 'ask-bar' }, h('span', { class: 'ask-bar-l', text: l }),
        h('span', { class: 'ask-bar-t' }, series.map((s) => h('i', { style: { width: (has(s.values[k]) ? (100 * Math.abs(s.values[k])) / max : 0) + '%', background: s.color } }))),
        h('span', { class: 'ask-bar-v', text: series.map((s) => fmt(s.values[k], Math.abs(s.values[k]) >= 10 ? 0 : 2)).join(' · ') })))));
      if (series.length > 1) out.append(legend(series.map((s) => [s.name, s.color])));
    }
  }
  const tb = ans.table;
  if (tb && Array.isArray(tb.columns) && Array.isArray(tb.rows) && tb.rows.length) {
    const cols = tb.columns.slice(0, 12).map(String), rows = tb.rows.slice(0, 200).filter(Array.isArray);
    const csv = [cols].concat(rows).map((r) => r.map((c) => { const v = c == null ? '' : String(c); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }).join(',')).join('\n');
    const copy = h('button', { class: 'btn ghost', type: 'button', style: { padding: '3px 10px', fontSize: '12.5px' }, text: 'Copy as CSV' });
    copy.addEventListener('click', async () => { try { await navigator.clipboard.writeText(csv); copy.textContent = 'Copied'; } catch (e) { copy.textContent = 'Copy not allowed here'; } });
    out.append(h('div', { class: 'tbl-wrap', style: { marginTop: '12px' } }, h('table', null,
      h('thead', null, h('tr', null, cols.map((c, i) => h('th', { class: i === 0 ? 'l' : '', text: c })))),
      h('tbody', null, rows.map((r) => h('tr', { style: { cursor: 'default' } }, cols.map((_, i) => { const v = r[i]; return h('td', { class: i === 0 ? 'l' : '', text: v == null ? '' : typeof v === 'number' ? String(Math.round(v * 100) / 100) : String(v) }); })))))), h('div', { style: { marginTop: '8px' } }, copy));
  }
  if (ans.note) out.append(h('p', { class: 'note', text: String(ans.note) }));
  return out;
}

function viewAsk(el) {
  askInit();
  el.append(h('div', { class: 'hero' }, h('h1', { text: 'Ask AI' }), h('div', { class: 'meta' }, h('span', { text: 'Custom tables and charts from the data loaded here · ' + DB.label }))));
  const s = ASK.sample;
  const st = h('div', { class: 'status', role: 'status' });
  const ta = h('textarea', { id: 'ask-q', rows: 3, placeholder: 'e.g. Top 10 Aberdeen players by ball wins per 90', spellcheck: 'true' });
  const ask = h('button', { class: 'btn', type: 'button', text: 'Ask' });
  const stop = h('button', { class: 'btn ghost', type: 'button', text: 'Stop', hidden: true });
  const result = h('div');
  const unavailable = (msg) => { ask.disabled = true; ta.disabled = true; st.className = 'status'; st.textContent = msg; };
  const run = async () => {
    const q = ta.value.trim();
    if (!q || ASK.busy) return;
    const ctl = new AbortController();
    ASK.busy = ctl;
    ask.disabled = true; stop.hidden = false; result.replaceChildren();
    st.className = 'status'; st.textContent = 'Thinking… (the first question asks your permission; answers take up to a minute)';
    const progress = (t) => { st.textContent = t; };
    const useTools = !ASK.limits || !!ASK.limits.tools;
    try {
      const opts = { signal: ctl.signal };
      if (useTools) opts.tools = ASK_TOOLS(progress); else opts.cache = false;
      const ans = await s.json(useTools ? askPrompt(q) : askPrompt(q) + askData(), opts);
      if (!ans || typeof ans !== 'object') throw { code: 'invalid_json' };
      st.textContent = '';
      ASK.history.unshift({ q, ans, at: Date.now(), on: DB.label });
      ASK.history = ASK.history.slice(0, 8);
      askSave();
      result.append(card({ title: String(ans.title || q).slice(0, 120), span: true }, q, askAnswer(ans)));
    } catch (e) {
      const code = e && e.code;
      if (code === 'cancelled') st.textContent = 'Stopped.';
      else if (code === 'not_granted' || code === 'sampling_disabled' || code === 'not_declared' || code === 'capability_disabled') unavailable('Claude is not available to this page (permission declined or not enabled for this account).');
      else if (code === 'rate_limited') { st.className = 'status err'; st.textContent = 'Too many questions just now, or your Claude usage limit is reached. Try again later.'; }
      else if (code === 'invalid_json') { st.className = 'status err'; st.textContent = 'The answer came back in the wrong shape. Try asking again, or more simply.'; }
      else if (code === 'refused') { st.className = 'status err'; st.textContent = 'Claude declined that question. Try rewording it.'; }
      else if (code === 'tools_unavailable') unavailable('This Claude app can’t give the AI access to the data yet. Try the claude.ai website or an updated app.');
      else { st.className = 'status err'; st.textContent = 'Something went wrong reaching Claude. Try again.'; }
    } finally {
      if (ASK.busy === ctl) ASK.busy = null;
      if (!ta.disabled) ask.disabled = false;
      stop.hidden = true;
    }
  };
  ask.addEventListener('click', run);
  stop.addEventListener('click', () => ASK.busy && ASK.busy.abort());
  ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) run(); });
  const chips = h('div', { class: 'ask-chips' }, ASK_EXAMPLES.map((x) => h('button', { type: 'button', class: 'ask-chip', onclick: () => { ta.value = x; ta.focus(); }, text: x })));
  el.append(card({ title: 'Ask a question', span: true }, 'Claude reads the data loaded in the app through read-only tools, using the Season, Team, Competition, Venue and Matches filters at the top, and builds a table or chart from what it finds',
    h('div', { class: 'field' }, h('label', { for: 'ask-q', text: 'Your question' }), ta), chips,
    h('div', { style: { display: 'flex', gap: '8px', marginTop: '10px', flexWrap: 'wrap' } }, ask, stop), st,
    h('p', { class: 'note', text: 'Uses your own Claude account and usage; the first question asks your permission. Answers only use numbers in this app, so anything the data lacks (player xG, off-the-ball work) can’t be answered. Check anything important against the other tabs.' })));
  el.append(result);
  if (ASK.state === 'pending') unavailable('Connecting to Claude…');
  else if (ASK.state === 'none') unavailable('Ask AI needs the page opened on claude.ai or in the Claude app, signed in. It isn’t available in this view.');
  if (ASK.history.length) {
    const hist = h('div', { class: 'stack' });
    ASK.history.forEach((x) => hist.append(card({ title: String(x.ans.title || x.q).slice(0, 120), span: true }, x.q + ' · ' + new Date(x.at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) + (x.on !== DB.label ? ' · on ' + x.on : ''), askAnswer(x.ans))));
    el.append(h('div', { class: 'eyebrow', style: { margin: '18px 0 8px' }, text: 'Earlier answers (kept in this browser)' }), hist,
      h('button', { class: 'btn ghost', type: 'button', style: { marginTop: '10px' }, text: 'Clear earlier answers', onclick: () => { ASK.history = []; askSave(); render(); } }));
  }
}
