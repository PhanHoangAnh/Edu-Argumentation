#!/usr/bin/env node
/**
 * gate-r-ro.mjs — R-suite: BROWSING WRITES NOTHING; WRITES GO THROUGH ONE PRIMITIVE.
 *
 * ⚑ RE-BASELINED FOR PHASE 04 (23-09-26) — re-baselined, NOT deleted. Phase 03 asserted the
 *   build could not write at all. Phase 04 adds the ten write routes, so the three assertions
 *   now say what must STILL be true once writes exist:
 *     R-RO1  the bundle carries EXACTLY ONE write shape — data/writes.ts:postJson. A second
 *            primitive, or a write literal anywhere else, is a new un-reviewed write path.
 *     R-RO2  (a) a SEEDED pending queue flushes EXACTLY ONCE — one POST /api/progress, and the
 *            queue key is gone afterwards (flushPendingProgress, app.js:1167 — legacy behaviour);
 *            (b) an UNSEEDED full browse sends ZERO non-GET requests, with the positive control.
 *     R-RO3  the store is BYTE-IDENTICAL across that unseeded browse (reading never writes).
 *     R-RO4  (30-09-26) ZERO native browser dialogs (confirm / alert / prompt) in app/frontend/src —
 *            every dialog is the in-app shell/dialog.tsx (user, defect D). Red-first on the old tree.
 *   ⛔ Each was fault-proved red on the Phase-04 build — see the P4 report.
 *
 * (Phase 03's original header follows.) PHASE 03 IS READ-ONLY, PROVED THREE WAYS.
 *
 * edu-replatform Phase 03, checklist E1e. Tier 1/2, browser-backed.
 *
 * ⛔ ONE sha256 AROUND ONE BROWSE IS NOT ENOUGH. It proves THAT BROWSE wrote nothing; it
 *    does not prove the build CANNOT write. Hence three independent assertions.
 *
 * ═══ R-RO1 — the built bundle has ZERO non-GET call sites ════════════════════════════
 * ⛔⛔ THE PLAN'S PATTERN SET IS DEFECTIVE AND IS NARROWED HERE, DELIBERATELY.
 *    It ended with the BARE SUBSTRING `api/progress`. But
 *    `GET /api/progress?module=` is a LEGITIMATE, FROZEN, PHASE-02 READ ROUTE
 *    (queries.ts:146 -> client.ts:29 `fetch(path, { signal })`; `getJson` has NO `method`
 *    parameter at all). Measured on the real bundle:
 *        the 12 method: quotings   0
 *        XMLHttpRequest            0
 *        navigator.sendBeacon      0
 *        api/progress              1   <-- RED ON A CORRECT BUILD
 *    Three independent slices reached that measurement. A substring standing in for a
 *    semantic cannot tell "a write exists" from "a read exists" — the same root defect as
 *    C-10, which could not tell "the guard worked" from "there was nothing there".
 *    THE SET IS THEREFORE NARROWED TO WRITE **SHAPES**, and the old entry is kept below as
 *    a REPORTED counter-measurement so nobody re-adds it.
 *
 * ═══ R-RO2 — no non-GET request leaves the page during a full browse ═════════════════
 * ⛔⛔ THIS ASSERTION IS VACUOUS WITHOUT A SEED AND WITHOUT A POSITIVE CONTROL.
 *    (1) SEED — `flushPendingProgress()` fires on DOMContentLoaded (app.js:3670) but
 *        RETURNS AT app.js:1170 on an empty queue, so Playwright measures zero non-GET
 *        whether or not a write path exists. `page.addInitScript` seeds
 *        localStorage['eduPendingProgress'] with one queued body BEFORE the page loads, so
 *        the assertion is exercised against a queue that WOULD flush.
 *    (2) POSITIVE CONTROL — "zero non-GET observed" is also true of a listener that is not
 *        attached, of a page that never loaded, and of a browser that made no requests at
 *        all. So the gate asserts the listener SAW GET traffic, and then fires ONE
 *        deliberate POST from the page and asserts the listener CAUGHT it. Only then does
 *        a zero mean something. ⚠ The control POST is fired AFTER the browse and is counted
 *        separately; it is not part of the measured window.
 *
 * ═══ R-RO3 — the progress store on disk is byte-identical across the browse ══════════
 * ⛔ The suite's OWN store ($EDU_PROGRESS_PATH / R_PROGRESS_PATH), never the user's live
 *    ~/foxai-data/edu-argumentation/progress.json. Phase 03 is read-only, but pointing a
 *    gate run at a live study file puts it one bug away from a write.
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
// R_REPO lets a COPY of this gate run from outside gates/ (fault-injection harness).
// Default is the real tree, so a normal run needs no environment at all.
const REPO = process.env.R_REPO || path.resolve(DIR, '..');
const BASE = process.env.R_BASE || 'http://127.0.0.1:8795';
const MODULE = process.env.R_MODULE || 'geron-homl3';
const DIST = process.env.R_DIST || path.join(REPO, 'app/frontend/dist');
const PROGRESS = process.env.R_PROGRESS_PATH || '/var/tmp/edu-react-smoke/stores/progress.json';
const PENDING_KEY = 'eduPendingProgress';

const results = [];
const check = (id, pass, detail) => {
  results.push({ id, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${id}  ${detail}`);
};

/* ═════════ R-RO1: the write-SHAPE pattern set ═════════ */
const VERBS = ['POST', 'PUT', 'DELETE', 'PATCH'];
// The three quotings esbuild can emit for an object literal value.
const WRITE_PATTERNS = [
  ...VERBS.flatMap((v) => [`method:"${v}"`, `method:'${v}'`, 'method:`' + v + '`']),
  'XMLHttpRequest',
  'navigator.sendBeacon',
];
// ⛔ REPORTED, NEVER ASSERTED. Kept visible so the false positive is not silently re-added.
const REJECTED_PATTERNS = ['api/progress'];

