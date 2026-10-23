// Prints `const SNAPSHOT = {...};` for build.sh: a bundled data snapshot the app loads when the viewer has no saved imports.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { seasonSummary } from './season-summary.mjs';
const dir = process.argv[2];
const m = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
const file = (name) => ({ name: name.replace(/^.*\//, ''), text: compact(name, readFileSync(join(dir, name), 'utf8')) });

// Keep only what the app reads, to keep the page small
const FD_COLS = /^(Div|Date|HomeTeam|AwayTeam|FTHG|FTAG|HS|AS|HST|AST|HF|AF|HC|AC|HY|AY|HR|AR|HxG|AxG|Avg[HDA]|BbAv[HDA]|PS[HDA]|B365[HDA]|WH[HDA])$/;
const SM_TYPES = /^(Minutes Played|Touches|Passes|Accurate Passes|Key Passes|Goals|Assists|Shots Total|Shots On Target|Tackles|Interceptions|Ball Recovery|Clearances|Total Duels|Duels Won|Dribble Attempts|Successful Dribbles|Fouls|Total Crosses|Yellowcards|Saves|Goalkeeper Goals Conceded|Rating|Aerials Won|Aerials Lost|Tackles Won|Big Chances Created|Passes In Final Third|Long Balls|Long Balls Won|Possession Lost|Dispossessed|Dribbled Past|Blocked Shots|Fouls Drawn|Error Lead To Shot|Error Lead To Goal|Man of Match|Accurate Crosses|Ball Possession %)$/;
function compact(name, text) {
  if (/\.csv$/i.test(name)) {
    const lines = text.replace(/^﻿/, '').split(/\r?\n/);
    const head = lines[0].split(','), keep = head.map((c, i) => (FD_COLS.test(c.trim()) ? i : -1)).filter((i) => i >= 0);
    return lines.filter((l) => l.trim()).map((l) => { const c = l.split(','); return keep.map((i) => c[i] ?? '').join(','); }).join('\n');
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
const snap = {
  asOf: m.asOf, primary: m.primary.map(file), fbref: (m.fbref || []).map((f) => ({ team: f.team, texts: f.files.map(file) })), layers: (m.layers || []).map(file),
  // Older seasons: Sportmonks files are reduced to each player's season totals (p.summarise)
  past: (m.past || []).map((p) => ({ season: p.season, primary: p.files.map(file), layers: (p.layers || []).map(file),
    summary: p.summarise && p.summarise.length ? seasonSummary(readFileSync(join(dir, p.files[0]), 'utf8'), p.summarise.map((f) => readFileSync(join(dir, f), 'utf8'))) : undefined })),
};
// Escape "<" so file contents can never close the surrounding <script>
process.stdout.write('const SNAPSHOT = ' + JSON.stringify(snap).replace(/</g, '\\u003c') + ';\n');
// Optional StatsBomb sample (a file from tools/fetch-statsbomb.mjs), for the event-data views
if (m.sample) {
  const b = JSON.parse(readFileSync(join(dir, m.sample), 'utf8'));
  process.stdout.write('const SAMPLE_EVENTS = ' + JSON.stringify({ label: b.label, attribution: b.attribution, db: b.db }).replace(/</g, '\\u003c') + ';\n');
}
