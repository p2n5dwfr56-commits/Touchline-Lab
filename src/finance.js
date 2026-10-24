'use strict';
/* =====================================================================
   Finances tab: club accounts filed at Companies House
   Reads the file written by tools/fetch-companies-house.mjs: turnover
   and its split, staff costs, player trading, results, cash and net
   assets per club and financial year, set against league finishes.
   ===================================================================== */

// Club key -> { club, company, url, years: [{ yearEnd, turnover, staff, ... }] }
const FIN = {};
let FIN_FROM = '';
const isFinanceFile = (d) => d && d.source === 'touchline-finance' && Array.isArray(d.clubs);
function addFinanceFile(d) {
  FIN_FROM = d.from || FIN_FROM;
  d.clubs.forEach((c) => { FIN[fbTeamKey(c.club)] = c; });
  return { clubs: d.clubs.length, years: d.clubs.reduce((t, c) => t + c.years.length, 0) };
}
async function saveFinanceFile(f) { return storeSet('finance', { name: f.name, text: f.text }); }
async function restoreFinance() {
  if (SNAP && SNAP.finance) [].concat(SNAP.finance).forEach(addFinanceFile);
  const saved = await storeGet('finance');
  if (saved) { try { addFinanceFile(JSON.parse(saved.text)); } catch (e) { /* skip a damaged file */ } }
}

// The football season a financial year mostly covers: a year ending in May or June 2025 is 2024/25
const finSeason = (ye) => { const y = +ye.slice(0, 4), m = +ye.slice(5, 7); const s = m <= 7 ? y - 1 : y; return s + '/' + String((s + 1) % 100).padStart(2, '0'); };
const money = (v, d = 1) => (v == null || !Number.isFinite(v) ? '–' : (v < 0 ? '−' : '') + '£' + (Math.abs(v) >= 1e6 ? (Math.abs(v) / 1e6).toFixed(d) + 'm' : Math.abs(v) >= 1e3 ? Math.round(Math.abs(v) / 1e3) + 'k' : Math.abs(v)));
const ratio = (y) => (y && y.staff != null && y.turnover ? (100 * y.staff) / y.turnover : NaN);
const finYears = (c) => (c ? c.years.filter((y) => y.turnover != null || y.netAssets != null || y.preTax != null).sort((a, b) => a.yearEnd.localeCompare(b.yearEnd)) : []);

