'use strict';
/* =====================================================================
   Saved imports
   Keeps the files and FBref tables you import in this browser's own
   storage (IndexedDB), and replays them when the app opens. Nothing is
   uploaded. Storage can be unavailable (private windows, blocked site
   data): every call fails soft and the app works without it.
   ===================================================================== */

const STORE = { db: null, ok: null, meta: null };

function storeOpen() {
  if (STORE.db || STORE.ok === false) return Promise.resolve(STORE.db);
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open('touchline-lab', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('kv');
      req.onsuccess = () => { STORE.db = req.result; STORE.ok = true; resolve(STORE.db); };
      req.onerror = req.onblocked = () => { STORE.ok = false; resolve(null); };
    } catch (e) { STORE.ok = false; resolve(null); }
  });
}
async function storeGet(key) {
  const db = await storeOpen();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const r = db.transaction('kv').objectStore('kv').get(key);
      r.onsuccess = () => resolve(r.result == null ? null : r.result);
      r.onerror = () => resolve(null);
    } catch (e) { resolve(null); }
  });
}
async function storeSet(key, value) {
  const db = await storeOpen();
  if (!db) return false;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction('kv', 'readwrite');
      if (value == null) tx.objectStore('kv').delete(key); else tx.objectStore('kv').put(value, key);
      tx.oncomplete = () => resolve(true);
      tx.onerror = tx.onabort = () => resolve(false); // e.g. storage quota full
    } catch (e) { resolve(false); }
  });
}

/* The saved log: the season files last imported, then each FBref table added to it, in order. */
function savedSummary(log) {
  if (!log) return null;
  const fb = log.fbref || [];
  const teams = [...new Set(fb.map((f) => f.teamName))];
  return { files: log.primary.map((f) => f.name), label: log.label || '', fbTables: fb.reduce((s, f) => s + f.texts.length, 0), fbTeams: teams, manual: (log.manual || []).length, layers: (log.layers || []).map((l) => l.name), savedAt: log.savedAt };
}
// Whole-season add-on files (Sportmonks downloads), replayed after the FBref tables
async function carriedLayers(label) {
  const prev = await storeGet('log');
  return prev && prev.label === label ? prev.layers || [] : [];
}
async function saveLayers(files) {
  const log = await baseLog();
  if (!log) return false;
  const names = new Set(files.map((f) => f.name));
  log.layers = (log.layers || []).filter((l) => !names.has(l.name)).concat(files.map((f) => ({ name: f.name, text: f.text })));
  log.savedAt = Date.now();
  const ok = await storeSet('log', log);
  STORE.meta = ok ? savedSummary(log) : STORE.meta;
  return ok;
}
// A saved or built-in file on top of a season: Sportmonks line-ups, API-Football cups, or Wikipedia cup results
function applyLayerJSON(db, name, d) {
  if (smIsBundle(d)) attachSportmonks(db, d);
  else if (isCupsFile(d)) attachCupsFile(db, d);
  else if (afCupLeague([{ data: d }])) attachApiFootballCups(db, [{ name, data: d }]);
}
function applyLayers(layers) {
  (layers || []).forEach((l) => { try { applyLayerJSON(DB, l.name, JSON.parse(l.text)); } catch (e) { /* skip a damaged layer */ } });
}
// FBref tables and hand-entered matches saved on top of the same season (same label), so an updated season file keeps them
async function carriedFbref(label) {
  const prev = await storeGet('log');
  return prev && prev.label === label ? prev.fbref || [] : [];
}
async function carriedManual(label) {
  const prev = await storeGet('log');
  return prev && prev.label === label ? prev.manual || [] : [];
}
async function savePrimary(texts, label, fbref, manual, layers) {
  const log = { v: 1, savedAt: Date.now(), label, primary: texts.map((t) => ({ name: t.name, text: t.text })), fbref: fbref || [], manual: manual || [], layers: layers || [] };
  const ok = await storeSet('log', log);
  STORE.meta = ok ? savedSummary(log) : null;
  return ok;
}
// The saved log, or (on top of the built-in snapshot) a new one with the snapshot as its base
async function baseLog() {
  const log = await storeGet('log');
  if (log) return log;
  const real = (typeof SEASONS !== 'undefined' && SEASONS.real) || DB; // the current season, even while a past one is on screen
  if (real.snapshot && SNAP) return { v: 1, savedAt: Date.now(), label: real.label, primary: SNAP.primary, fbref: snapshotFbref(real), layers: (SNAP.layers || []).slice(), manual: [] };
  return null;
}
async function saveFbref(teamId, teamNameText, texts) {
  const log = await baseLog();
  if (!log) return false; // FBref tables only make sense on top of a saved season
  texts.forEach((t) => {
    if (log.fbref.some((f) => f.team === teamId && f.texts.some((x) => x.text === t.text))) return; // same table pasted again
    log.fbref.push({ team: teamId, teamName: teamNameText, texts: [{ name: t.name, text: t.text }] });
  });
  log.savedAt = Date.now();
  const ok = await storeSet('log', log);
  STORE.meta = ok ? savedSummary(log) : STORE.meta;
  return ok;
}
/* Matches entered by hand: a played cup tie (with a score) or an upcoming fixture (without one). */
function applyManual(db, e) {
  if (!db.teamById[e.team]) return false;
  if (e.gf != null && e.ga != null) addCupMatch(db, e.team, { ...e, manual: true });
  else addFixture(db, e.team, { ...e, manual: true });
  return true;
}
async function saveManual(e) {
  const log = await baseLog();
  if (!log) return false;
  log.manual = (log.manual || []).filter((x) => x.id !== e.id).concat(e);
  log.savedAt = Date.now();
  const ok = await storeSet('log', log);
  STORE.meta = ok ? savedSummary(log) : STORE.meta;
  return ok;
}
async function removeManual(id) {
  const log = await storeGet('log');
  if (!log) return false;
  log.manual = (log.manual || []).filter((x) => x.id !== id);
  const ok = await storeSet('log', log);
  STORE.meta = ok ? savedSummary(log) : STORE.meta;
  return ok;
}
async function forgetSaved() {
  await storeSet('log', null);
  STORE.meta = null;
}

