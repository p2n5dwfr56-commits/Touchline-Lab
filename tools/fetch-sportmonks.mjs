#!/usr/bin/env node
/*
  Download a league season from Sportmonks (Football API v3) for Touchline Lab.

  Needs Node 18 or newer and a token from https://my.sportmonks.com (the free plan
  covers the Scottish Premiership and the Danish Superliga).

    SPORTMONKS_TOKEN=your_token node tools/fetch-sportmonks.mjs
    SPORTMONKS_TOKEN=your_token node tools/fetch-sportmonks.mjs --league 501 --season 28275 --out sm.json

  Options
    --league <id>   League id (default 501, Scottish Premiership).
    --season <id>   Season id (default: the league's current season).
    --out <file>    Output file (default: sportmonks-<league>-<season>.json).
    --list-seasons  List the league's seasons and their ids (free plan: past seasons included).

  Saves line-ups (with formation positions), formations, events (goals, assists, cards,
  substitutions), team statistics and per-player match statistics for every finished
  match, plus the remaining fixtures. A season to date is a handful of requests; the
  free plan allows 180 an hour.
*/
import { writeFile } from 'node:fs/promises';

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : def; };
const token = process.env.SPORTMONKS_TOKEN;
if (!token) { console.error('Set your token first, e.g.  SPORTMONKS_TOKEN=abc123 node tools/fetch-sportmonks.mjs'); process.exit(1); }
const BASE = 'https://api.sportmonks.com/v3/football';
const INCLUDES = 'participants;scores;state;venue;statistics.type;lineups.details.type;events.type;formations';

let calls = 0;
async function api(path) {
  calls++;
  let res;
  try { res = await fetch(BASE + path, { headers: { Authorization: token, Accept: 'application/json' } }); }
  catch (e) { throw new Error(`could not reach api.sportmonks.com (${(e.cause && e.cause.code) || e.message}). Check your internet connection.`); }
  const json = await res.json().catch(() => ({}));
  if (res.status === 401) throw new Error('Sportmonks rejected the token. Check SPORTMONKS_TOKEN.');
  if (!res.ok) throw new Error(`Sportmonks said: ${json.message || 'HTTP ' + res.status}`);
  const rl = json.rate_limit;
  console.log(`  ${path.split('?')[0]}  →  ${Array.isArray(json.data) ? json.data.length + ' result(s)' : 'ok'}${rl ? `, ${rl.remaining} requests left this hour` : ''}`);
  return json;
}
const day = (d) => d.toISOString().slice(0, 10);

async function main() {
  const league = Number(opt('league', 501));
  if (args.includes('--list-seasons')) {
    const r = await api(`/seasons?filters=seasonLeagues:${league}&per_page=50`);
    r.data.sort((a, b) => b.name.localeCompare(a.name)).forEach((x) => console.log(`  --season ${x.id}`.padEnd(18), x.name + (x.is_current ? '  (current)' : '')));
    return;
  }
  let season = opt('season');
  const lg = (await api(`/leagues/${league}?include=currentSeason`)).data;
  if (!season) season = lg.currentseason && lg.currentseason.id;
  if (!season) throw new Error('No current season for this league; pass --season.');
  const s = (await api(`/seasons/${season}`)).data;
  const out = opt('out', `sportmonks-${league}-${season}.json`);
  console.log(`Fetching ${lg.name} ${s.name}`);

  // The API allows at most 100 days per date range, so walk the season in chunks
  const start = new Date(s.starting_at + 'T00:00:00Z'), end = new Date(s.ending_at + 'T00:00:00Z');
  const raw = [];
  for (let a = new Date(start); a <= end; a = new Date(a.getTime() + 100 * 864e5)) {
    const b = new Date(Math.min(a.getTime() + 99 * 864e5, end.getTime()));
    for (let page = 1; ; page++) {
      const j = await api(`/fixtures/between/${day(a)}/${day(b)}?filters=fixtureLeagues:${league}&include=${INCLUDES}&per_page=25&page=${page}`);
      raw.push(...(j.data || []).filter((f) => f.season_id === Number(season)));
      if (!j.pagination || !j.pagination.has_more) break;
    }
  }

  // Compact form: only what Touchline Lab reads, with stat type names listed once
  const types = {};
  const T = (t) => { if (t && t.id && !types[t.id]) types[t.id] = t.name; };
  const finished = (f) => f.state && ['FT', 'AET', 'FT_PEN'].includes(f.state.developer_name);
  const fixtures = raw.sort((x, y) => x.starting_at.localeCompare(y.starting_at)).map((f) => {
    const side = (loc) => { const p = (f.participants || []).find((x) => x.meta && x.meta.location === loc); return p ? { id: p.id, name: p.name } : null; };
    const goals = (loc) => { const sc = (f.scores || []).find((x) => x.description === 'CURRENT' && x.score && x.score.participant === loc); return sc ? sc.score.goals : null; };
    const fx = { id: f.id, date: f.starting_at, state: f.state && f.state.developer_name, venue: f.venue && f.venue.name, round: f.round_id, home: side('home'), away: side('away') };
    if (!finished(f)) return fx;
    fx.score = { home: goals('home'), away: goals('away') };
    fx.formations = Object.fromEntries((f.formations || []).map((x) => [x.participant_id, x.formation]));
    fx.stats = (f.statistics || []).map((x) => { T(x.type); return { team: x.participant_id, type: x.type_id, value: x.data && x.data.value }; });
    fx.lineups = (f.lineups || []).map((l) => {
      const d = {};
      (l.details || []).forEach((x) => { T(x.type); const v = x.data && x.data.value; if (typeof v === 'number') d[x.type_id] = v; });
      return { team: l.team_id, player: l.player_id, name: l.player_name, num: l.jersey_number, pos: l.position_id, field: l.formation_field, starter: l.type_id === 11, d };
    });
    fx.events = (f.events || []).map((e) => { T(e.type); return { min: e.minute, extra: e.extra_minute, type: e.type && e.type.name, team: e.participant_id, player: e.player_id, name: e.player_name, rel: e.related_player_id, relName: e.related_player_name, info: e.info, addition: e.addition }; });
    return fx;
  });
  const bundle = { source: 'sportmonks', league: { id: league, name: lg.name }, season: { id: Number(season), name: s.name }, fetched: new Date().toISOString(), types, fixtures };
  await writeFile(out, JSON.stringify(bundle));
  const done = fixtures.filter((f) => f.score).length;
  console.log(`\nSaved ${out}: ${done} finished matches, ${fixtures.length - done} upcoming (${calls} requests).`);
  console.log('Open Touchline Lab, go to the Data tab and drop this file in (after loading the season file).');
}
main().catch((e) => { console.error('\nStopped: ' + e.message); process.exit(1); });