function viewFinance(el) {
  const key = fbTeamKey(teamName(S.team));
  const clubs = Object.entries(FIN);
  if (!clubs.length) {
    el.append(card({ title: 'Finances', span: true }, null, h('p', { class: 'note', style: { marginTop: 0 }, text: 'No club accounts are loaded. Run tools/fetch-companies-house.mjs with a free Companies House API key, then drop the file it writes in the Data tab.' })));
    return;
  }
  const C = FIN[key], ys = finYears(C);
  const A = css('--team-a'), B = css('--ink-2');
  el.append(h('div', { class: 'hero' }, h('h1', { text: teamName(S.team) }), h('div', { class: 'meta' },
    h('span', { text: C ? `Annual accounts · ${ys.length} financial years · company ${C.company}` : 'No accounts loaded for this club' }))));
  const grid = h('div', { class: 'grid' });
  el.append(grid);

  if (C && ys.length) {
    // Headline tiles: the latest year with a full profit and loss account (a newer year may hold only a rounded turnover)
    const fullYs = ys.filter((y) => y.turnover != null && y.preTax != null);
    const li = fullYs.length ? ys.indexOf(fullYs[fullYs.length - 1]) : ys.length - 1;
    const last = ys[li], prev = ys[li - 1];
    const noPL = last.turnover == null;
    const tiles = [
      ['Turnover', last.turnover, prev && prev.turnover], ['Staff costs', last.staff, prev && prev.staff], ['Wages / turnover', ratio(last), prev ? ratio(prev) : NaN, '%'],
      ['Player sales profit', last.playerSales, prev && prev.playerSales], ['Pre-tax result', last.preTax, prev && prev.preTax], ['Cash', last.cash, prev && prev.cash], ['Net assets', last.netAssets, prev && prev.netAssets],
    ].filter(([, v]) => v != null && Number.isFinite(v));
    el.insertBefore(h('div', { class: 'kpis' }, tiles.map(([l, v, p, u]) => {
      const ch = p != null && Number.isFinite(p) ? v - p : null;
      return h('div', { class: 'kpi' }, h('div', { class: 'eyebrow', text: l }), h('div', { class: 'v', text: u === '%' ? v.toFixed(0) + '%' : money(v) }),
        h('div', { class: 'r', text: `Year to ${fmtYE(last.yearEnd)}` + (ch != null ? ` · ${ch >= 0 ? '+' : '−'}${u === '%' ? Math.abs(ch).toFixed(0) + ' pts' : money(Math.abs(ch))} on the year before` : '') }));
    })), grid);
    if (noPL) grid.append(card({ title: 'Profit and loss', span: true }, null, h('p', { class: 'note', style: { marginTop: 0 }, text: `${C.club} file small-company accounts, which may leave out the profit and loss account (a Companies Act exemption), so turnover and wages are not on the public record. Balance sheet figures are shown where filed.` })));

    // Turnover and staff costs by year
    const pl = ys.filter((y) => y.turnover != null);
    if (pl.length >= 2) {
      const c1 = card('Turnover and staff costs', 'By financial year · staff costs include wages, national insurance and pensions');
      const b1 = h('div'); c1.append(b1);
      const c2 = card('Results and player trading', 'Pre-tax profit or loss, and the profit on selling players, by financial year');
      const b2 = h('div'); c2.append(b2);
      grid.append(c1, c2); // both in place first, so each chart is drawn at its own width
      lineChart(b1, { labels: pl.map((y) => fmtYE(y.yearEnd, true)), series: [{ name: 'Turnover', color: A, values: pl.map((y) => y.turnover / 1e6) }, { name: 'Staff costs', color: B, dash: '5 4', values: pl.map((y) => (y.staff != null ? y.staff / 1e6 : NaN)) }],
        yFmt: (v) => '£' + v.toFixed(0) + 'm', tipFor: (i) => { const y = pl[i]; return [{ v: 'Year to ' + fmtYE(y.yearEnd), strong: true }, { color: A, v: money(y.turnover), l: 'turnover' }, { color: B, v: money(y.staff), l: 'staff costs' }, Number.isFinite(ratio(y)) ? { v: ratio(y).toFixed(0) + '% wages to turnover' } : null].filter(Boolean); } });
      c1.append(legend([['Turnover', A, 'line'], ['Staff costs', B, 'line line-dash']]));

      // Results and player trading
      c2.append(finBars(b2, pl, [['preTax', 'Pre-tax result', A], ['playerSales', 'Player sales profit', css('--c3')]]));
    }
    // Turnover split, where the notes give one
    const sp = ys.filter((y) => y.split && Object.keys(y.split).length >= 2);
    if (sp.length) {
      const KEYS = [['gate', 'Gate & matchday'], ['commercial', 'Commercial'], ['sponsorship', 'Sponsorship'], ['broadcast', 'Broadcasting'], ['europe', 'UEFA & prize money']];
      const keys = KEYS.filter(([k]) => sp.some((y) => y.split[k] != null));
      grid.append(card({ title: 'Where the money comes from', span: true }, 'Turnover split from the notes to the accounts', h('div', { class: 'tbl-wrap' }, h('table', null,
        h('thead', null, h('tr', null, h('th', { class: 'l', text: 'Year to' }), keys.map(([, l]) => h('th', { text: l })), h('th', { text: 'Turnover' }))),
        h('tbody', null, sp.slice().reverse().map((y) => h('tr', { style: { cursor: 'default' } }, h('td', { class: 'l' }, h('b', { text: fmtYE(y.yearEnd) })), keys.map(([k]) => h('td', { text: y.split[k] != null ? money(y.split[k]) + (y.turnover ? ' · ' + Math.round((100 * y.split[k]) / y.turnover) + '%' : '') : '–' })), h('td', null, h('b', { text: money(y.turnover) })))))))));
    }
    // Year by year
    grid.append(card({ title: 'Year by year', span: true }, `${C.club} · as filed at Companies House · figures in £`, h('div', { class: 'tbl-wrap' }, h('table', null,
      h('thead', null, h('tr', null, ['Year to', 'Season', 'Turnover', 'Staff costs', 'Wages / turnover', 'Player sales', 'Operating result', 'Pre-tax', 'Cash', 'Net assets', 'League'].map((t, i) => h('th', { class: i < 2 ? 'l' : '', text: t })))),
      h('tbody', null, ys.slice().reverse().map((y) => {
        const s = finSeason(y.yearEnd), P = seasonPositions()[s], me = P && P[key];
        return h('tr', { style: { cursor: 'default' }, title: y.fromLater ? `From the previous-year column of the accounts to ${fmtYE(y.fromLater)}` : '' },
          h('td', { class: 'l' }, h('b', { text: fmtYE(y.yearEnd) }), y.fromLater ? h('span', { class: 'sub', text: ' *' }) : null), h('td', { class: 'l sub', text: s }),
          ['turnover', 'staff'].map((k) => fcell(y, k)), h('td', { text: Number.isFinite(ratio(y)) ? ratio(y).toFixed(0) + '%' : '–' }),
          ['playerSales', 'opResult', 'preTax', 'cash', 'netAssets'].map((k) => fcell(y, k)),
          h('td', { class: 'sub', text: me ? ordinal(me.pos) : '' }));
      })))),
      h('p', { class: 'note' }, 'Operating result is as each set of accounts states it: some clubs and years show it before player sales, others after, so compare turnover, staff costs and pre-tax results across clubs. * from the previous-year column of the next year’s accounts. † two sets of accounts give different figures (hover for both). ≈ rounded figure from the directors’ report where the statement page could not be read. Filings: ',
        h('a', { href: C.url, target: '_blank', rel: 'noopener', text: 'Companies House' }), '.')));
  } else grid.append(card({ title: 'Finances', span: true }, null, h('p', { class: 'note', style: { marginTop: 0 }, text: `No accounts are loaded for ${teamName(S.team)}. The loaded file covers: ${clubs.map(([, c]) => c.club).join(', ')}.` })));

  leagueFinance(grid, key);
}
// A table cell for one figure; † where two sets of accounts give different numbers for that year
function fcell(y, k) {
  const v = y[k], d = y.disagree && y.disagree[k];
  if (y.approx && y.approx.includes(k)) return h('td', { class: v != null && v < 0 ? 'neg' : '', title: 'Rounded figure from the directors’ report: the statement page could not be read' }, '≈' + money(v));
  return h('td', { class: v != null && v < 0 ? 'neg' : '', title: d ? `This year's accounts read ${money(d[0])}; the next year's comparative reads ${money(d[1])} (a restatement, or a misread in the scanned page)` : null }, money(v), d ? h('sup', { class: 'sub', text: '†' }) : null);
}
const fmtYE = (ye, short) => { const d = new Date(ye + 'T12:00:00Z'); return short ? d.toLocaleDateString('en-GB', { month: 'short', year: '2-digit' }) : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }); };

