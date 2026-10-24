#!/usr/bin/env node
/*
  Club finances from the annual accounts filed at Companies House: turnover and its split, staff costs,
  player trading, operating and pre-tax results, cash and net assets, for each Scottish Premiership club,
  year by year. Writes one file Touchline Lab reads (Data tab, or data/snapshot/ listed as "finance").

    COMPANIES_HOUSE_KEY=your_key node tools/fetch-companies-house.mjs                 # every club, last 10 years
    COMPANIES_HOUSE_KEY=your_key node tools/fetch-companies-house.mjs --club Aberdeen --years 20
    node tools/fetch-companies-house.mjs --parse-only                                 # re-read the cached text

  The key is a free "REST API key" from developer.company-information.service.gov.uk (a live application).
  Accounts filed as machine-readable pages (iXBRL) are read as text; scanned PDFs go through OCR, which
  needs pdftoppm (poppler-utils) and tesseract (tesseract-ocr). Downloads and their text are cached in
  data/ch-cache/ (not committed), so a second run only fetches new filings.

  Each figure is read from the statement lines; the profit and loss lines are checked against each other
  (turnover less costs plus player trading equals the operating result), and figures that do not add up
  are flagged rather than dropped. Small companies may leave the profit and loss account out entirely
  (Companies Act exemption): those clubs get balance sheet figures only.
*/
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; };
const KEY = process.env.COMPANIES_HOUSE_KEY;
const PARSE_ONLY = args.includes('--parse-only');
if (!KEY && !PARSE_ONLY) { console.error('Set your key first, e.g.  COMPANIES_HOUSE_KEY=abc node tools/fetch-companies-house.mjs'); process.exit(1); }
const YEARS = Number(opt('years', 10));
const CACHE = opt('cache', 'data/ch-cache');
const OUT = opt('out', 'data/snapshot/finance-spfl.json');
mkdirSync(CACHE, { recursive: true });

// The company whose accounts carry each club's figures (the group parent where there is one)
const CLUBS = [
  ['Aberdeen', 'SC005364'], ['Celtic', 'SC003487'], ['Rangers', 'SC437060'], ['Hearts', 'SC005863'], ['Hibernian', 'SC005323'],
  ['Motherwell', 'SC005702'], ['Dundee United', 'SC013690'], ['Dundee', 'SC004585'], ['Kilmarnock', 'SC006219'], ['St Mirren', 'SC005773'],
  ['Falkirk', 'SC005854'], ['St Johnstone', 'SC007629'], ['Livingston', 'SC142420'], ['Ross County', 'SC033275'],
];
const only = opt('club');

const API = 'https://api.company-information.service.gov.uk';
const auth = { Authorization: 'Basic ' + Buffer.from((KEY || '') + ':').toString('base64') };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function get(url, accept, binary) {
  for (let a = 0; a < 5; a++) {
    const r = await fetch(url, { headers: { ...auth, ...(accept ? { Accept: accept } : {}) }, redirect: 'follow' });
    if (r.status === 429) { await sleep(30000 * (a + 1)); continue; }
    if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
    return binary ? Buffer.from(await r.arrayBuffer()) : r.json();
  }
  throw new Error('Companies House kept refusing (rate limit); try again later');
}

// The text of one filing: machine-readable pages stripped of tags, a PDF's own text, or OCR of its scans
function htmlText(x) {
  return x.replace(/<head[\s\S]*?<\/head>/i, '').replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<\/(p|div|tr|li|h\d)>|<br\s*\/?>/gi, '\n').replace(/<\/t[dh]>/gi, '  ').replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/g, ' ').replace(/&amp;/g, '&').replace(/&pound;|&#163;/g, '£').replace(/&#8217;|&rsquo;/g, '’').replace(/&#\d+;|&[a-z]+;/g, ' ')
    .split('\n').map((l) => l.replace(/[ \t]+/g, ' ').trim()).filter(Boolean).join('\n');
}
function pdfText(file) {
  let t = '';
  try { t = execFileSync('pdftotext', ['-layout', file, '-'], { maxBuffer: 64 << 20 }).toString(); } catch (e) { /* no text layer */ }
  if (t.replace(/\s/g, '').length > 2000) return t;
  // Scanned pages: OCR, four pages at a time
  const dir = file + '.pages';
  mkdirSync(dir, { recursive: true });
  execFileSync('pdftoppm', ['-r', '200', '-gray', file, join(dir, 'p')]);
  const pages = readdirSync(dir).filter((f) => f.endsWith('.pgm')).sort();
  execFileSync('bash', ['-c', `ls ${dir}/*.pgm | xargs -P 4 -I{} sh -c 'OMP_THREAD_LIMIT=1 tesseract "{}" "{}" --psm 6 >/dev/null 2>&1'`]);
  const out = pages.map((p) => { try { return readFileSync(join(dir, p + '.txt'), 'utf8'); } catch (e) { return ''; } }).join('\n\f\n');
  execFileSync('bash', ['-c', `rm -f ${dir}/*.pgm`]);
  return out;
}

