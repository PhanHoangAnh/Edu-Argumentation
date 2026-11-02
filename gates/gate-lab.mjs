#!/usr/bin/env node
/**
 * gate-lab.mjs — G-lab (+ G-reader screenshots) for the Lab add-on. Plan lab-practice_24-09-26,
 * ruling R27. Hybrid tier: drives the LIVE Lab through an ssh tunnel (contract C6), never a local
 * preview (a local Lab cannot reach the :8767 sign-in check or the .68 runner).
 *
 *   LAB_BASE    http://127.0.0.1:18798   (ssh -N -L 18798:127.0.0.1:8798 nn)
 *   STUDY_BASE  http://127.0.0.1:18767   (ssh -N -L 18767:127.0.0.1:8767 nn) — reader screenshots
 *   LAB_TOKEN   the owner's minted purpose='gate' session (env, never argv) — run-gates-lab.sh
 *   LAB_SHOTS   screenshot folder
 *
 * Identity: the gate injects the edu_session cookie itself (context.addCookies, host 127.0.0.1,
 * secure:false). It does NOT use lib/auth-preload.mjs, whose remote path aborts every non-GET.
 * Writes: the ONLY non-GET allowed through is POST /lab/api/run* (Lab -> runner). Everything
 * else that is not a GET is aborted — including the study app's /api/quiz, which is HELD for
 * the loading-state screenshot and never reaches the server (no model call, no write).
 *
 * Emits one PASS/FAIL line per check; exits 1 on any FAIL.
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const LAB = process.env.LAB_BASE || 'http://127.0.0.1:18798';
const STUDY = process.env.STUDY_BASE || 'http://127.0.0.1:18767';
const TOKEN = process.env.LAB_TOKEN || '';
const SHOTS = process.env.LAB_SHOTS || '/var/tmp/lab-shots';
const HEAVY = 'This script is too heavy for the shared runner — Copy it and run it in geron-lab on your PC';
if (!/^[A-Za-z0-9_-]{16,256}$/.test(TOKEN)) { console.error('LAB_TOKEN missing or malformed'); process.exit(2); }
fs.mkdirSync(SHOTS, { recursive: true });

const results = [];
const check = (id, pass, detail = '') => {
  results.push({ id, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${id}${detail ? ' — ' + detail : ''}`);
};
const shot = async (page, name, opts = {}) => {
  const file = path.join(SHOTS, name);
  await page.screenshot({ path: file, ...opts });
  console.log(`  screenshot ${file}`);
};

const browser = await chromium.launch({ executablePath: process.env.GATE_CHROME || chromium.executablePath() });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
await ctx.addCookies([{ name: 'edu_session', value: TOKEN, domain: '127.0.0.1', path: '/', httpOnly: true, secure: false, sameSite: 'Lax' }]);
let heldQuiz = 0;
await ctx.route('**/*', async (route) => {
  const req = route.request();
  const url = new URL(req.url());
  if (req.method() === 'GET' || req.method() === 'HEAD') return route.continue();
  if (req.method() === 'POST' && url.port === new URL(LAB).port && url.pathname.startsWith('/lab/api/run')) return route.continue();
  if (req.method() === 'POST' && url.pathname.startsWith('/api/quiz')) { heldQuiz += 1; return; } // HELD: never answered
  return route.abort();
});
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));

const api = (p) => page.evaluate(async (u) => (await fetch(u, { credentials: 'same-origin' })).json(), p);
const editorValue = () => page.$eval('#lab-editor', (e) => e.value);
const visible = (sel) => page.locator(sel).isVisible();

/* ---- deep link ---- */
await page.goto(`${LAB}/lab/geron-homl3/ch02-b05`, { waitUntil: 'networkidle' });
await page.waitForSelector('#lab-editor');
const original = (await api('/lab/api/books/geron-homl3/lessons/ch02-b05')).code;
const title = (await page.textContent('#lab-lesson-title'))?.trim() || '';
const active = (await page.$eval('#lab-lesson-select', (e) => e.value)) === 'ch02-b05' ? 'true' : 'false';
check('LAB-DEEPLINK /lab/geron-homl3/ch02-b05 opens that lesson (title "5. …", Lesson menu on it, editor = the lesson code)',
  /^5\. \S/.test(title) && active === 'true' && (await editorValue()) === original, JSON.stringify({ title, active }));

