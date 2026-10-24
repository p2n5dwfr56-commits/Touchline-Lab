#!/usr/bin/env node
// Opens a built page in headless Chromium and checks it starts on real data without errors, at desktop
// and phone widths, and that the main tabs render.  node tools/smoke-test.mjs dist/index-snapshot.html
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let pw;
try { pw = require('playwright'); } catch (e) { pw = require('/opt/node22/lib/node_modules/playwright/index.js'); }
const src = resolve(process.argv[2] || 'dist/index-snapshot.html');
// The artifact host wraps the page in a document; do the same
const page = join(mkdtempSync(join(tmpdir(), 'tl-smoke-')), 'page.html');
writeFileSync(page, '<!doctype html><html><head><meta charset="utf-8"></head><body>' + readFileSync(src, 'utf8') + '</body></html>');
const b = await pw.chromium.launch();
let bad = 0;
for (const w of [1300, 400]) {
  const p = await (await b.newContext({ viewport: { width: w, height: 900 } })).newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  await p.goto('file://' + page);
  await p.waitForSelector('.kpis', { timeout: 90000 });
  const chip = await p.textContent('.chip');
  if (!/to \d/.test(chip)) errs.push('not on the built-in data: ' + chip);
  for (const t of ['Matches', 'Ref Watch', 'Seasons']) { await p.click(`.tabs button:has-text("${t}")`); await p.waitForTimeout(300); }
  const text = await p.evaluate(() => document.body.innerText);
  if (/\bNaN\b|undefined/.test(text)) errs.push('NaN or undefined on the page');
  console.log(`smoke ${w}px: ${chip.trim()} · ${errs.length ? 'FAILED ' + errs.join('; ') : 'ok'}`);
  bad += errs.length;
}
await b.close();
process.exit(bad ? 1 : 0);
