#!/usr/bin/env node
/*
  Brings the built-in data (data/snapshot/) up to date after a round of matches, then rebuilds the page.
  Run through tools/refresh.sh, which sets up the network for Node in the cloud sandbox.

    SPORTMONKS_TOKEN=... tools/refresh.sh --check   # exit 0 if matches have finished since the data's date, 10 if none
    SPORTMONKS_TOKEN=... tools/refresh.sh           # fetch, update the manifest, build dist/index-snapshot.html, smoke test
    tools/refresh.sh --no-fetch                     # rebuild and test only (no token needed)

  Steps: the current Premiership season from Sportmonks (results, line-ups, events, player stats); Aberdeen's
  cup ties for the season from Wikipedia (skipped with a warning if Wikipedia refuses); the manifest's
  "asOf" set to the last finished match; the snapshot build; a browser smoke test.
  football-data.co.uk is not fetched (blocked from the cloud); new league matches come from Sportmonks
  alone until its file is refreshed by hand, so they have no odds, attendance or referee.
*/
import { readFileSync, writeFileSync, existsSync, renameSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(ROOT, 'data', 'snapshot');
const args = process.argv.slice(2);
const token = process.env.SPORTMONKS_TOKEN;
const manPath = join(DIR, 'manifest.json');
if (!existsSync(manPath)) { console.error('No data/snapshot/manifest.json: restore the data first.'); process.exit(2); }
const man = JSON.parse(readFileSync(manPath, 'utf8'));
const smName = (man.layers || []).find((n) => /^sportmonks-501-\d+\.json$/.test(n));
const seasonId = smName && smName.match(/(\d+)\.json$/)[1];
const finished = (b) => b.fixtures.filter((f) => f.score);
const lastPlayed = (b) => finished(b).map((f) => String(f.date).slice(0, 10)).sort().at(-1) || '';
const run = (cmd, a, opts = {}) => execFileSync(cmd, a, { cwd: ROOT, stdio: 'inherit', ...opts });

async function check() {
  if (!token) { console.error('SPORTMONKS_TOKEN is not set.'); process.exit(2); }
  const from = new Date(Date.parse(man.asOf + 'T00:00:00Z') + 864e5).toISOString().slice(0, 10);
  const to = new Date().toISOString().slice(0, 10);
  if (from > to) { console.log(`Data is up to date (${man.asOf}).`); process.exit(10); }
  const r = await fetch(`https://api.sportmonks.com/v3/football/fixtures/between/${from}/${to}?filters=fixtureLeagues:501&include=state;participants&per_page=50`, { headers: { Authorization: token, Accept: 'application/json' } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { console.error('Sportmonks said: ' + (j.message || 'HTTP ' + r.status)); process.exit(2); }
  const done = (j.data || []).filter((f) => f.state && ['FT', 'AET', 'FT_PEN'].includes(f.state.developer_name));
  done.forEach((f) => console.log('  finished: ' + f.starting_at.slice(0, 10) + ' ' + f.name));
  console.log(done.length ? `${done.length} match(es) finished since ${man.asOf}.` : `No matches finished since ${man.asOf}.`);
  process.exit(done.length ? 0 : 10);
}

function refresh() {
  const smPath = join(DIR, smName);
  const before = existsSync(smPath) ? JSON.parse(readFileSync(smPath, 'utf8')) : { fixtures: [] };
  if (!args.includes('--no-fetch')) {
    if (!token) { console.error('SPORTMONKS_TOKEN is not set (use --no-fetch to rebuild only).'); process.exit(2); }
    // Sportmonks: to a temporary file, kept only if it has at least as many finished matches
    const tmp = smPath + '.new';
    run('node', ['tools/fetch-sportmonks.mjs', '--league', '501', '--season', seasonId, '--out', tmp]);
    const fresh = JSON.parse(readFileSync(tmp, 'utf8'));
    if (finished(fresh).length < finished(before).length) { rmSync(tmp); throw new Error(`The new Sportmonks file has fewer finished matches (${finished(fresh).length}) than the old one (${finished(before).length}); kept the old one.`); }
    renameSync(tmp, smPath);
    const known = new Set(finished(before).map((f) => f.id));
    finished(fresh).filter((f) => !known.has(f.id)).forEach((f) => console.log(`  new: ${String(f.date).slice(0, 10)} ${f.home.name} ${f.score.home}–${f.score.away} ${f.away.name}`));
    // Aberdeen's cup ties from Wikipedia: optional, the league update goes ahead without them
    const y = Number(String(fresh.season.name).slice(0, 4));
    const cups = (man.layers || []).find((n) => n === `cups-aberdeen-${y}.json`);
    if (cups) {
      try { run('node', ['tools/fetch-wiki-club-matches.mjs', '--club', 'Aberdeen', '--season', String(y), '--out', join(DIR, cups + '.new')]); renameSync(join(DIR, cups + '.new'), join(DIR, cups)); }
      catch (e) { console.warn('Warning: Wikipedia cup ties not updated (' + e.message.split('\n')[0] + ').'); rmSync(join(DIR, cups + '.new'), { force: true }); }
    }
  }
  // The date the page shows as "data to": the last finished league or cup match
  const sm = JSON.parse(readFileSync(smPath, 'utf8'));
  const dates = [lastPlayed(sm)];
  (man.layers || []).filter((n) => /^cups-/.test(n) && existsSync(join(DIR, n))).forEach((n) => { const c = JSON.parse(readFileSync(join(DIR, n), 'utf8')); dates.push(...(c.matches || []).map((x) => x.date)); });
  const asOf = dates.filter(Boolean).sort().at(-1);
  if (asOf && asOf !== man.asOf) { console.log(`asOf: ${man.asOf} -> ${asOf}`); man.asOf = asOf; writeFileSync(manPath, JSON.stringify(man, null, 2) + '\n'); }
  run('sh', ['build.sh', '--with-snapshot']);
  run('node', ['tools/smoke-test.mjs', join(ROOT, 'dist', 'index-snapshot.html')]);
  console.log(`Done: ${finished(sm).length} league matches to ${man.asOf}. Publish dist/index-snapshot.html.`);
}

if (!smName) { console.error('The manifest lists no sportmonks-501-<season>.json layer.'); process.exit(2); }
if (args.includes('--check')) await check();
else { try { refresh(); } catch (e) { console.error('Stopped: ' + e.message); process.exit(1); } }