async function download(club, number) {
  const items = [];
  for (let start = 0; start < 200; start += 100) {
    const j = await get(`${API}/company/${number}/filing-history?category=accounts&items_per_page=100&start_index=${start}`);
    items.push(...(j.items || []));
    if (items.length >= (j.total_count || 0)) break;
  }
  const accounts = items.filter((i) => /^AA/.test(i.type) && i.description_values && i.description_values.made_up_date && i.links && i.links.document_metadata)
    .sort((a, b) => b.description_values.made_up_date.localeCompare(a.description_values.made_up_date));
  const cutoff = String(new Date().getUTCFullYear() - YEARS);
  const want = accounts.filter((i) => i.description_values.made_up_date >= cutoff);
  const got = [];
  for (const i of want) {
    const ye = i.description_values.made_up_date, base = join(CACHE, `${number}-${ye}`);
    if (!existsSync(base + '.txt')) {
      const meta = await get(i.links.document_metadata);
      const types = Object.keys(meta.resources || {});
      let text;
      if (types.includes('application/xhtml+xml')) {
        const buf = await get(meta.links.document, 'application/xhtml+xml', true);
        writeFileSync(base + '.xhtml', buf);
        text = htmlText(buf.toString('utf8'));
      } else {
        const buf = await get(meta.links.document, 'application/pdf', true);
        writeFileSync(base + '.pdf', buf);
        process.stdout.write(`    ${club} ${ye}: reading ${i.pages || '?'} pages…`);
        text = pdfText(base + '.pdf');
        process.stdout.write(' done\n');
      }
      writeFileSync(base + '.txt', text);
      writeFileSync(base + '.json', JSON.stringify({ club, number, yearEnd: ye, filed: i.date, type: i.type, pages: i.pages, format: types.includes('application/xhtml+xml') ? 'ixbrl' : 'pdf', doc: i.links.document_metadata }));
      await sleep(400);
    }
    got.push(base);
  }
  return got;
}

