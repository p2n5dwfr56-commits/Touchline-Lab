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
  return { files: log.primary.map((f) => f.name), label: log.label || '', fbTables: fb.reduce((s, f) => s + f.texts.length, 0), fbTeams: teams, savedAt: log.savedAt };
}
// FBref tables saved on top of the same season (same label), so an updated season file keeps them
async function carriedFbref(label) {
  const prev = await storeGet('log');
  return prev && prev.label === label ? prev.fbref || [] : [];
}
async function savePrimary(texts, label, fbref) {
  const log = { v: 1, savedAt: Date.now(), label, primary: texts.map((t) => ({ name: t.name, text: t.text })), fbref: fbref || [] };
  const ok = await storeSet('log', log);
  STORE.meta = ok ? savedSummary(log) : null;
  return ok;
}
async function saveFbref(teamId, teamNameText, texts) {
  let log = await storeGet('log');
  // On top of the built-in snapshot: save the snapshot as the base, so the new table survives a reload
  if (!log && DB.snapshot && SNAP) log = { v: 1, savedAt: Date.now(), label: DB.label, primary: SNAP.primary, fbref: snapshotFbref(DB) };
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
    STORE.meta = savedSummary(log);
    return { ok: true };
  } catch (e) {
    return { error: 'Your saved data could not be loaded again (' + e.message + '), so the demo season is showing.' };
  }
}
