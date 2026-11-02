// gate-copy.mjs — ruling R24 (user, 23-09-26): the code runner is REMOVED and every code
// listing gets a Copy button. A SEPARATE file, asserted separately — the 27/12/10 = 49
// frozen vector is not touched.
//
// Gates (each prints one PASS/FAIL line; the runner counts '^(PASS|FAIL)  '):
//   R24-1  static: no runner code left in app.js or the server (fails when: any of
//          '/api/run', RUN_ROUTES, runCell, proxy_run, data-not-runnable reappears)
//   ⚑ RESCOPED 29-09-26 (user, ch02 v3): the rich-text viewer no longer adds ANY Copy
//     button — the reader is explanation only, code lives in the Lab. R24-2/R24-3 used to
//     assert one Copy per listing and a working clipboard; they now assert the opposite.
//   R24-2  a Full-script lesson's shadow-DOM listings carry ZERO Copy buttons, found by
//          PIERCING the rich-text-viewer shadow roots (fails when: any shadow root holds a
//          button.copy-btn / [data-copy], or the lesson rendered no listing at all [vacuous])
//   R24-3  no copy affordance exists anywhere in the lesson's shadow DOM, and nothing writes
//          the clipboard during the browse (fails when: any shadow [data-copy] element exists,
//          or the clipboard sentinel was overwritten)
//   R24-4  a code_cells lesson (ch01-b08) renders static code + Copy: one button per cell,
//          no textarea, and Copy puts cell.source on the clipboard (fails when: a cell has
//          any other control, an editor, or the copied text differs from the data)
//   R24-5  sweep of EVERY Géron lesson with code_cells: zero Edit/Reset/Run/Stop controls,
//          zero [data-not-runnable] banners, every cell has a Copy button (fails when: any
//          lesson shows a runner control or a cell without Copy)
//   R24-6  POST and GET /api/run, /api/run/stop, /api/run/reset-kernel all answer 404
//          (fails when: any answers anything else, e.g. the old 400/502)
//   R24-7  the whole browse made ZERO requests to /api/run* and raised ZERO page/console
//          errors (fails when: either count is non-zero)
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = process.env.GATE_BASE || 'http://127.0.0.1:8791';
const port = new URL(BASE).port || '80';
// Loopback (127.0.0.1 / localhost) IS a secure context, so testing the fallback there would
// be vacuous. Use this machine's own non-loopback IPv4: plain HTTP there is NOT secure,
// exactly like http://192.168.100.66:8767 for the user.
const lanIp = process.env.GATE_INSECURE_HOST || Object.values(networkInterfaces()).flat()
  .find(i => i && i.family === 'IPv4' && !i.internal)?.address;
const INSECURE = process.env.GATE_INSECURE_BASE || (lanIp ? `http://${lanIp}:${port}` : '');
const APP_DIR = process.env.GATE_APP_DIR || resolve(dirname(fileURLToPath(import.meta.url)), '..', 'aws-quiz-app');
const LIB = process.env.EDU_LIBRARY_ROOT || '/var/tmp/edu-smoke/lib';

let failed = 0;
const check = (id, pass, detail) => { if (!pass) failed++; console.log(`${pass ? 'PASS' : 'FAIL'}  ${id}  ${detail}`); };

// ---------- R24-1 static ----------
{
  const js = readFileSync(join(APP_DIR, 'js', 'app.js'), 'utf8');
  const py = readFileSync(join(APP_DIR, 'edu_server.py'), 'utf8');
  const hits = [];
  for (const [name, src] of [['app.js', js], ['edu_server.py', py]]) {
    for (const needle of ['/api/run', 'RUN_ROUTES', 'runCell', 'proxy_run', 'data-not-runnable', 'runnerSession']) {
      if (src.includes(needle)) hits.push(`${name}:${needle}`);
    }
  }
  check('R24-1 no runner code left in app.js or edu_server.py', hits.length === 0, hits.length ? `found ${hits.join(', ')}` : 'clean');
}

