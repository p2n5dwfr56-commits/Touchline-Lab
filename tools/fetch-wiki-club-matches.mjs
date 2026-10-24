#!/usr/bin/env node
/*
  A club's cup matches for one season from its Wikipedia season article ("2026–27 Aberdeen F.C. season"):
  every Scottish Cup, League Cup (group stage and knockout), Challenge Cup and European tie, with date,
  round, opponent, venue, score, penalties, scorers, stadium, attendance and referee. League matches and
  friendlies are left out (the league comes from the season file). Writes one file Touchline Lab reads
  (Data tab, or data/snapshot/ listed under "layers" for that season).

    node tools/fetch-wiki-club-matches.mjs --club Aberdeen --season 2026
    node tools/fetch-wiki-club-matches.mjs --club Aberdeen --season 2026 --html saved-api-response.json
    node tools/fetch-wiki-club-matches.mjs --club Aberdeen --season 2015 --league   # league games too (goal times)

  With --league the league matches are kept as well (comp "League"): Touchline Lab adds their scorers and
  goal minutes to the league results it already has, for goal timing and head-to-head analysis.

  Text from Wikipedia is CC BY-SA 4.0; the output keeps the article as its source.
*/
import { readFileSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; };
const club = opt('club', 'Aberdeen');
const y = Number(opt('season', new Date().getUTCMonth() >= 6 ? new Date().getUTCFullYear() : new Date().getUTCFullYear() - 1));
const page = opt('page', `${y}–${String((y + 1) % 100).padStart(2, '0')} ${club} F.C. season`);
const season = `${y}/${String((y + 1) % 100).padStart(2, '0')}`;
const UA = { 'User-Agent': 'TouchlineLab/1.0 (personal football stats app)' };

