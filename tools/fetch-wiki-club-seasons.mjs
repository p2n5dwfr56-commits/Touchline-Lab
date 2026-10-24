#!/usr/bin/env node
/*
  A club's whole league history from Wikipedia's "List of <club> seasons" article: each season's
  division, record, position, Scottish Cup and League Cup rounds, Europe, and top league scorer(s).
  Writes one file Touchline Lab reads (Data tab, or data/snapshot/ listed as "clubHistory").

    node tools/fetch-wiki-club-seasons.mjs --page "List of Aberdeen F.C. seasons" --club Aberdeen
    node tools/fetch-wiki-club-seasons.mjs --html saved-api-response.json --club Aberdeen   # parse a saved copy

  Text from Wikipedia is CC BY-SA 4.0; the output keeps the article as its source.
*/
import { readFileSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; };
const club = opt('club', 'Aberdeen');
const page = opt('page', `List of ${club} F.C. seasons`);
const UA = { 'User-Agent': 'TouchlineLab/1.0 (personal football stats app)' };

const decode = (s) => s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&[a-z]+;/g, '');
// Cell text with line breaks kept as " / " (several scorers share a cell)
const cell = (c) => decode(c.replace(/<sup[\s\S]*?<\/sup>/gi, '').replace(/<br\s*\/?>|<hr\s*\/?>/gi, ' / ').replace(/<\/(li|p|div)>/gi, ' / ').replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').replace(/(\s*\/\s*)+$/, '').replace(/^(\s*\/\s*)+/, '').trim();
const seasonKey = (s) => { const m = String(s).match(/^(\d{4})\s*[–-]\s*(\d{2,4})/); if (!m) return ''; const y = +m[1]; return y + '/' + String((y + 1) % 100).padStart(2, '0'); };
const num = (v) => { const n = parseInt(String(v || '').replace(/[^0-9-]/g, ''), 10); return Number.isFinite(n) ? n : null; };

// Lay a table out as a grid, repeating cells that span rows (rowspan) or columns (colspan)
function grid(table) {
  const out = [], carry = [];
  (table.match(/<tr[\s\S]*?<\/tr>/gi) || []).forEach((tr, ri) => {
    const row = [];
    const cells = (tr.match(/<t[hd][^>]*>[\s\S]*?<\/t[hd]>/gi) || []).map((c) => ({ txt: cell(c.replace(/^<t[hd][^>]*>|<\/t[hd]>$/gi, '')), rs: +((c.match(/^<t[hd][^>]*\browspan="?(\d+)/i) || [])[1] || 1), cs: +((c.match(/^<t[hd][^>]*\bcolspan="?(\d+)/i) || [])[1] || 1) }));
    let col = 0;
    const fill = () => { while (carry[col] && carry[col].left > 0) { row[col] = carry[col].txt; carry[col].left--; col++; } };
    cells.forEach((c) => {
      fill();
      for (let k = 0; k < c.cs; k++) { row[col] = c.txt; if (c.rs > 1) carry[col] = { txt: c.txt, left: c.rs - 1 }; col++; }
    });
    fill();
    out.push(row);
  });
  return out;
}
function parse(html) {
  const out = [];
  for (const t of html.match(/<table[\s\S]*?<\/table>/gi) || []) {
    const rows = grid(t);
    const hi = rows.findIndex((r) => r.includes('Pld') && r.includes('Pos'));
    if (hi < 1) continue;
    // Two header rows: the top one names the groups (Season, League, Scottish Cup, League Cup, Europe, Top league goalscorer(s)),
    // the second the columns inside them
    const top = rows[hi - 1], sub = rows[hi];
    const colOf = (re, label) => top.findIndex((g, i) => re.test(g) && (label == null || sub[i] === label));
    const C = { div: colOf(/league/i, 'Division'), pld: colOf(/league/i, 'Pld'), w: colOf(/league/i, 'W'), d: colOf(/league/i, 'D'), l: colOf(/league/i, 'L'), gf: colOf(/league/i, 'GF'), ga: colOf(/league/i, 'GA'), pts: colOf(/league/i, 'Pts'), pos: colOf(/league/i, 'Pos'),
      sc: colOf(/scottish cup/i), lc: colOf(/league cup/i), eu: top.findIndex((g) => /europe/i.test(g)), sco: top.findIndex((g) => /scorer/i.test(g)) };
    rows.slice(hi + 1).forEach((r) => {
      const season = seasonKey(r[0]);
      if (!season) return;
      const pld = num(r[C.pld]);
      const row = { season, division: r[C.div] || '', note: '' };
      if (pld == null || /cancel|dropped out|no competitive/i.test(r[C.div] || '')) { row.note = [...new Set(r.slice(1).filter(Boolean))].join(' · '); out.push(row); return; } // wartime and other non-league years
      const euro = C.eu >= 0 ? [...new Set([r[C.eu], r[C.eu + 1]].filter(Boolean))] : [];
      Object.assign(row, { pld, w: num(r[C.w]), d: num(r[C.d]), l: num(r[C.l]), gf: num(r[C.gf]), ga: num(r[C.ga]), pts: num(r[C.pts]), pos: r[C.pos] || '',
        scottishCup: C.sc >= 0 ? r[C.sc] || '' : '', leagueCup: C.lc >= 0 ? r[C.lc] || '' : '', europe: euro.join(' · '),
        scorers: C.sco >= 0 ? r[C.sco] || '' : '', goals: C.sco >= 0 ? num(r[C.sco + 1]) : null });
      out.push(row);
    });
  }
  return out;
}

async function main() {
  let html;
  if (opt('html')) { const j = JSON.parse(readFileSync(opt('html'), 'utf8')); html = j.parse ? j.parse.text : j; }
  else {
    const url = 'https://en.wikipedia.org/w/api.php?' + new URLSearchParams({ action: 'parse', format: 'json', formatversion: '2', redirects: '1', prop: 'text', page });
    for (let a = 0; a < 5 && !html; a++) {
      const r = await fetch(url, { headers: UA }), txt = await r.text();
      if (txt.startsWith('{')) { const j = JSON.parse(txt); if (j.error) throw new Error(j.error.info); html = j.parse.text; }
      else await new Promise((res) => setTimeout(res, 5000 * 2 ** a));
    }
    if (!html) throw new Error('Wikipedia kept refusing (too many requests); try again later');
  }
  // A season split over two rows (e.g. a Super Cup listed under the same season) becomes one, Europe joined
  const seasons = [];
  parse(html).forEach((r) => { const was = seasons.find((x) => x.season === r.season); if (!was) seasons.push(r); else if (r.europe && r.europe !== was.europe) was.europe = [was.europe, r.europe].filter(Boolean).join('; '); });
  if (!seasons.length) throw new Error('No seasons table found on the page.');
  const out = opt('out', `club-seasons-${club.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.json`);
  writeFileSync(out, JSON.stringify({ source: 'touchline-club-history', club, from: 'Wikipedia: ' + page + ' (CC BY-SA 4.0)', url: 'https://en.wikipedia.org/wiki/' + encodeURIComponent(page.replace(/ /g, '_')), fetched: new Date().toISOString(), seasons }, null, 1));
  console.log(`Wrote ${out}: ${seasons.length} seasons (${seasons[0].season} to ${seasons[seasons.length - 1].season}).`);
}
main().catch((e) => { console.error(e.message); process.exit(1); });