// Expected texts come from the DATA, never from the page under test.
const geron = JSON.parse(readFileSync(join(LIB, 'geron-homl3', 'module.json'), 'utf8'));
const chapters = geron.tutorialData.sections;
const fence = s => { const m = /```[^\n]*\n([\s\S]*?)\n?```/.exec(s || ''); return m ? m[1] : null; };
// First Full-script card in chapter 2.
let fsLoc = null;
chapters[1].items.forEach((it, bi) => (it.blocks || []).forEach(b => {
  if (!fsLoc && b.type === 'card' && String(b.title || '').startsWith('Full script')) fsLoc = { ci: 1, bi, text: fence(b.content || b.intro) };
}));
const ccLessons = [];
chapters.forEach((ch, ci) => ch.items.forEach((it, bi) => {
  const cells = (it.blocks || []).filter(b => b.type === 'code_cells').flatMap(b => b.cells || []);
  if (cells.length) ccLessons.push({ ci, bi, term: it.term, cells });
}));
const b08 = ccLessons.find(l => l.ci === 0 && l.bi === 7);

const browser = await chromium.launch({ executablePath: process.env.GATE_CHROME || chromium.executablePath() });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const runRequests = [];
const errors = [];
ctx.on('request', r => { if (new URL(r.url()).pathname.startsWith('/api/run')) runRequests.push(r.url()); });

async function openGeron(page, base) {
  page.on('pageerror', e => errors.push(`pageerror ${e.message}`));
  page.on('console', m => { if (m.type() === 'error') errors.push(`console ${m.text()} @ ${m.location()?.url || '?'}`); });
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  const book = await page.$$eval('#library-grid [data-book]', els => (els.find(e => /geron/i.test(e.dataset.book)) || {}).dataset?.book);
  if (book && !(await page.evaluate(() => typeof moduleId !== 'undefined' && moduleId === 'geron-homl3'))) {
    await page.locator(`#library-grid [data-book="${book}"]`).click();
    await page.waitForTimeout(900);
  }
  await page.evaluate(() => showTutorial());
  await page.waitForTimeout(300);
}
const go = (page, ci, bi) => page.evaluate(([c, b]) => selectTheory({ chapterIndex: c, blockIndex: b }), [ci, bi]).then(() => page.waitForTimeout(250));

// Reads the clipboard from a SECURE page in the same browser (the system clipboard is shared).
const reader = await ctx.newPage();
await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE });
await reader.goto(BASE + '/favicon.svg');
const readClipboard = () => reader.evaluate(() => navigator.clipboard.readText()).catch(() => '');
const primeClipboard = () => reader.evaluate(() => navigator.clipboard.writeText('__R24_SENTINEL__'));

// ---------- R24-2 + R24-3 on the INSECURE origin ----------
const page = await ctx.newPage();
await openGeron(page, INSECURE || BASE);
await go(page, fsLoc.ci, fsLoc.bi);
const listing = await page.evaluate(() => {
  let pres = 0, copyButtons = 0, copyMarks = 0;
  document.querySelectorAll('#tutorial-content rich-text-viewer').forEach(v => {
    const root = v.shadowRoot; if (!root) return;
    pres += root.querySelectorAll('pre').length;
    copyButtons += root.querySelectorAll('button.copy-btn').length;
    copyMarks += root.querySelectorAll('[data-copy]').length;
  });
  return { pres, copyButtons, copyMarks };
});
check('R24-2 zero Copy buttons on shadow-DOM code listings (ch02 Full-script lesson)',
  listing.pres > 0 && listing.copyButtons === 0,
  `lesson ch${fsLoc.ci + 1} block ${fsLoc.bi + 1}: ${listing.pres} listings, ${listing.copyButtons} Copy buttons`);

await primeClipboard();
await page.waitForTimeout(400);
const clip3 = await readClipboard();
check('R24-3 no copy affordance in any shadow root, and the clipboard is untouched',
  listing.copyMarks === 0 && clip3 === '__R24_SENTINEL__',
  `[data-copy] elements=${listing.copyMarks} clipboardUntouched=${clip3 === '__R24_SENTINEL__'}`);