/* ---- layout toggle persists across reload ---- */
await page.click('#lab-layout-stacked');
await page.reload({ waitUntil: 'networkidle' });
await page.waitForSelector('#lab-workspace');
const afterReload = await page.getAttribute('#lab-workspace', 'data-arrangement');
const stackedCols = await page.$eval('#lab-workspace', (e) => getComputedStyle(e).gridTemplateColumns.split(' ').length);
await page.click('#lab-layout-side');
await page.waitForTimeout(200);
const sideCols = await page.$eval('#lab-workspace', (e) => getComputedStyle(e).gridTemplateColumns.split(' ').length);
check('LAB-LAYOUT "Stacked" survives a reload (localStorage) and gives one column; "Side by side" gives two at 1440 px',
  afterReload === 'stacked' && stackedCols === 1 && sideCols === 2, JSON.stringify({ afterReload, stackedCols, sideCols }));

/* ---- selectors: exactly three menus; top row <-> left sidebar, remembered ---- */
const menus = await page.locator('#lab-selector select').count();
const placeTop = await page.getAttribute('#lab-selector', 'data-place');
await page.click('#lab-selector-place');
await page.reload({ waitUntil: 'networkidle' });
await page.waitForSelector('#lab-selector');
const placeSide = await page.getAttribute('#lab-selector', 'data-place');
const asideW = await page.$eval('#lab-aside', (e) => e.getBoundingClientRect().width);
await shot(page, 'lab-selector-sidebar-1440.png');
await page.click('#lab-selector-place');
await page.waitForTimeout(200);
const placeBack = await page.getAttribute('#lab-selector', 'data-place');
const buttons = await page.$$eval('#lab-code-pane button[id]', (bs) => bs.map((b) => b.textContent.trim()).join(','));
const noView = (await page.locator('[id^="lab-view-"]').count()) === 0;
const glyphs = await page.$$eval('#lab-layout-side, #lab-layout-stacked', (bs) => bs.every((b) => b.textContent.trim() === '' && b.querySelector('svg')));
const study = await page.$eval('#lab-study-link', (a) => (a.querySelector('svg') ? a.getAttribute('aria-label') : null));
const userColor = await page.$eval('#lab-user', (e) => getComputedStyle(e).color).catch(() => null);
check('LAB-UI 3 menus (book/chapter/lesson); top <-> sidebar survives reload; buttons Run,Stop,Reset,Copy; no view switch; layout = 2 glyphs; Study = book glyph; account in brand red',
  menus === 3 && placeTop === 'top' && placeSide === 'sidebar' && asideW < 400 && placeBack === 'top' && buttons === 'Run,Stop,Reset,Copy' && noView && glyphs
  && study === 'Study app' && userColor === 'rgb(239, 91, 91)',
  JSON.stringify({ menus, placeTop, placeSide, asideW, placeBack, buttons, noView, glyphs, study, userColor }));

/* ---- edit -> reload keeps it -> Reset is byte-equal ---- */
await page.click('#lab-editor');
await page.keyboard.press('Control+End');
await page.keyboard.type('\n# edited by gate-lab');
await page.reload({ waitUntil: 'networkidle' });
await page.waitForSelector('#lab-editor');
const kept = (await editorValue()).endsWith('# edited by gate-lab');
await page.click('#lab-reset-btn');
const resetEqual = (await editorValue()) === original;
const keyGone = await page.evaluate(() => localStorage.getItem('lab:code:geron-homl3:ch02-b05') === null);
check('LAB-RESET an edit survives reload; Reset restores the lesson code byte-for-byte and forgets the edit',
  kept && resetEqual && keyGone, JSON.stringify({ kept, resetEqual, keyGone }));

/* ---- run: stdout + image ---- */
await shot(page, 'lab-side-by-side-1440.png');
await page.click('#lab-run-btn');
await page.waitForSelector('#lab-status[data-status="ok"], #lab-status[data-status="error"], #lab-status[data-status="failed"]', { timeout: 95_000 });
const runStatus = await page.getAttribute('#lab-status', 'data-status');
const streams = await page.locator('#lab-result [data-output="stream"]').count();
const images = await page.locator('#lab-result [data-output="image"]').count();
const imgLoaded = images ? await page.$eval('#lab-result [data-output="image"]', (i) => i.complete && i.naturalWidth > 100) : false;
check('LAB-RUN ch02-b05 runs on the shared runner: status ok, stdout rendered, the matplotlib figure rendered as an image',
  runStatus === 'ok' && streams > 0 && images > 0 && imgLoaded, JSON.stringify({ runStatus, streams, images, imgLoaded }));
