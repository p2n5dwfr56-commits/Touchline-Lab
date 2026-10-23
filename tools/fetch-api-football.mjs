#!/usr/bin/env node
/*
  Download a league season from API-Football for Touchline Lab.

  Needs Node 18 or newer (no packages to install) and a free key from
  https://dashboard.api-football.com (or a RapidAPI key with --rapidapi).

    API_FOOTBALL_KEY=your_key node tools/fetch-api-football.mjs --season 2025
    API_FOOTBALL_KEY=your_key node tools/fetch-api-football.mjs --find "Premiership"

  Options
    --league <id>   League id (default 179, Scottish Premiership). Use --find to look one up.
    --season <year> Season start year, e.g. 2025 for 2025/26 (default: current season).
    --out <file>    Output file (default: api-football-<league>-<season>.json).
    --find <text>   List leagues matching the text, with their ids and seasons, then stop.
    --rapidapi      Use a RapidAPI key and host instead of api-sports.io.

  Cost: one request for the fixture list, then one per 20 finished matches
  (a 33-round, 12-team season is about 11 requests). The free plan allows
  100 requests a day and 10 a minute, so the script pauses between calls.
  Free plans can be limited to certain seasons; the script prints the API's
  message if a season is not available.
*/
import { writeFile } from 'node:fs/promises';

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : def; };
const flag = (name) => args.includes('--' + name);

const key = process.env.API_FOOTBALL_KEY;
if (!key) {
  console.error('Set your key first, e.g.  API_FOOTBALL_KEY=abc123 node tools/fetch-api-football.mjs --season 2025');
  process.exit(1);
}
const rapid = flag('rapidapi');
const BASE = rapid ? 'https://api-football-v1.p.rapidapi.com/v3' : 'https://v3.football.api-sports.io';
const headers = rapid ? { 'x-rapidapi-key': key, 'x-rapidapi-host': 'api-football-v1.p.rapidapi.com' } : { 'x-apisports-key': key };

let calls = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function api(path) {
  if (calls++) await sleep(6500); // stay under 10 requests a minute
  let res;
  try { res = await fetch(BASE + path, { headers }); }
  catch (e) { throw new Error(`could not reach ${new URL(BASE).host} (${(e.cause && e.cause.code) || e.message}). Check your internet connection.`); }
  if (res.status === 401 || res.status === 403) throw new Error('the API rejected the key. Check API_FOOTBALL_KEY (use --rapidapi for a RapidAPI key).');
  const left = res.headers.get('x-ratelimit-requests-remaining');
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${path}`);
  const json = await res.json();
  const errs = json.errors && (Array.isArray(json.errors) ? json.errors : Object.values(json.errors));
  if (errs && errs.length) throw new Error(`API said: ${errs.join('; ')}`);
  console.log(`  ${path}  →  ${json.results} result(s)${left != null ? `, ${left} requests left today` : ''}`);
  return json.response || [];
}

async function main() {
  const find = opt('find');
  if (find) {
    const leagues = await api('/leagues?search=' + encodeURIComponent(find));
    leagues.forEach((l) => {
      const seasons = (l.seasons || []).map((s) => s.year + (s.coverage && s.coverage.fixtures && s.coverage.fixtures.lineups ? '' : '*')).join(', ');
      console.log(`${String(l.league.id).padStart(5)}  ${l.league.name} (${l.country.name})  seasons: ${seasons}`);
    });
    console.log('* = no line-up coverage for that season');
    return;
  }
  const league = Number(opt('league', 179));
  const now = new Date();
  const season = Number(opt('season', now.getUTCMonth() >= 6 ? now.getUTCFullYear() : now.getUTCFullYear() - 1));
  const out = opt('out', `api-football-${league}-${season}.json`);

  console.log(`Fetching league ${league}, season ${season}/${(season + 1) % 100}`);
  const list = await api(`/fixtures?league=${league}&season=${season}`);
  const done = list.filter((f) => ['FT', 'AET', 'PEN'].includes(f.fixture.status.short));
  console.log(`${list.length} fixtures, ${done.length} finished`);
  if (!done.length) { console.log('Nothing to download yet.'); return; }

  const full = [];
  for (let i = 0; i < done.length; i += 20) {
    const ids = done.slice(i, i + 20).map((f) => f.fixture.id).join('-');
    full.push(...(await api('/fixtures?ids=' + ids))); // includes events, line-ups, statistics and players
  }
  const bundle = { source: 'api-football', league, season, fetched: new Date().toISOString(), fixtures: full };
  await writeFile(out, JSON.stringify(bundle));
  console.log(`\nSaved ${full.length} matches to ${out} (${calls} requests).`);
  console.log('Open Touchline Lab, go to the Data tab and drop this file in.');
}

main().catch((e) => { console.error('\nStopped: ' + e.message); process.exit(1); });