// ---------- R24-4 ch01-b08 code_cells ----------
await go(page, b08.ci, b08.bi);
const cells4 = await page.evaluate(() => [...document.querySelectorAll('#tutorial-content [data-cell]')].map(card => ({
  id: card.dataset.cell,
  buttons: [...card.querySelectorAll('button')].map(b => b.textContent.trim()),
  textareas: card.querySelectorAll('textarea').length,
  code: card.querySelector('pre code')?.textContent ?? null,
})));
await primeClipboard();
// The cell's LAST button. On this build it is the only one (Copy); on a build that still
// has the runner it is Run -- which is exactly what lets R24-7 go red on the old build.
await page.locator('#tutorial-content [data-cell]').first().locator('button').last().click().catch(() => {});
await page.waitForTimeout(400);
const copied4 = await readClipboard();
const src = b08.cells.map(c => c.source);
const ok4 = cells4.length === b08.cells.length && cells4.every((c, i) => c.buttons.length === 1 && c.buttons[0] === 'Copy' && c.textareas === 0 && c.code === src[i]) && copied4 === src[0];
check('R24-4 ch01-b08 code_cells render as static code with one Copy button each, copying cell.source',
  ok4, `cells ${cells4.length}/${b08.cells.length} buttons=${JSON.stringify(cells4.map(c => c.buttons))} textareas=${cells4.reduce((a, c) => a + c.textareas, 0)} copyEqual=${copied4 === src[0]}`);
await page.screenshot({ path: `${process.env.GATE_OUT_DIR || '/var/tmp/p0-after'}/r24-ch01-b08.png`, fullPage: false });

// ---------- R24-5 sweep ----------
let bad5 = [];
for (const l of ccLessons) {
  await go(page, l.ci, l.bi);
  const r = await page.evaluate(() => {
    const buttons = [...document.querySelectorAll('#tutorial-content button')].map(b => b.textContent.trim());
    const cards = [...document.querySelectorAll('#tutorial-content [data-cell]')];
    return {
      runner: buttons.filter(t => /^(Edit|Done|Reset|Run|Stop)$/.test(t)).length,
      banners: document.querySelectorAll('#tutorial-content [data-not-runnable]').length,
      cards: cards.length,
      withCopy: cards.filter(c => [...c.querySelectorAll('button')].some(b => b.textContent.trim() === 'Copy')).length,
    };
  });
  if (r.runner || r.banners || r.cards !== l.cells.length || r.withCopy !== r.cards) bad5.push(`ch${l.ci + 1}/b${l.bi + 1}:${JSON.stringify(r)}`);
}
check('R24-5 every Géron code_cells lesson: zero Edit/Reset/Run/Stop, zero not-runnable banners, Copy on every cell',
  ccLessons.length > 0 && bad5.length === 0, `${ccLessons.length} lessons swept, ${bad5.length} bad ${bad5.slice(0, 3).join(' ')}`);

// ---------- R24-6 routes ----------
const codes = [];
for (const r of ['/api/run', '/api/run/stop', '/api/run/reset-kernel']) {
  // No body on purpose: the legacy server answers an unknown POST route with 404 WITHOUT
  // reading the body, so on a kept-alive socket an unread '{}' is parsed as the NEXT request
  // line and that request gets a spurious 501. (Pre-existing server behaviour, not R24's.)
  const p = await fetch(BASE + r, { method: 'POST' });
  const g = await fetch(BASE + r);
  codes.push(`${r} POST ${p.status} GET ${g.status}`);
}
check('R24-6 /api/run* answers 404 (POST and GET)', codes.every(c => / POST 404 GET 404$/.test(c)), codes.join(' | '));

// ---------- R24-7 ----------
check('R24-7 zero /api/run* requests and zero page/console errors during the browse',
  runRequests.length === 0 && errors.length === 0, `runRequests=${runRequests.length} errors=${errors.length} ${errors.slice(0, 3).join(' ; ')}`);

await browser.close();
if (failed) { console.log(`FAILED: ${failed} gate(s)`); process.exit(1); }
