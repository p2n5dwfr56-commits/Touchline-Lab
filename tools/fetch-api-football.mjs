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
    --team <name>   Download this team's matches first (default Aberdeen; name or id).
    --max <n>       Download at most n matches this run.
    --rapidapi      Use a RapidAPI key and host instead of api-sports.io.

  Cost: one request for the fixture list, then the match details. Paid plans
  fetch 20 matches per request (a full season in about 12). The free plan
  allows one match per request, 100 requests a day and only some seasons, so a
  full season takes about three days: re-run the same command each day and it
  picks up where it stopped. Your team's matches are fetched first.
  The script pauses between calls to stay under 10 requests a minute.
*/
import { writeFile, readFile, mkdir, readdir } from 'node:fs/promises';
import { join } from 'node:path';

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

let calls = 0, left = null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function api(path) {
  if (calls++) await sleep(6500); // stay under 10 requests a minute
  let res;
  try { res = await fetch(BASE + path, { headers }); }
  catch (e) { throw new Error(`could not reach ${new URL(BASE).host} (${(e.cause && e.cause.code) || e.message}). Check your internet connection.`); }
  if (res.status === 401 || res.status === 403) throw new Error('the API rejected the key. Check API_FOOTBALL_KEY (use --rapidapi for a RapidAPI key).');
  const rem = res.headers.get('x-ratelimit-requests-remaining');
  if (rem != null) left = Number(rem);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${path}`);
  const json = await res.json();
  const errs = json.errors && (Array.isArray(json.errors) ? json.errors : Object.values(json.errors));
  if (errs && errs.length) throw new Error(`API said: ${errs.join('; ')}`);
  console.log(`  ${path}  →  ${json.results} result(s)${rem != null ? `, ${rem} requests left today` : ''}`);
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

  // Match details are cached one file per match, so re-running only fetches what is missing.
  const cacheDir = opt('cache', join('api-football-cache', `${league}-${season}`));
  await mkdir(cacheDir, { recursive: true });
  const have = new Map();
  for (const f of await readdir(cacheDir)) {
    if (f.endsWith('.json')) { const x = JSON.parse(await readFile(join(cacheDir, f), 'utf8')); have.set(x.fixture.id, x); }
  }
  // Priority team first (default Aberdeen), then everything else by date.
  const team = (opt('team', 'Aberdeen') || '').toLowerCase();
  const isTeam = (f) => team && [f.teams.home, f.teams.away].some((t) => String(t.id) === team || t.name.toLowerCase().includes(team));
  const todo = done.filter((f) => !have.has(f.fixture.id))
    .sort((a, b) => (isTeam(b) - isTeam(a)) || a.fixture.date.localeCompare(b.fixture.date));
  const reserve = Number(opt('reserve', 2));
  const max = Number(opt('max', Infinity));
  console.log(`${have.size} matches already downloaded, ${todo.length} to go`);

  let batch = !flag('single'), fetched = 0;
  const save = async (x) => { have.set(x.fixture.id, x); await writeFile(join(cacheDir, x.fixture.id + '.json'), JSON.stringify(x)); fetched++; };
  for (let i = 0; i < todo.length;) {
    if (fetched >= max || (left != null && left <= reserve)) { console.log(`Stopping to keep ${reserve} requests spare. Run again tomorrow to continue.`); break; }
    try {
      if (batch) {
        const chunk = todo.slice(i, i + 20);
        (await api('/fixtures?ids=' + chunk.map((f) => f.fixture.id).join('-'))).forEach(save); // full detail for up to 20 matches
        i += chunk.length;
      } else {
        const x = (await api('/fixtures?id=' + todo[i].fixture.id))[0];
        if (x) await save(x);
        i++;
      }
    } catch (e) {
      if (batch && /ids parameter/i.test(e.message)) { console.log('  Free plan: fetching one match per request instead.'); batch = false; continue; }
      if (/request limit|too many requests|rateLimit/i.test(e.message)) { console.log('  ' + e.message + ' Run again tomorrow to continue.'); break; }
      // Anything else (for example a suspended account): stop, but still save what was downloaded.
      console.log('\nStopped early: ' + e.message);
      break;
    }
  }
  // Bundle: detailed matches where downloaded, results-only fixtures for the rest (keeps the league table complete).
  const fixtures = done.map((f) => have.get(f.fixture.id) || f);
  const bundle = { source: 'api-football', league, season, fetched: new Date().toISOString(), fixtures };
  await writeFile(out, JSON.stringify(bundle));
  const missing = done.length - done.filter((f) => have.has(f.fixture.id)).length;
  console.log(`\nSaved ${out}: ${done.length - missing} of ${done.length} matches with full detail (${calls} requests this run).`);
  if (missing) console.log(`${missing} matches still to download. Run the same command again tomorrow; downloaded matches are kept in ${cacheDir}.`);
  console.log('Open Touchline Lab, go to the Data tab and drop this file in.');
}

main().catch((e) => { console.error('\nStopped: ' + e.message); process.exit(1); });