await shot(page, 'lab-run-stdout-1440.png');
await page.locator('#lab-result [data-output="image"]').first().scrollIntoViewIfNeeded();
await shot(page, 'lab-run-image-1440.png');

/* ---- stacked screenshot ---- */
await page.click('#lab-layout-stacked');
await page.evaluate(() => window.scrollTo(0, 0));
await shot(page, 'lab-stacked-1440.png', { fullPage: true });
await page.click('#lab-layout-side');

/* ---- heavy script ---- */
await page.fill('#lab-editor', 'import time\ntime.sleep(70)\n');
await page.click('#lab-run-btn');
await page.waitForSelector('#lab-heavy', { timeout: 100_000 });
const heavyText = (await page.textContent('#lab-heavy p'))?.trim();
check('LAB-HEAVY a script over the time cap shows the R13 message (with a Copy button), never hangs',
  heavyText === HEAVY && (await visible('#lab-heavy-copy-btn')), JSON.stringify({ heavyText }));
await shot(page, 'lab-heavy-message-1440.png');
await page.click('#lab-reset-btn');

/* ---- unknown deep link ---- */
await page.goto(`${LAB}/lab/geron-homl3/ch01-b01`, { waitUntil: 'networkidle' });
await page.waitForSelector('#lab-notice');
const notice = (await page.textContent('#lab-notice'))?.trim() || '';
check('LAB-NOCODE a deep link to a lesson with no code explains itself and the Lesson menu still offers lessons', /no code/.test(notice) && (await page.locator('#lab-lesson-select option:not([disabled])').count()) > 0, notice);

/* ---- phone width: side-by-side collapses to one column ---- */
await page.setViewportSize({ width: 390, height: 844 });
await page.goto(`${LAB}/lab/geron-homl3/ch02-b05`, { waitUntil: 'networkidle' });
await page.waitForSelector('#lab-workspace');
const phoneCols = await page.$eval('#lab-workspace', (e) => getComputedStyle(e).gridTemplateColumns.split(' ').length);
await shot(page, 'lab-phone-390.png', { fullPage: true });
check('LAB-PHONE side-by-side collapses to one column below md (390 px)', phoneCols === 1, `cols=${phoneCols}`);

/* ---- reader: numbered title + Lab link (study app, live) ---- */
await page.setViewportSize({ width: 1440, height: 1000 });
await page.goto(`${STUDY}/geron-homl3/chapter-2/7-x`, { waitUntil: 'networkidle' });
await page.waitForSelector('#tutorial-main-title');
await page.waitForTimeout(1500);
const rTitle = (await page.textContent('#tutorial-main-title'))?.trim() || '';
const rLab = await page.$eval('#lab-open-btn', (a) => ({ href: a.getAttribute('href'), target: a.target, rel: a.rel, text: a.getAttribute('aria-label') })).catch(() => null);
await shot(page, 'reader-title-lab-button-1440.png', { clip: { x: 0, y: 0, width: 1440, height: 320 } });
await page.goto(`${STUDY}/openintro-stats/chapter-2/10-x`, { waitUntil: 'networkidle' });
await page.waitForSelector('#tutorial-main-title');
await page.waitForTimeout(1500);
const oTitle = (await page.textContent('#tutorial-main-title'))?.trim() || '';
const oLab = await page.$eval('#lab-open-btn', (a) => a.getAttribute('href')).catch(() => null);
await page.goto(`${STUDY}/geron-homl3/chapter-1/1-x`, { waitUntil: 'networkidle' });
await page.waitForSelector('#tutorial-main-title');
await page.waitForTimeout(1500);
const pTitle = (await page.textContent('#tutorial-main-title'))?.trim() || '';
const pLab = await page.locator('#lab-open-btn').count();
await shot(page, 'reader-title-no-code-1440.png', { clip: { x: 0, y: 0, width: 1440, height: 320 } });
check('G-READER (live) "7. …" + Lab -> /lab/geron-homl3/ch02-b07 (new tab, noopener); OpenIntro links by MODULE id; a no-code lesson "1. …" has no Lab link',
  /^7\. \S/.test(rTitle) && rLab?.href === '/lab/geron-homl3/ch02-b07' && rLab.target === '_blank' && rLab.rel.split(' ').includes('noopener') && rLab.text === 'Lab'
  && /^10\. \S/.test(oTitle) && oLab === '/lab/openintro-statistics-2019-1045f2f5/ch02-b10'
  && /^1\. \S/.test(pTitle) && pLab === 0,
  JSON.stringify({ rTitle: rTitle.slice(0, 40), rLab, oTitle: oTitle.slice(0, 40), oLab, pTitle: pTitle.slice(0, 40), pLab }));