const assetDir = path.join(DIST, 'assets');
const jsFiles = fs.readdirSync(assetDir).filter((f) => f.endsWith('.js'));
const bundle = jsFiles.map((f) => fs.readFileSync(path.join(assetDir, f), 'utf8')).join('\n');
const countOf = (needle) => bundle.split(needle).length - 1;
const hits = WRITE_PATTERNS.map((p) => [p, countOf(p)]).filter(([, n]) => n > 0);
const rejectedHits = REJECTED_PATTERNS.map((p) => [p, countOf(p)]);

const totalWriteShapes = hits.reduce((n, [, c]) => n + c, 0);
check(`R-RO1 the built bundle contains EXACTLY ONE non-GET WRITE SHAPE — the data/writes.ts postJson primitive (${WRITE_PATTERNS.length} patterns over ${jsFiles.length} file(s))`,
  jsFiles.length > 0 && bundle.length > 1000 && totalWriteShapes === 1,
  `scanned=${jsFiles.join(',')} bytes=${bundle.length} writeShapeHits=${totalWriteShapes} ${JSON.stringify(hits)}`
  + ' (0 = the write path is gone; 2+ = a second, un-reviewed write primitive)'
  + ` | REPORTED-NOT-ASSERTED ${JSON.stringify(rejectedHits)}`);