// Bars above and below zero for each year, one colour per measure
function finBars(box, ys, measures) {
  const W = Math.max(280, box.clientWidth || 600), H = 220, m = { l: 46, r: 10, t: 12, b: 26 };
  const vals = ys.flatMap((y) => measures.map(([k]) => y[k]).filter((v) => v != null));
  const mx = Math.max(1, ...vals.map(Math.abs)), lo = Math.min(0, ...vals), hi = Math.max(0, ...vals);
  const Y = (v) => m.t + ((hi - v) * (H - m.t - m.b)) / (hi - lo || 1);
  const svg = sv('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', role: 'img', 'aria-label': measures.map((x) => x[1]).join(' and ') + ' by year' });
  const ax = sv('g', { class: 'axis' });
  const step = Math.pow(10, Math.floor(Math.log10(mx / 1e6 || 1))) * 1e6 * (mx / 1e6 / Math.pow(10, Math.floor(Math.log10(mx / 1e6 || 1))) > 5 ? 2 : 1);
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1; v += step) { ax.append(sv('line', { x1: m.l, x2: W - m.r, y1: Y(v), y2: Y(v), class: v === 0 ? 'baseline' : 'grid-line' })); ax.append(sv('text', { x: m.l - 6, y: Y(v) + 4, 'text-anchor': 'end', text: money(v, 0) })); }
  const bw = (W - m.l - m.r) / ys.length;
  ys.forEach((y, i) => ax.append(sv('text', { x: m.l + bw * i + bw / 2, y: H - 8, 'text-anchor': 'middle', text: fmtYE(y.yearEnd, true) })));
  svg.append(ax);
  ys.forEach((y, i) => measures.forEach(([k, l, col], j) => {
    const v = y[k];
    if (v == null) return;
    const w = (bw * 0.7) / measures.length, x = m.l + bw * i + bw * 0.15 + j * w;
    const r = sv('rect', { x, y: Math.min(Y(v), Y(0)), width: w - 1, height: Math.max(1, Math.abs(Y(v) - Y(0))), fill: col, opacity: v < 0 ? 0.75 : 1, rx: 2, tabindex: 0 });
    hover(r, () => [{ v: 'Year to ' + fmtYE(y.yearEnd), strong: true }, { color: col, v: money(v), l }]);
    svg.append(r);
  }));
  box.append(svg);
  return legend(measures.map(([, l, c]) => [l, c]));
}