await page.setViewportSize({ width: 390, height: 844 });
await page.goto(`${STUDY}/geron-homl3/chapter-2/7-x`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
await shot(page, 'reader-title-lab-button-390.png', { clip: { x: 0, y: 0, width: 390, height: 420 } });
await page.setViewportSize({ width: 1440, height: 1000 });

/* ---- S-rename + S-loading (study app, live; the quiz request is HELD, never sent) ---- */
await page.goto(`${STUDY}/`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
const navLabel = (await page.textContent('#nav-generated-quiz'))?.trim();
const homeBtn = await page.locator('#welcome-screen button', { hasText: 'AI-Quiz' }).count();
const oldText = await page.evaluate(() => /Generate quiz|GENERATE QUIZ|Generate Another Quiz/.test(document.body.innerText));
await shot(page, 'study-home-ai-quiz-label-1440.png', { clip: { x: 0, y: 0, width: 1440, height: 520 } });
await page.click('#nav-generated-quiz');
await page.waitForSelector('#setup-title');
const setupTitle = (await page.textContent('#setup-title'))?.trim();
await shot(page, 'study-ai-quiz-setup-1440.png');
check('S-RENAME nav "AI-QUIZ", home button "AI-Quiz", picker title "AI-Quiz", no "Generate quiz" text left on the page',
  navLabel === 'AI-QUIZ' && homeBtn > 0 && setupTitle === 'AI-Quiz' && !oldText, JSON.stringify({ navLabel, homeBtn, setupTitle, oldText }));
await page.click('#setup-all-btn');   // the picker opens with nothing selected; START needs a selection
await page.waitForTimeout(300);
const startEnabled = await page.isEnabled('#setup-start-btn');
if (startEnabled) {
  await page.click('#setup-start-btn');
  await page.waitForSelector('#loading-screen:not(.hidden-view)', { timeout: 10_000 }).catch(() => {});
  await page.waitForTimeout(800);
  const loading = await page.evaluate(() => {
    const shown = (id) => { const e = document.getElementById(id); return Boolean(e && !e.classList.contains('hidden-view') && e.getClientRects().length); };
    return { loading: shown('loading-screen'), welcome: shown('welcome-screen'), kpis: shown('home-kpis'), library: shown('services-section') };
  });
  await shot(page, 'study-ai-quiz-loading-1440.png');
  check('S-LOADING while an AI-Quiz is being written only the spinner block shows (welcome, KPIs and library hidden)',
    loading.loading && !loading.welcome && !loading.kpis && !loading.library && heldQuiz > 0, JSON.stringify({ ...loading, heldQuiz }));
} else {
  check('S-LOADING while an AI-Quiz is being written only the spinner block shows', false, 'setup-start-btn disabled after ALL (provider not ready for this account?) — could not reach the loading state');
}

/* ---- clean up: kernels used by this run, per contract E15 ---- */
await page.goto(`${LAB}/lab/`, { waitUntil: 'networkidle' });
const resets = await page.evaluate(async () => {
  const out = [];
  for (const lesson of ['ch02-b05']) {
    const r = await fetch('/lab/api/run/reset', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ book: 'geron-homl3', lesson }) });
    out.push(`${lesson}:${r.status}`);
  }
  localStorage.removeItem('lab:layout');
  return out;
});
console.log(`  cleanup: kernel resets ${resets.join(' ')}`);
check('LAB-NOERRORS no uncaught page errors during the run', errors.length === 0, errors.slice(0, 3).join(' | '));

await browser.close();
console.log(`\n${results.filter((r) => r.pass).length}/${results.length} passed`);
if (results.some((r) => !r.pass)) process.exit(1);
