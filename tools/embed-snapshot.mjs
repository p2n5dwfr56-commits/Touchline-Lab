// Prints `const SNAPSHOT = {...};` for build.sh: a bundled data snapshot the app loads when the viewer has no saved imports.
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { seasonSummary } from './season-summary.mjs';
const dir = process.argv[2];
const m = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
const file = (name) => ({ name: name.replace(/^.*\//, ''), text: compact(name, readFileSync(join(dir, name), 'utf8')) });

// Keep only what the app reads, to keep the page small
const FD_COLS = /^(Div|Date|HomeTeam|AwayTeam|FTHG|FTAG|Attendance|Referee|HS|AS|HST|AST|HF|AF|HC|AC|HY|AY|HR|AR|HxG|AxG|Avg[HDA]|BbAv[HDA]|PS[HDA]|B365[HDA]|WH[HDA])$/;
const SM_TYPES = /^(Corners|Redcards|Minutes Played|Touches|Passes|Accurate Passes|Key Passes|Goals|Assists|Shots Total|Shots On Target|Tackles|Interceptions|Ball Recovery|Clearances|Total Duels|Duels Won|Dribble Attempts|Successful Dribbles|Fouls|Total Crosses|Yellowcards|Saves|Goalkeeper Goals Conceded|Rating|Aerials Won|Aerials Lost|Tackles Won|Big Chances Created|Passes In Final Third|Long Balls|Long Balls Won|Possession Lost|Dispossessed|Dribbled Past|Blocked Shots|Fouls Drawn|Error Lead To Shot|Error Lead To Goal|Man of Match|Accurate Crosses|Ball Possession %)$/;
function compact(name, text) {
  if (/\.csv$/i.test(name)) {
    const lines = text.replace(/^﻿/, '').replace(/\uFFFD/g, '').split(/\r?\n/); // stray bytes in some older files
    // Split on commas outside quotes (referee names like "Smith, J" are quoted)
    const cells = (l) => { const out = []; let cur = '', q = false; for (const ch of l) { if (ch === '"') q = !q; else if (ch === ',' && !q) { out.push(cur); cur = ''; } else cur += ch; } out.push(cur); return out; };
    const head = cells(lines[0]), keep = head.map((c, i) => (FD_COLS.test(c.trim()) ? i : -1)).filter((i) => i >= 0);
    return lines.filter((l) => l.trim()).map((l) => { const c = cells(l); return keep.map((i) => (c[i] ?? '').replace(/,/g, ' ')).join(','); }).join('\n');
  }
  let b;
  try { b = JSON.parse(text); } catch (e) { return text; }
  if (!b || b.source !== 'sportmonks') return text;
  const ok = new Set(Object.entries(b.types || {}).filter(([, n]) => SM_TYPES.test(n)).map(([id]) => id));
  b.types = Object.fromEntries(Object.entries(b.types).filter(([id]) => ok.has(id)));
  b.fixtures.forEach((f) => {
    (f.lineups || []).forEach((l) => { delete l.player; l.d = Object.fromEntries(Object.entries(l.d || {}).filter(([k]) => ok.has(k))); });
    (f.events || []).forEach((e) => { delete e.player; delete e.rel; delete e.info; delete e.addition; });
    f.stats = (f.stats || []).filter((s) => ok.has(String(s.type)));
  });
  return JSON.stringify(b);
}
const nonEmpty = (o) => (o && Object.keys(o).length ? o : undefined); // a season whose file has no player data ships none
const snap = {
  asOf: m.asOf, primary: m.primary.map(file), fbref: (m.fbref || []).map((f) => ({ team: f.team, texts: f.files.map(file) })), layers: (m.layers || []).map(file),
  // Older seasons: Sportmonks files are reduced to each player's season totals (p.summarise)
  // Attendance files, first one wins where they overlap (your own figures before Wikipedia's)
  managersByYear: m.managersByYear && existsSync(join(dir, m.managersByYear)) ? readFileSync(join(dir, m.managersByYear), 'utf8') : undefined,
  managersSummary: m.managersSummary && existsSync(join(dir, m.managersSummary)) ? readFileSync(join(dir, m.managersSummary), 'utf8') : undefined,
  managers: m.managers && existsSync(join(dir, m.managers)) ? readFileSync(join(dir, m.managers), 'utf8') : undefined,
  finance: [].concat(m.finance || []).filter((f) => existsSync(join(dir, f))).map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8'))),
  clubHistory: [].concat(m.clubHistory || []).filter((f) => existsSync(join(dir, f))).map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8'))),
  attendance: [].concat(m.attendance || []).filter((f) => existsSync(join(dir, f))).map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8'))),
  past: (m.past || []).map((p) => ({ season: p.season, primary: p.files.map(file), layers: (p.layers || []).map(file),
    summary: (p.summarise || []).some((f) => existsSync(join(dir, f))) ? nonEmpty(seasonSummary(readFileSync(join(dir, p.files[0]), 'utf8'), p.summarise.filter((f) => existsSync(join(dir, f))).map((f) => readFileSync(join(dir, f), 'utf8')))) : undefined })),
};
// Escape "<" so file contents can never close the surrounding <script>
// Penalties awarded in each league match (scored or missed), from the Sportmonks match events: a compact list the
// Ref Watch tab joins to the results by date and teams. Seasons before 2008/09 do not record missed penalties.
function penaltyList() {
  const files = [].concat(existsSync(join(dir, 'past')) ? readdirSync(join(dir, 'past')).filter((f) => /^sportmonks-.*\.json$/.test(f)).map((f) => join(dir, 'past', f)) : [], (m.layers || []).filter((f) => /sportmonks/.test(f)).map((f) => join(dir, f)));
  const out = [], seasons = [];
  for (const f of files) {
    let b;
    try { b = JSON.parse(readFileSync(f, 'utf8')); } catch (e) { continue; }
    if (!b || b.source !== 'sportmonks' || !b.season || parseInt(b.season.name, 10) < 2008) continue;
    const evs = b.fixtures.reduce((t, x) => t + (x.events || []).length, 0);
    if (evs < 1000) continue; // a season without match events
    const y = parseInt(b.season.name, 10);
    seasons.push(y + '/' + String((y + 1) % 100).padStart(2, '0'));
    // Only matches with a penalty are listed; every other match in a covered season had none
    b.fixtures.forEach((x) => {
      if (!x.score || !x.home || !x.away) return;
      const pen = (id) => (x.events || []).filter((e) => (e.type === 'Penalty' || e.type === 'Missed Penalty') && e.team === id).length;
      const ph = pen(x.home.id), pa = pen(x.away.id);
      if (ph + pa) out.push([String(x.date).slice(0, 10), x.home.name, x.away.name, ph, pa]);
    });
  }
  return { seasons: [...new Set(seasons)].sort(), m: out };
}
snap.penalties = penaltyList();
process.stdout.write('const SNAPSHOT = ' + JSON.stringify(snap).replace(/</g, '\\u003c') + ';\n');
// Optional StatsBomb sample (a file from tools/fetch-statsbomb.mjs), for the event-data views
if (m.sample) {
  const b = JSON.parse(readFileSync(join(dir, m.sample), 'utf8'));
  process.stdout.write('const SAMPLE_EVENTS = ' + JSON.stringify({ label: b.label, attribution: b.attribution, db: b.db }).replace(/</g, '\\u003c') + ';\n');
}