// Every club's latest year side by side, and wages against league points
function leagueFinance(grid, key) {
  const P = seasonPositions();
  const rows = Object.entries(FIN).map(([k, c]) => {
    const ys = finYears(c), full = ys.filter((y) => y.turnover != null && y.preTax != null), plYs = ys.filter((y) => y.turnover != null);
    const y = full[full.length - 1] || plYs[plYs.length - 1] || ys[ys.length - 1]; // the latest year with a full profit and loss account
    if (!y) return null;
    const s = finSeason(y.yearEnd), lg = P[s] && P[s][k];
    return { k, c, y, s, lg };
  }).filter(Boolean).sort((a, b) => (b.y.turnover || 0) - (a.y.turnover || 0) || a.c.club.localeCompare(b.c.club));
  if (rows.length < 2) return;
  grid.append(card({ title: 'Premiership clubs compared', span: true }, 'Each club’s latest accounts with a profit and loss account · year ends differ (May or June), so the season shown is the one each year mostly covers', h('div', { class: 'tbl-wrap' }, h('table', null,
    h('thead', null, h('tr', null, ['Club', 'Year to', 'Turnover', 'Staff costs', 'Wages / turnover', 'Player sales', 'Pre-tax', 'Net assets', 'League that season', 'Staff cost per point'].map((t, i) => h('th', { class: i < 2 ? 'l' : '', text: t })))),
    h('tbody', null, rows.map((r) => h('tr', { class: r.k === key ? 'focus' : '', onclick: () => { const t = DB.teams.find((x) => fbTeamKey(x.name) === r.k); if (t) { S.team = t.id; render(); window.scrollTo({ top: 0, behavior: 'smooth' }); } }, title: 'Show ' + r.c.club },
      h('td', { class: 'l' }, h('b', { text: r.c.club })), h('td', { class: 'l sub', text: fmtYE(r.y.yearEnd) }),
      h('td', { text: money(r.y.turnover) }), h('td', { text: money(r.y.staff) }), h('td', { text: Number.isFinite(ratio(r.y)) ? ratio(r.y).toFixed(0) + '%' : '–' }),
      h('td', { text: money(r.y.playerSales) }), h('td', { class: r.y.preTax != null && r.y.preTax < 0 ? 'neg' : '', text: money(r.y.preTax) }), h('td', { text: money(r.y.netAssets) }),
      h('td', { class: 'sub', text: r.lg ? `${ordinal(r.lg.pos)} · ${r.lg.pts} pts (${r.s})` : '' }), h('td', { text: r.lg && r.y.staff ? money(r.y.staff / r.lg.pts) : '–' }))))))));

  // Staff costs against league points, latest season each club has both
  const pts = rows.filter((r) => r.lg && r.y.staff);
  if (pts.length >= 4) {
    const c = card({ title: 'Wages and points', span: true }, 'Staff costs against league points in the season each financial year covers · the line is the trend across clubs');
    const W = 900, H = 300, m = { l: 56, r: 16, t: 14, b: 36 };
    const xs = pts.map((r) => r.y.staff), ys = pts.map((r) => r.lg.pts);
    // Staff costs on a log scale: the clubs on £4–20m spread out instead of crowding one corner
    const lx = (v) => Math.log10(v), x0 = lx(Math.min(...xs) * 0.8), x1 = lx(Math.max(...xs) * 1.15), y0 = 0, y1 = Math.max(...ys) * 1.1;
    const X = (v) => m.l + ((lx(v) - x0) * (W - m.l - m.r)) / (x1 - x0), Y = (v) => H - m.b - ((v - y0) * (H - m.t - m.b)) / (y1 - y0);
    const svg = sv('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', role: 'img', 'aria-label': 'Staff costs against league points' });
    const ax = sv('g', { class: 'axis' });
    [2e6, 3e6, 5e6, 1e7, 2e7, 4e7, 8e7, 1.6e8].filter((v) => lx(v) >= x0 && lx(v) <= x1).forEach((v) => { ax.append(sv('text', { x: X(v), y: H - 12, 'text-anchor': 'middle', text: money(v, 0) })); ax.append(sv('line', { x1: X(v), x2: X(v), y1: m.t, y2: H - m.b, class: 'grid-line' })); });
    [0, 20, 40, 60, 80, 100].filter((v) => v <= y1).forEach((v) => { ax.append(sv('line', { x1: m.l, x2: W - m.r, y1: Y(v), y2: Y(v), class: v === 0 ? 'baseline' : 'grid-line' })); ax.append(sv('text', { x: m.l - 6, y: Y(v) + 4, 'text-anchor': 'end', text: v })); });
    ax.append(sv('text', { x: W - m.r, y: H - 24, 'text-anchor': 'end', text: 'Staff costs (log scale) →' }));
    ax.append(sv('text', { x: m.l + 4, y: m.t + 10, text: 'League points' }));
    svg.append(ax);
    // Trend: points against the log of staff costs
    const n = pts.length, lxs = xs.map(lx), mxv = lxs.reduce((a, b) => a + b, 0) / n, myv = ys.reduce((a, b) => a + b, 0) / n;
    const sl = lxs.reduce((t, x, i) => t + (x - mxv) * (ys[i] - myv), 0) / (lxs.reduce((t, x) => t + (x - mxv) ** 2, 0) || 1);
    const yAt = (l) => myv + sl * (l - mxv);
    svg.append(sv('line', { x1: X(10 ** x0), y1: Y(yAt(x0)), x2: X(10 ** x1), y2: Y(yAt(x1)), stroke: css('--muted'), 'stroke-dasharray': '5 4', 'stroke-width': 1.5 }));
    // Labels nudged apart where clubs sit close together
    const placed = [];
    pts.slice().sort((a, b) => b.lg.pts - a.lg.pts).forEach((r) => {
      const mine = r.k === key, cx = X(r.y.staff), cy = Y(r.lg.pts);
      const dot = sv('circle', { cx, cy, r: mine ? 7 : 5, fill: mine ? css('--team-a') : css('--c1'), stroke: css('--surface'), 'stroke-width': 1.5, tabindex: 0 });
      hover(dot, () => [{ v: r.c.club + ' · ' + r.s, strong: true }, { v: `${money(r.y.staff)} staff costs · ${r.lg.pts} pts · ${ordinal(r.lg.pos)}` }, { v: `${money(r.y.staff / r.lg.pts)} per point` }]);
      let ly = cy + 4;
      const w = r.c.club.length * 7;
      while (placed.some((q) => Math.abs(q.y - ly) < 13 && cx + 9 < q.x + q.w && cx + 9 + w > q.x)) ly += 13;
      placed.push({ x: cx + 9, y: ly, w });
      svg.append(dot, sv('text', { x: cx + 9, y: ly, class: 'bar-val', text: r.c.club }));
    });
    c.append(svg, h('p', { class: 'note', text: 'Clubs above the line got more points than their wage bill suggests; clubs below got fewer.' }));
    grid.append(c);
  }
  const miss = Object.values(FIN).filter((c) => !finYears(c).some((y) => y.turnover != null)).map((c) => c.club);
  grid.append(h('p', { class: 'note', style: { gridColumn: '1 / -1' }, text: 'Source: annual accounts filed at Companies House (Crown copyright, Open Government Licence), read from the filed documents; scanned accounts are read by text recognition and checked line by line where the statement allows.' + (miss.length ? ` No profit and loss account on file for ${miss.join(', ')} (small-company exemption).` : '') }));
}