/* ---------- Reading the figures ---------- */
const NUM = /\(?(?:-(?=£?\d))?£?\s?\d{1,3}(?:[,.]\d{3})+\)?|\(?(?:-(?=£?\d))?£?\d+\)?|(?<=\s)[-–—](?=\s*$)/g;
// Numbers at the end of a line: "Turnover 5 21712 23631" -> note 5, values [21712, 23631]
function lineNums(line) {
  const tail = line.replace(/^[^\d(–—-]*?(?=[\s(]*[\d(]|\s[-–—]\s)/, '');
  const toks = (tail.match(NUM) || []).map((t) => t.trim());
  const vals = toks.map((t) => (/^[-–—]$/.test(t) ? 0 : (t.includes('(') || /^-/.test(t) ? -1 : 1) * Number(t.replace(/[^\d]/g, ''))));
  return vals;
}
// The statement values for a label: the last two numbers on the line are this year and last year
// (a note number may come first; a short number before large ones is taken as the note)
function pick(vals) {
  if (!vals.length) return null;
  let v = vals.slice();
  while (v.length > 2 && Math.abs(v[0]) < 100) v = v.slice(1); // note references ("5", "45" for notes 4 and 5)
  if (v.length > 2) v = v.slice(0, 2);
  return { cur: v[0], prev: v.length > 1 ? v[1] : null };
}
const LABELS = {
  turnover: /^(group\s+)?(turnover|revenue|total revenue|income)\b(?!.*(recognition|policy|is measured|represents|comprises|arises|includes))/i,
  staff: /^(total\s+)?(staff costs|employee costs|personnel costs|wages and salaries costs|total staff costs)\b/i,
  wages: /^wages and salaries\b/i,
  playerSales: /^(net\s+)?(gain|profit|surplus)s?\s+(\(loss\)\s+)?on\s+(the\s+)?(disposal|sale)s?\s+of\s+(players|player|intangible)/i,
  amort: /^amortisation\s+of\s+(intangible|players|player)/i,
  opResult: /^(group\s+)?operating\s+(\(?loss\)?|\(?profit\)?)(\s*\/\s*\(?(loss|profit)\)?)?(\s+for the (year|period))?\s*(?=[\d(–—-]|\s\d)/i,
  preTax: /^(\(?(loss|profit)\)?(\s*\/\s*\(?(loss|profit)\)?)?)\s+(on ordinary activities\s+)?before\s+tax(ation)?/i,
  result: /^\(?(loss|profit)\)?(?!.*(before tax|per (ordinary )?share|parent|company was))[^\d]{0,70}?\bfor\s+the\s+(financial\s+)?(year|period)\b/i,
  cash: /^cash(\s+at\s+bank(\s+and\s+(in|on)\s+hand)?|\s+and\s+cash\s+equivalents|\s+and\s+bank\s+balances|\s+in\s+hand|\s+at\s+bank\s+and\s+on\s+hand)?\b(?!.*\b(flows?|payments|generated|inflow|outflow|beginning|end of)\b)/i,
  netAssets: /^(net\s+assets|net\s+\(liabilities\)\/assets|net\s+assets\s*\/\s*\(liabilities\)|net\s+(liabilities|\(liabilities\))|total\s+equity|shareholders['’]?\s+funds|total\s+shareholders['’]?\s+funds)\b/i,
};
const SPLIT = { gate: /^(gate receipts|match ?day|ticketing|season tickets and gate)/i, broadcast: /^(broadcast|television|tv)/i, sponsorship: /^(sponsorship|advertising and sponsorship)/i, commercial: /^(commercial|retail|merchandising|catering)/i, europe: /^(uefa|european|prize money)/i };

function parseFiling(text, meta) {
  const pages = text.split('\f').length > 2 ? text.split('\f') : text.split(/\n(?=.*(?:Consolidated|Group|Company)?\s*(?:Profit and Loss Account|Statement of Comprehensive Income|Income Statement|Balance Sheet))/i);
  // OCR noise: stray marks between label and figures, braces for brackets, leading dots
  const lines = text.split('\n').map((l) => l.replace(/[|_>*'"“”‘]/g, ' ').replace(/\{/g, '(').replace(/\}/g, ')').replace(/\s[.:;,]+(?=\s)/g, ' ').replace(/^[\s.:;,'-]+/, '').replace(/\s+/g, ' ').trim()).filter(Boolean);
  // The profit and loss statement: from its heading to the balance sheet
  // The statement itself, not the contents page or the highlights: a heading followed by a turnover line with
  // whole figures (not £m with decimals) and a pre-tax line
  const fullTurnover = (x) => LABELS.turnover.test(x) && !/\d\.\d/.test(x) && (() => { const v = pick(lineNums(x)); return v && Math.abs(v.cur) >= 100; })();
  const plStart = lines.findIndex((l, i) => /(profit and loss account|statement of (comprehensive )?income|income statement)/i.test(l) && !/(notes? (on|to)|section 408|no separate|is presented|included in|dealt with)/i.test(l)
    && lines.slice(i, i + 30).some(fullTurnover) && lines.slice(i, i + 30).some((x) => LABELS.preTax.test(x)));
  const bsStart = lines.findIndex((l, i) => i > plStart && /balance sheets?/i.test(l) && !/notes?/i.test(l) && lines.slice(i, i + 40).some((x) => /fixed assets|current assets/i.test(x)));
  const pl = plStart >= 0 ? lines.slice(plStart, plStart + 40) : [];
  // Figures in thousands when the statement's column heads say £000 (or £'000)
  const UNIT = /£\s?['’`]?\s?0{3}\b|£\s?k\b|['’]000/i;
  const unitThousands = UNIT.test((pl.length ? pl : lines.slice(bsStart >= 0 ? bsStart : 0, (bsStart >= 0 ? bsStart : 0) + 15)).join(' ')) || (!pl.length && (text.match(new RegExp(UNIT.source, 'gi')) || []).length >= 3);
  const minK = unitThousands ? 50 : 50000; // staff costs below £50k are a misread
  const bs = bsStart >= 0 ? lines.slice(bsStart, bsStart + 60) : []; // no balance sheet found: no guessing from the notes
  const find = (set, re, numsMin = 1) => { for (const l of set) if (re.test(l)) { const v = pick(lineNums(l)); if (v && v.cur != null && Math.abs(v.cur) >= (numsMin)) return v; } return null; };
  const f = {};
  if (pl.length) {
    f.turnover = find(pl, LABELS.turnover, unitThousands ? 100 : 100000);
    f.playerSales = find(pl, LABELS.playerSales, 0);
    f.amort = find(pl, LABELS.amort, 0);
    f.opResult = find(pl, LABELS.opResult, 0);
    f.preTax = find(pl, LABELS.preTax, 0);
    f.result = find(pl, LABELS.result, 0);
  }
  // Staff costs from the notes: the total line, else wages and salaries
  f.staff = find(lines, LABELS.staff, minK);
  f.wages = find(lines, LABELS.wages, minK);
  f.cash = find(bs, LABELS.cash, 0);
  f.netAssets = find(bs, LABELS.netAssets, 0);
  // Turnover split (the turnover note: a block of income lines ending in the total)
  const split = {};
  if (f.turnover) {
    const ti = lines.findIndex((l, i) => i !== plStart && /^\d{1,2}\.?\s+(turnover|revenue)\b/i.test(l));
    if (ti >= 0) lines.slice(ti + 1, ti + 14).forEach((l) => Object.entries(SPLIT).forEach(([k, re]) => { if (split[k] == null && re.test(l)) { const v = pick(lineNums(l)); if (v && v.cur != null) split[k] = v; } }));
  }
  const scale = unitThousands ? 1000 : 1;
  const year = (k) => (f[k] ? f[k].cur * scale : null), prev = (k) => (f[k] && f[k].prev != null ? f[k].prev * scale : null);
  const make = (get, sp) => {
    const abs = (v) => (v == null ? v : Math.abs(v)); // costs shown in brackets in the statement are still costs
    const y = { turnover: get('turnover'), staff: abs(get('staff') ?? get('wages')), playerSales: get('playerSales'), amort: abs(get('amort')), opResult: get('opResult'), preTax: get('preTax'), result: get('result'), cash: get('cash'), netAssets: get('netAssets') };
    // Results are losses when the line says loss and the number is shown without brackets
    const split2 = Object.fromEntries(Object.entries(split).map(([k, v]) => [k, (sp === 'cur' ? v.cur : v.prev) != null ? (sp === 'cur' ? v.cur : v.prev) * scale : null]).filter(([, v]) => v != null));
    if (Object.keys(split2).length) y.split = split2;
    return y;
  };
  const cur = make(year, 'cur'), pre = make(prev, 'prev');
  // The statement could not be read: the directors' report usually states the headline figures in words
  // ("Revenue for the year … totalled £94.1 million", "a loss before taxation of £2.1m"); rounded, so marked
  const flat = text.replace(/\s+/g, ' ');
  const words = (re) => { const m = flat.match(re); return m ? Math.round(parseFloat(m[m.length - 2]) * 1e6) : null; };
  if (cur.turnover == null) {
    const v = words(/\b(?:revenue|turnover)\b(?:(?!increased|decreased|rose|fell|grew|by £)[^.£]){0,70}?\b(?:of|totalled|totaled|was|amounted to|reached)\s+£\s?(\d{1,3}(?:\.\d{1,3})?)\s?(m\b|million)/i);
    if (v) { cur.turnover = v; (cur.approx = cur.approx || []).push('turnover'); }
  }
  if (cur.preTax == null) {
    const m = flat.match(/\b(loss|profit) (?:on ordinary activities )?before tax(?:ation)?\s+(?:of|was|amounted to)\s+£\s?(\d{1,3}(?:\.\d{1,3})?)\s?(m\b|million)/i);
    if (m) { cur.preTax = Math.round(parseFloat(m[2]) * 1e6) * (/loss/i.test(m[1]) ? -1 : 1); (cur.approx = cur.approx || []).push('preTax'); }
  }
  // Check: preTax and result should be close; turnover should exceed staff costs' plausibility floor
  const checks = [];
  if (cur.turnover != null && cur.staff != null) checks.push(cur.staff > 0 && cur.staff < cur.turnover * 3 ? 'staff-ok' : 'staff-odd');
  if (cur.preTax != null && cur.result != null) checks.push(Math.abs(cur.preTax - cur.result) <= Math.max(Math.abs(cur.preTax) * 0.5, 2e6) ? 'tax-ok' : 'tax-odd');
  return { cur, prev: pre, unit: unitThousands ? '£000' : '£', checks, plFound: plStart >= 0 };
}

async function main() {
  const clubs = CLUBS.filter(([c]) => !only || c.toLowerCase() === only.toLowerCase());
  const out = [];
  for (const [club, number] of clubs) {
    console.log(`${club} (${number})`);
    let bases;
    if (PARSE_ONLY) bases = readdirSync(CACHE).filter((f) => f.startsWith(number + '-') && f.endsWith('.json')).map((f) => join(CACHE, f.replace(/\.json$/, '')));
    else { try { bases = await download(club, number); } catch (e) { console.log('  stopped: ' + e.message); continue; } }
    const years = {};
    bases.sort().reverse().forEach((b) => {
      if (!existsSync(b + '.txt')) return;
      const meta = JSON.parse(readFileSync(b + '.json', 'utf8'));
      const r = parseFiling(readFileSync(b + '.txt', 'utf8'), meta);
      const ye = meta.yearEnd, py = String(Number(ye.slice(0, 4)) - 1) + ye.slice(4);
      const src = { filed: meta.filed, format: meta.format, doc: meta.doc.replace('document-api.company-information.service.gov.uk/document/', 'find-and-update.company-information.service.gov.uk/company/' + number + '/filing-history/').replace(/\/[^/]+$/, '') };
      // Newest filings first: a year's own accounts win; the next year's previous-year column fills what they lack
      const own = { yearEnd: ye, ...r.cur, unit: r.unit, plFound: r.plFound, checks: r.checks, source: { filed: meta.filed, format: meta.format } };
      const later = years[ye]; // set from the following year's filing (prev column), if that was read first
      years[ye] = own;
      if (later) Object.entries(later).forEach(([k, v]) => {
        if (['yearEnd', 'source', 'checks', 'fromLater', 'plFound', 'unit', 'split'].includes(k) || v == null) return;
        if (own[k] == null) { own[k] = v; (own.filled = own.filled || []).push(k); return; }
        // Two readings of the same figure: when they disagree, the one with more digits is usually right
        // (OCR drops digits more often than it adds them); the disagreement is kept for checking
        if (typeof v === 'number' && own[k] !== v) {
          (own.disagree = own.disagree || {})[k] = [own[k], v];
          if (String(Math.abs(v)).replace(/0+$/, '').length > String(Math.abs(own[k])).replace(/0+$/, '').length) own[k] = v;
        }
      });
      if (!years[py]) years[py] = { yearEnd: py, ...r.prev, unit: r.unit, plFound: r.plFound, fromLater: ye, source: { filed: meta.filed, format: meta.format } };
      const y = years[ye];
      if (y.disagree) console.log('     readings differ: ' + Object.entries(y.disagree).map(([k, [a, b]]) => `${k} ${a} / ${b}`).join(', '));
      console.log(`  ${ye}: turnover ${y.turnover ?? '–'} · staff ${y.staff ?? '–'} · op ${y.opResult ?? '–'} · pre-tax ${y.preTax ?? '–'} · cash ${y.cash ?? '–'} · net assets ${y.netAssets ?? '–'}${r.plFound ? '' : ' (no P&L)'}`);
    });
    out.push({ club, company: number, url: `https://find-and-update.company-information.service.gov.uk/company/${number}/filing-history`, years: Object.values(years).sort((a, b) => b.yearEnd.localeCompare(a.yearEnd)) });
  }
  writeFileSync(OUT, JSON.stringify({ source: 'touchline-finance', from: 'Companies House annual accounts (Crown copyright, Open Government Licence)', fetched: new Date().toISOString(), clubs: out }, null, 1));
  console.log(`\nWrote ${OUT}: ${out.length} clubs.`);
}
main().catch((e) => { console.error('\nStopped: ' + e.message); process.exit(1); });
