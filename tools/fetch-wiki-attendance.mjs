#!/usr/bin/env node
/*
  Average home league attendances per club, season by season, from the English Wikipedia season
  articles of the Scottish top flight ("1996–97 Scottish Premier Division", "2008–09 Scottish
  Premier League", "2016–17 Scottish Premiership"), through the Wikipedia API. Writes one file
  Touchline Lab reads (drop it in the Data tab, or put it in data/snapshot/ and list it as
  "attendance" in the manifest).

    node tools/fetch-wiki-attendance.mjs                     # 1994–95 to last season
    node tools/fetch-wiki-attendance.mjs --from 1975 --to 2000
    node tools/fetch-wiki-attendance.mjs --out data/snapshot/attendance-wikipedia.json

  Text from Wikipedia is CC BY-SA 4.0; the output keeps the article titles as sources.
*/
import { writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; };
const now = new Date(), last = now.getUTCMonth() >= 6 ? now.getUTCFullYear() - 1 : now.getUTCFullYear() - 2;
const from = Number(opt('from', 1994)), to = Number(opt('to', last));
const API = 'https://en.wikipedia.org/w/api.php';
const UA = { 'User-Agent': 'TouchlineLab/1.0 (football stats app; attendance tables)' };

// The league's name in each era
const league = (y) => (y >= 2013 ? 'Scottish Premiership' : y >= 1998 ? 'Scottish Premier League' : y >= 1975 ? 'Scottish Premier Division' : 'Scottish Division One');
const title = (y) => `${y}–${String((y + 1) % 100).padStart(2, '0')} ${league(y)}`;

const strip = (h) => h.replace(/<sup[\s\S]*?<\/sup>/gi, '').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#\d+;/g, '').replace(/\[[^\]]*\]/g, '').trim();
// Every table in the article HTML whose header row has a Team/Club column and an Average column
function attendanceTables(html) {
  const out = [];
  for (const t of html.match(/<table[\s\S]*?<\/table>/gi) || []) {
    const rows = (t.match(/<tr[\s\S]*?<\/tr>/gi) || []).map((r) => (r.match(/<t[hd][^>]*>[\s\S]*?<\/t[hd]>/gi) || []).map(strip));
    const hi = rows.findIndex((r) => r.some((c) => /^(team|club)$/i.test(c)) && r.some((c) => /^average/i.test(c)));
    if (hi < 0) continue;
    const H = rows[hi].map((c) => c.toLowerCase());
    const iT = H.findIndex((c) => /^(team|club)$/.test(c)), iA = H.findIndex((c) => /^average/.test(c));
    const clubs = rows.slice(hi + 1).map((r) => ({ name: (r[iT] || '').replace(/[†‡*]/g, '').trim(), att: parseInt(String(r[iA] || '').replace(/[^0-9]/g, ''), 10) }))
      .filter((x) => x.name && /[a-z]/i.test(x.name) && !/total|average/i.test(x.name) && Number.isFinite(x.att) && x.att > 0);
    if (clubs.length >= 6) out.push(clubs);
  }
  return out;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// One API call, waiting and retrying when Wikipedia says too many requests
async function api(params) {
  for (let a = 0; a < 5; a++) {
    const r = await fetch(API + '?' + new URLSearchParams({ format: 'json', formatversion: '2', redirects: '1', ...params }), { headers: UA });
    const txt = await r.text();
    if (r.status === 429 || !txt.startsWith('{')) { await sleep(5000 * 2 ** a); continue; }
    return JSON.parse(txt);
  }
  throw new Error('Wikipedia kept refusing (too many requests); try again later');
}

async function main() {
  const seasons = {}, sources = {};
  for (let y = from; y <= to; y++) {
    const t = title(y);
    let html = '';
    try {
      // Only the Attendances section: find it, then fetch its HTML
      const sec = await api({ action: 'parse', page: t, prop: 'sections' });
      if (sec.error) throw new Error(sec.error.info || 'no page');
      const s0 = (sec.parse.sections || []).find((x) => /attendance/i.test(x.line));
      await sleep(2500);
      const j = await api({ action: 'parse', page: t, prop: 'text', ...(s0 ? { section: s0.index } : {}) });
      html = (j.parse && j.parse.text) || '';
    } catch (e) { console.log(`  ${t}: ${e.message}`); await sleep(2500); continue; }
    const tabs = attendanceTables(html);
    if (!tabs.length) { console.log(`  ${t}: no attendance table found`); await sleep(2500); continue; }
    const key = `${y}/${String((y + 1) % 100).padStart(2, '0')}`;
    seasons[key] = Object.fromEntries(tabs[0].map((c) => [c.name, c.att]));
    sources[key] = 'https://en.wikipedia.org/wiki/' + encodeURIComponent(t.replace(/ /g, '_'));
    console.log(`  ${t}: ${tabs[0].length} clubs`);
    await sleep(2500); // gentle on the API
  }
  const out = opt('out', 'attendance-wikipedia.json');
  writeFileSync(out, JSON.stringify({ source: 'touchline-attendance', from: 'Wikipedia (CC BY-SA 4.0)', fetched: new Date().toISOString(), sources, seasons }, null, 1));
  console.log(`Wrote ${out}: ${Object.keys(seasons).length} seasons.`);
}
main().catch((e) => { console.error(e.message); process.exit(1); });