/* Built-in snapshot of real data (present only in builds made with --with-snapshot). */
const SNAP = typeof SNAPSHOT !== 'undefined' ? SNAPSHOT : null;
function snapshotFbref(db) {
  if (!SNAP) return [];
  return SNAP.fbref.map((f) => { const t = db.teams.find((x) => x.name === f.team); return t ? { team: t.id, teamName: t.name, texts: f.texts } : null; }).filter(Boolean);
}
function loadSnapshot() {
  if (!SNAP) return false;
  if (!importTexts(SNAP.primary, null, { restore: true })) return false;
  snapshotFbref(DB).forEach((f) => addFbref(f.texts, f.team, null, { restore: true }));
  applyLayers(SNAP.layers);
  cache.clear();
  DB.snapshot = SNAP.asOf;
  return true;
}
// Back to real data: the viewer's saved imports if any, else the built-in snapshot
async function loadRealData() {
  const r = STORE.meta ? await restoreSaved() : null;
  if (r && r.ok) return true;
  return loadSnapshot();
}

/* On open: rebuild the last session from the saved log. Returns a message, or null if nothing was saved. */
async function restoreSaved() {
  const log = await storeGet('log');
  if (!log || !log.primary || !log.primary.length) return null;
  try {
    const ok = importTexts(log.primary, null, { restore: true });
    if (!ok) return { error: 'Your saved data could not be loaded again, so the demo season is showing. Import your files again in the Data tab.' };
    (log.fbref || []).forEach((f) => { if (DB.teamById[f.team]) addFbref(f.texts, f.team, null, { restore: true }); });
    applyLayers(log.layers);
    (log.manual || []).forEach((e) => applyManual(DB, e));
    cache.clear();
    DB.manual = (log.manual || []).slice();
    STORE.meta = savedSummary(log);
    return { ok: true };
  } catch (e) {
    return { error: 'Your saved data could not be loaded again (' + e.message + '), so the demo season is showing.' };
  }
}

/* Past seasons added in this browser: season ("2024/25") -> { primary: [season file], layers: [Sportmonks files] },
   kept apart from the current season's log so adding an old season never replaces it. */
async function pastGet() { return (await storeGet('past')) || {}; }
async function pastPut(season, change) {
  const all = await pastGet();
  const cur = all[season] || { primary: [], layers: [] };
  all[season] = change(cur) || cur;
  all[season].savedAt = Date.now();
  return storeSet('past', all);
}
const pastAddPrimary = (season, texts) => pastPut(season, (c) => ({ ...c, primary: texts.map((t) => ({ name: t.name, text: t.text })) }));
const pastAddLayer = (season, f) => pastPut(season, (c) => ({ ...c, layers: (c.layers || []).filter((l) => l.name !== f.name).concat({ name: f.name, text: f.text }) }));
async function pastRemove(season) { const all = await pastGet(); delete all[season]; return storeSet('past', all); }

/* Attendance files (Wikipedia), kept apart from the season logs */
async function saveAttendanceFile(f) {
  const list = ((await storeGet('attendance')) || []).filter((x) => x.name !== f.name).concat({ name: f.name, text: f.text });
  return storeSet('attendance', list);
}
async function restoreAttendance() {
  if (SNAP && SNAP.attendance) [].concat(SNAP.attendance).forEach(addAttendanceFile);
  ((await storeGet('attendance')) || []).forEach((f) => { try { addAttendanceFile(JSON.parse(f.text)); } catch (e) { /* skip a damaged file */ } });
}

/* Club histories (Wikipedia season lists), kept apart from the season logs */
async function saveClubHistory(f) {
  const list = ((await storeGet('clubhist')) || []).filter((x) => x.name !== f.name).concat({ name: f.name, text: f.text });
  return storeSet('clubhist', list);
}
async function restoreClubHistory() {
  if (SNAP && SNAP.clubHistory) [].concat(SNAP.clubHistory).forEach(addClubHistory);
  ((await storeGet('clubhist')) || []).forEach((f) => { try { addClubHistory(JSON.parse(f.text)); } catch (e) { /* skip a damaged file */ } });
}
