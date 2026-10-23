#!/usr/bin/env node
/*
  Download match event data from the Wyscout (Hudl) API v3 for Touchline Lab, and convert it to
  one compact file the app reads: every event with its pitch position, Wyscout xG, line-ups,
  formations and substitutions. Needs a Wyscout API subscription (username and password).

    WYSCOUT_USER=you WYSCOUT_PASS=secret node tools/fetch-wyscout.mjs --find "Premiership"
    WYSCOUT_USER=you WYSCOUT_PASS=secret node tools/fetch-wyscout.mjs --competition <id> --list-seasons
    WYSCOUT_USER=you WYSCOUT_PASS=secret node tools/fetch-wyscout.mjs --season <seasonId> --team Aberdeen

  Options
    --find <text>        Search competitions by name and print their ids.
    --competition <id>   With --list-seasons: list that competition's seasons.
    --season <id>        Season to download (all its played matches).
    --team <name>        Only matches involving this team.
    --max <n>            At most n matches.
    --out <file>         Output (default wyscout-<season>.json).
    --raw <folder>       Also keep each match's raw API response (one JSON per match).

  Or convert files you already have (raw /v3/matches/{id}/events responses with
  fetch=teams,players,match,substitutions,formations):
    node tools/fetch-wyscout.mjs --convert folder/with/match/files --out wyscout.json

  Downloaded matches are cached in wyscout-cache/, so a re-run only fetches new ones.
  Check your Wyscout licence before sharing the output.
*/
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; };
const flag = (n) => args.includes('--' + n);
const BASE = 'https://apirest.wyscout.com/v3';
const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

function app() {
  const ctx = vm.createContext({ console });
  vm.runInContext(['engine.js', 'wyscout.js'].map((f) => readFileSync(join(SRC, f), 'utf8').replace(/^'use strict';/m, '')).join('\n;\n') + ';globalThis.__api = { importWyscout };', ctx);
  return ctx.__api;
}
function writeBundle(raws, label, out) {
  const { db, errors } = app().importWyscout(raws.map((d, i) => ({ name: 'm' + i + '.json', data: d })));
  if (errors.length) console.warn('Skipped:', errors.join('; '));
  db.matches.forEach((m) => m.events.forEach((e, i) => { e.id = i; }));
  const bundle = { source: 'touchline-events', v: 1, label, attribution: 'Wyscout (Hudl)', fetched: new Date().toISOString(), with360: 0, db: { ...db, label: 'Wyscout · ' + label } };
  writeFileSync(out, JSON.stringify(bundle));
  console.log(`Wrote ${out}: ${db.matches.length} matches. Drop it into the Data tab.`);
}

async function main() {
  const conv = opt('convert');
  if (conv) {
    const files = readdirSync(conv).filter((f) => f.endsWith('.json'));
    const raws = files.map((f) => JSON.parse(readFileSync(join(conv, f), 'utf8')));
    writeBundle(raws, opt('label', 'Wyscout matches'), opt('out', 'wyscout.json'));
    return;
  }
  const user = process.env.WYSCOUT_USER, pass = process.env.WYSCOUT_PASS;
  if (!user || !pass) { console.error('Set WYSCOUT_USER and WYSCOUT_PASS (your Wyscout API credentials) first.'); process.exit(1); }
  const auth = 'Basic ' + Buffer.from(user + ':' + pass).toString('base64');
  let calls = 0;
  const api = async (path) => {
    if (calls++) await new Promise((r) => setTimeout(r, 700)); // gentle on the rate limit
    const r = await fetch(BASE + path, { headers: { Authorization: auth, Accept: 'application/json' } });
    if (r.status === 401 || r.status === 403) throw new Error('Wyscout rejected the credentials, or your plan does not include this (' + path + ').');
    if (!r.ok) throw new Error('HTTP ' + r.status + ' for ' + path);
    return r.json();
  };
  if (opt('find')) {
    const r = await api('/search?query=' + encodeURIComponent(opt('find')) + '&objType=competition');
    (r || []).forEach((c) => console.log(String(c.wyId).padStart(7), c.name, c.area ? '(' + c.area.name + ')' : ''));
    return;
  }
  if (flag('list-seasons')) {
    const r = await api('/competitions/' + opt('competition') + '/seasons');
    ((r && r.seasons) || []).forEach((x) => { const s = x.season || x; console.log(String(s.wyId).padStart(7), s.name, s.active ? '(current)' : ''); });
    return;
  }
  const season = opt('season');
  if (!season) { console.error('Pass --season <id> (find it with --find and --list-seasons).'); process.exit(1); }
  const list = await api('/seasons/' + season + '/matches');
  let ms = (list.matches || []).filter((m) => /played/i.test(m.status || 'Played'));
  const team = opt('team');
  if (team) ms = ms.filter((m) => String(m.label || '').toLowerCase().includes(team.toLowerCase()));
  if (opt('max')) ms = ms.slice(0, Number(opt('max')));
  console.log(`${ms.length} matches to fetch`);
  mkdirSync('wyscout-cache', { recursive: true });
  const raws = [];
  for (const m of ms) {
    const id = m.matchId || m.wyId, f = join('wyscout-cache', id + '.json');
    let d;
    if (existsSync(f)) d = JSON.parse(readFileSync(f, 'utf8'));
    else { d = await api(`/matches/${id}/events?fetch=teams,players,match,substitutions,formations`); writeFileSync(f, JSON.stringify(d)); }
    if (opt('raw')) { mkdirSync(opt('raw'), { recursive: true }); writeFileSync(join(opt('raw'), id + '.json'), JSON.stringify(d)); }
    console.log('  ', m.label || id);
    raws.push(d);
  }
  writeBundle(raws, opt('label', (team ? team + ' · ' : '') + 'season ' + season), opt('out', `wyscout-${season}.json`));
}
main().catch((e) => { console.error(e.message); process.exit(1); });