const decode = (s) => s.replace(/&nbsp;|&#160;/g, ' ').replace(/&#32;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&[a-z]+;/g, '');
const text = (h) => decode(String(h || '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<sup[\s\S]*?<\/sup>/gi, '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')).replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
const MONTHS = { january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12 };
const isoDate = (s) => { const m = String(s).match(/(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/); return m && MONTHS[m[2].toLowerCase()] ? `${m[3]}-${String(MONTHS[m[2].toLowerCase()]).padStart(2, '0')}-${m[1].padStart(2, '0')}` : ''; };
const same = (a, b) => a.toLowerCase().replace(/[^a-z]/g, '') === b.toLowerCase().replace(/[^a-z]/g, '');

// The competition a heading names; null for the league and friendlies
function compOf(h) {
  if (/friend|pre-season/i.test(h)) return null;
  if (/league cup/i.test(h)) return 'League Cup';
  if (/scottish cup/i.test(h)) return 'Scottish Cup';
  if (/challenge cup/i.test(h)) return 'Challenge Cup';
  if (/champions league|europa|conference|uefa|europe/i.test(h)) return h.replace(/^UEFA\s+/i, '').trim();
  return args.includes('--league') && /league|premier|division|championship/i.test(h) ? 'League' : null; // the league, when asked for
}
// Scorers in a box cell, one player per line: only the goal markers count (bookings and red cards sit
// alongside them). "Nisbet ⚽ 35' (pen.), 76'" -> ["Nisbet 35' (p)", "Nisbet 76'"]
function goalSpan(line) {
  const i = line.indexOf('class="fb-goal"');
  if (i < 0) return '';
  const start = line.lastIndexOf('<span', i);
  let depth = 0;
  const re = /<span\b|<\/span>/gi;
  re.lastIndex = start;
  let t;
  while ((t = re.exec(line))) { depth += t[0].startsWith('</') ? -1 : 1; if (depth === 0) return line.slice(start, re.lastIndex); }
  return line.slice(start);
}
function scorers(cellHtml) {
  return String(cellHtml || '').split(/<br\s*\/?>/i).flatMap((line) => {
    const g = goalSpan(line);
    if (!g) return [];
    const name = text(line.slice(0, line.search(/<span/i))).trim();
    return text(g).split(/,\s*/).map((x) => x.trim()).filter((x) => /\d/.test(x)).map((x) => name + ' ' + x.replace(/\(pen\.?\)/i, '(p)').replace(/\(o\.?g\.?\)/i, '(og)'));
  });
}

function parse(html) {
  const out = [];
  // Walk headings and match boxes in page order, so each box knows its competition and section
  const re = /<h([234])[^>]*>([\s\S]*?)<\/h\1>|<table[^>]*tmpl-football-box[\s\S]*?<\/table>/gi;
  let comp = null, sub = '', m;
  while ((m = re.exec(html))) {
    if (m[1]) { const t = text(m[2]); if (m[1] === '4') sub = t; else { comp = compOf(t); sub = ''; } continue; }
    if (!comp) continue;
    const rows = m[0].match(/<tr[\s\S]*?<\/tr>/gi) || [];
    const c1 = (rows[0] || '').match(/<td[\s\S]*?<\/td>/gi) || [], c2 = (rows[1] || '').match(/<td[\s\S]*?<\/td>/gi) || [];
    if (c1.length < 4) continue;
    const date = isoDate(text(c1[0]));
    // The box's own round label, with the section it sits in when that label is only a leg or matchday
    let round = text(c1[0]).replace(/^.*?\d{4}\s*/, '').replace(/\n/g, ' ').trim();
    if (/^\d+$/.test(round)) round = 'Matchday ' + round;
    if (!round) round = sub;
    else if (sub && /leg|^matchday/i.test(round) && !round.toLowerCase().includes(sub.toLowerCase())) round = sub + ' · ' + round;
    const home = text(c1[1]), away = text(c1[3]), score = text(c1[2]);
    const sm = score.match(/(\d+)\s*[–-]\s*(\d+)/);
    if (!date || !sm) continue; // not played yet
    const homeIsUs = same(home, club) || home.toLowerCase().includes(club.toLowerCase());
    const awayIsUs = !homeIsUs && (same(away, club) || away.toLowerCase().includes(club.toLowerCase()));
    if (!homeIsUs && !awayIsUs) continue;
    const hg = +sm[1], ag = +sm[2];
    // Penalties: "(4–3 p)" in the score cell, or "Penalties" with a score in the second row
    const all = text(m[0]);
    const pm = score.match(/\((\d+)\s*[–-]\s*(\d+)\s*p/i) || all.match(/Penalties[\s\S]{0,400}?(\d+)\s*[–-]\s*(\d+)/i) || all.match(/(\d+)\s*[–-]\s*(\d+)\s*(?:p|pen\.?|on penalties)\b/i);
    const info = text(c1[4] || '') + '\n' + text(c2[4] || '');
    const att = parseInt((info.match(/Attendance:\s*([\d,]+)/i) || [])[1]?.replace(/,/g, '') || '', 10);
    const venueName = (info.match(/Stadium:\s*([^\n]+)/i) || [])[1] || '';
    const neutral = /hampden|neutral/i.test(venueName) && !/queen'?s park/i.test(homeIsUs ? away : home) && /final|semi/i.test(round);
    out.push({
      date, comp, round, opp: homeIsUs ? away : home, venue: neutral ? 'N' : homeIsUs ? 'H' : 'A',
      gf: homeIsUs ? hg : ag, ga: homeIsUs ? ag : hg,
      pens: pm ? (homeIsUs ? { f: +pm[1], a: +pm[2] } : { f: +pm[2], a: +pm[1] }) : null,
      att: Number.isFinite(att) ? att : null, ref: (info.match(/Referee:\s*([^\n(]+)/i) || [])[1]?.trim() || '', stadium: venueName.trim(),
      scorers: { for: scorers(homeIsUs ? c2[1] : c2[3]), against: scorers(homeIsUs ? c2[3] : c2[1]) },
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
      else await new Promise((res) => setTimeout(res, 15000 * (a + 1)));
    }
    if (!html) throw new Error('Wikipedia kept refusing (too many requests); try again later');
  }
  const matches = parse(html);
  if (!matches.length) throw new Error('No played matches found on the page (older articles list results in tables without match boxes).');
  const out = opt('out', `cups-${club.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${y}.json`);
  writeFileSync(out, JSON.stringify({ source: 'touchline-cups', club, season, from: 'Wikipedia: ' + page + ' (CC BY-SA 4.0)', url: 'https://en.wikipedia.org/wiki/' + encodeURIComponent(page.replace(/ /g, '_')), fetched: new Date().toISOString(), matches }, null, 1));
  const by = {};
  matches.forEach((x) => (by[x.comp] = (by[x.comp] || 0) + 1));
  console.log(`Wrote ${out}: ${matches.length} matches (${Object.entries(by).map(([k, v]) => v + ' ' + k).join(', ')}).`);
}
main().catch((e) => { console.error(e.message); process.exit(1); });