/* ═════════ R-RO4 (30-09-26, study-rooms-qna P2 defect D): NO NATIVE BROWSER DIALOG ═════════
   User: "why using this browser's popup bruh. It should use its own popup model of the page".
   Every confirm / notice / text prompt goes through shell/dialog.tsx (askConfirm / showNotice /
   askText, rendered by <DialogHost/>). fails when: any file under app/frontend/src calls the
   browser's confirm, alert or prompt — bare, or through window / globalThis / self.
   Comments are stripped first, so a comment NAMING the ban does not trip it; a call does. */
{
  const SRC = path.join(REPO, 'app/frontend/src');
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(dir, e.name)) : /\.(tsx?|jsx?|mjs)$/.test(e.name) ? [path.join(dir, e.name)] : []);
  const files = walk(SRC);
  const NATIVE = /(^|[^\w.$])(?:(?:window|globalThis|self)\s*\.\s*)?(confirm|alert|prompt)\s*\(/g;
  const found = [];
  for (const file of files) {
    const code = fs.readFileSync(file, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
      .replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');
    code.split('\n').forEach((line, i) => {
      for (const m of line.matchAll(NATIVE)) found.push(`${path.relative(SRC, file)}:${i + 1} ${m[2]}(`);
    });
  }
  check(`R-RO4 zero native browser dialogs (confirm / alert / prompt) in app/frontend/src — every dialog is the in-app one (${files.length} files scanned)`,
    files.length > 50 && found.length === 0, `hits=${found.length} ${JSON.stringify(found)}`);
}

/* ═════════ R-RO2(a): a SEEDED queue flushes exactly once ═════════ */
const browser = await chromium.launch({ executablePath: process.env.GATE_CHROME || chromium.executablePath() });
// A VALID completion body on the probe module — the suite's own store, never the user's.
const SEED = { module: 't-progress-probe-md', block: 'ch01-b01', score: 1, total: 1, source: 'written' };
const seedCtx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const seedPage = await seedCtx.newPage();
// ⛔ BEFORE page load. An init script added after goto() never runs for that document — and it
//    must run ONCE, or every reload re-seeds the queue the flush just emptied.
await seedPage.addInitScript(([key, body]) => {
  try {
    if (!window.sessionStorage.getItem('__seeded')) {
      window.localStorage.setItem(key, body);
      window.sessionStorage.setItem('__seeded', '1');
    }
  } catch { /* storage may be blocked */ }
}, [PENDING_KEY, JSON.stringify([SEED])]);
const flushed = [];
seedPage.on('request', (req) => { if (req.method() !== 'GET') flushed.push(`${req.method()} ${new URL(req.url()).pathname}`); });
await seedPage.goto(BASE, { waitUntil: 'networkidle' });
await seedPage.waitForTimeout(2500);
const queueLeft = await seedPage.evaluate((k) => window.localStorage.getItem(k), PENDING_KEY);
await seedCtx.close();

/* ═════════ R-RO2(b) + R-RO3: an UNSEEDED full browse writes nothing ═════════ */
const before = fs.existsSync(PROGRESS)
  ? createHash('sha256').update(fs.readFileSync(PROGRESS)).digest('hex') : 'ABSENT';
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await ctx.newPage();

const observed = { get: 0, nonGet: [], control: 0 };
let windowOpen = true;
page.on('request', (req) => {
  const m = req.method();
  if (!windowOpen) { if (m !== 'GET') observed.control += 1; return; }
  if (m === 'GET') observed.get += 1;
  else observed.nonGet.push(`${m} ${req.url()}`);
});

const gotoBlock = async (ci, bi) => {
  await page.evaluate(([c, b]) => {
    const d = document.querySelectorAll('#toc-nav details')[c];
    if (!d) return;
    d.open = true;
    const btns = d.querySelectorAll('ol li button');
    if (btns[b]) btns[b].click();
  }, [ci, bi]);
  await page.waitForTimeout(700);
};

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
// The default book auto-opens; the card for the open book CLOSES it, so only click if it is not current.
const isCurrent = await page.locator(`#library-grid [data-book="${MODULE}"]`).getAttribute('aria-current');
if (isCurrent !== 'true') {
  await page.locator(`#library-grid [data-book="${MODULE}"]`).click();
  await page.waitForTimeout(1500);
}
await page.locator('#read-tutorial-btn').click();
await page.waitForTimeout(1400);
const chapters = await page.$$eval('#toc-nav details', (d) => d.length);
// Every chapter, three blocks deep.
for (let c = 0; c < chapters; c += 1) for (let b = 0; b < 3; b += 1) await gotoBlock(c, b);
await page.locator('#nav-quiz').click();
await page.waitForTimeout(900);
await page.keyboard.press('Escape');
await page.evaluate(() => document.getElementById('nav-settings')?.click());
await page.waitForTimeout(2100);

/* ---- the positive control: prove the listener CAN see a non-GET ---- */
windowOpen = false;
await page.evaluate(() => fetch('/api/health', { method: 'POST' }).catch(() => {}));
await page.waitForTimeout(900);

const flushOk = flushed.length === 1 && flushed[0] === 'POST /api/progress' && queueLeft === null;
check('R-RO2 a SEEDED queue flushes EXACTLY ONCE, and an UNSEEDED full browse sends ZERO non-GET (positive control)',
  flushOk && observed.nonGet.length === 0 && observed.get > 0 && observed.control === 1 && chapters > 0,
  `seeded-flush=${JSON.stringify(flushed)} queueAfter=${queueLeft === null ? 'empty' : 'NOT EMPTIED <--'}`
  + ` | unseeded: GET=${observed.get} nonGET=${observed.nonGet.length}${observed.nonGet.length ? ' ' + JSON.stringify(observed.nonGet.slice(0, 4)) : ''}`
  + ` control(deliberate POST caught)=${observed.control} chapters=${chapters}`);

await browser.close();

const after = fs.existsSync(PROGRESS)
  ? createHash('sha256').update(fs.readFileSync(PROGRESS)).digest('hex') : 'ABSENT';
check('R-RO3 the progress store is BYTE-IDENTICAL across the UNSEEDED browse (the suite\'s own store, never the user\'s)',
  before === after && before !== 'ABSENT',
  `path=${PROGRESS} before=${before} after=${after}`
  + (before === 'ABSENT' ? ' <-- FLOOR FAILED: no store on disk, so "unchanged" proves nothing' : ''));

console.log(`\n${results.filter((r) => r.pass).length}/${results.length} passed`);
const failed = results.filter((r) => !r.pass);
if (failed.length) console.log('FAILED: ' + failed.map((r) => r.id).join(', '));
if (failed.length) process.exit(1);
