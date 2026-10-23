#!/usr/bin/env node
/*
  Downloads matches from StatsBomb Open Data (free, no account) and writes one compact file
  for Touchline Lab: every event with pitch locations, plus 360 player positions at the moment
  each possession is lost, where StatsBomb has them.

    node tools/fetch-statsbomb.mjs --list
    node tools/fetch-statsbomb.mjs --competition 55 --season 282
    node tools/fetch-statsbomb.mjs --competition 55 --season 282 --teams "Scotland,Germany,Hungary,Switzerland"

  Options:
    --list              Competitions and seasons (360 data marked).
    --competition <id>  Competition id (55 = UEFA Euro).
    --season <id>       Season id (282 = 2024).
    --teams "A,B"       Only matches where both teams are in this list (e.g. one group).
    --team "A"          Only matches involving this team.
    --max <n>           At most n matches.
    --label "text"    Name shown in the app (default: competition, season and team filter).
    --out <file>        Output file (default statsbomb-<competition>-<season>.json).

  Then drop the file into the Data tab. Data: StatsBomb, https://github.com/statsbomb/open-data
  (free to use with attribution, see their licence).
*/
import fs from 'fs';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { importStatsBomb } = require('../src/engine.js');
const BASE = 'https://raw.githubusercontent.com/statsbomb/open-data/master/data/';
const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : def; };

async function get(path, optional) {
  for (let a = 0; a < 4; a++) {
    try {
      const r = await fetch(BASE + path);
      if (r.status === 404 && optional) return null;
      if (!r.ok) throw new Error(r.status + ' ' + r.statusText);
      return await r.json();
    } catch (e) {
      if (a === 3) throw new Error(path + ': ' + e.message);
      await new Promise((res) => setTimeout(res, 2000 * 2 ** a));
    }
  }
}

async function main() {
  const comps = await get('competitions.json');
  if (args.includes('--list')) {
    comps.forEach((c) => console.log(`--competition ${c.competition_id} --season ${c.season_id}`.padEnd(34), `${c.competition_name} ${c.season_name}${c.match_available_360 ? '  [360]' : ''}`));
    return;
  }
  const cid = opt('competition'), sid = opt('season');
  if (!cid || !sid) { console.error('Pass --competition and --season (see --list).'); process.exit(1); }
  const comp = comps.find((c) => String(c.competition_id) === cid && String(c.season_id) === sid);
  if (!comp) { console.error('No such competition/season in StatsBomb Open Data. See --list.'); process.exit(1); }
  let matches = await get(`matches/${cid}/${sid}.json`);
  const name = (m, s) => m[s + '_team'][s + '_team_name'];
  const teams = opt('teams') ? opt('teams').split(',').map((s) => s.trim().toLowerCase()) : null;
  const team = opt('team') ? opt('team').toLowerCase() : null;
  if (teams) matches = matches.filter((m) => teams.includes(name(m, 'home').toLowerCase()) && teams.includes(name(m, 'away').toLowerCase()));
  if (team) matches = matches.filter((m) => [name(m, 'home'), name(m, 'away')].some((n) => n.toLowerCase() === team));
  matches.sort((a, b) => a.match_date.localeCompare(b.match_date));
  if (opt('max')) matches = matches.slice(0, Number(opt('max')));
  if (!matches.length) { console.error('No matches left after the team filter.'); process.exit(1); }
  console.log(`${comp.competition_name} ${comp.season_name}: ${matches.length} matches`);

  const files = [{ name: 'matches.json', data: matches }];
  let with360 = 0;
  for (const m of matches) {
    const ev = await get(`events/${m.match_id}.json`);
    const ff = comp.match_available_360 ? await get(`three-sixty/${m.match_id}.json`, true) : null;
    files.push({ name: m.match_id + '.json', data: ev });
    if (ff && ff.length) { files.push({ name: m.match_id + '.json', data: ff }); with360++; }
    console.log(`  ${m.match_date} ${name(m, 'home')} ${m.home_score}-${m.away_score} ${name(m, 'away')}${ff && ff.length ? ' (360)' : ''}`);
  }
  const { db, errors } = importStatsBomb(files);
  if (errors.length) console.warn('Skipped:', errors.join(', '));
  // Compact: short event ids, coordinates to 0.1 yd
  const r1 = (v) => (typeof v === 'number' ? Math.round(v * 10) / 10 : v);
  db.matches.forEach((m) => m.events.forEach((e, i) => {
    e.id = i;
    ['x', 'y', 'ex', 'ey'].forEach((k) => { if (k in e) e[k] = r1(e[k]); });
    if (e.xg != null) e.xg = Math.round(e.xg * 1000) / 1000;
    if (e.xa != null) e.xa = Math.round(e.xa * 1000) / 1000;
  }));
  const label = opt('label') || `${comp.competition_name} ${comp.season_name}` + (teams || team ? ' · ' + (opt('teams') || opt('team')) : '');
  const out = opt('out', `statsbomb-${cid}-${sid}.json`);
  const bundle = { source: 'touchline-events', v: 1, label, attribution: 'StatsBomb Open Data (github.com/statsbomb/open-data)', fetched: new Date().toISOString(), with360, db: { ...db, label: 'StatsBomb · ' + label } };
  fs.writeFileSync(out, JSON.stringify(bundle));
  console.log(`Wrote ${out} (${(fs.statSync(out).size / 1e6).toFixed(1)} MB, ${db.matches.length} matches, ${with360} with 360 positions).`);
}
main().catch((e) => { console.error(e.message); process.exit(1); });
