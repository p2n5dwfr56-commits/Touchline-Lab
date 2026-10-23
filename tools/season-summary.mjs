// Season player totals for snapshot builds: runs the app's own importers (football-data + Sportmonks)
// on a past season and returns each player's league totals, so older seasons can ship as a few kB
// instead of every match. Used by embed-snapshot.mjs.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
let ctx = null;
function app() {
  if (ctx) return ctx;
  ctx = vm.createContext({ console });
  const code = ['engine.js', 'apifootball.js', 'footballdata.js', 'fbref.js', 'sportmonks.js'].map((f) => readFileSync(join(SRC, f), 'utf8').replace(/^'use strict';/m, '')).join('\n;\n');
  vm.runInContext(code + '\n;globalThis.__api = { importFootballData, fdParseCSV, prepareDB, attachSportmonks, aggPlayer };', ctx);
  return ctx;
}
const r2 = (v) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 100) / 100 : undefined);

export function seasonSummary(csvText, smTexts) {
  const A = app().__api;
  const { db } = A.importFootballData([{ name: 'season.csv', rows: A.fdParseCSV(csvText) }]);
  A.prepareDB(db);
  smTexts.forEach((t) => A.attachSportmonks(db, JSON.parse(t)));
  const players = {};
  Object.values(db.players).forEach((p) => {
    const a = A.aggPlayer(db.matches, p.id);
    if (!(a.min > 0)) return;
    const tot = {};
    Object.entries(a).forEach(([k, v]) => { const x = r2(v); if (x !== undefined) tot[k] = x; });
    players[p.id] = { name: p.name, team: p.team, group: p.group, role: p.role, num: p.num, a: tot };
  });
  return players;
}
