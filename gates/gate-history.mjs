#!/usr/bin/env node
/**
 * gate-history.mjs — G7, exam-recall-suite P2 (22-10-26): the Account page's Progress block (mastery
 * bars + Next up + History with All / Wrong / Flagged, area filter, Show more, Retry wrong) and the
 * Practice dialog's Next up row, in a real browser.
 *
 * Tier 1/2, browser: the REAL built bundle (app/frontend/dist) with the API stubbed in the browser:
 *     cd app/frontend && ./node_modules/.bin/vite build && node ../../gates/gate-history.mjs
 * Env: HG_DIST (another build, for fault injection), HG_SHOTS (screenshots, default /var/tmp/p2c-shots).
 * Proves: every bar shows its number as TEXT (pct, right/answered, target) and an area under 5 answers
 * reads "Not enough yet"; Next up is the server's weakest and Practice runs only that area; the filter
 * chips ask the server for all / wrong / flagged and say which is on (aria-pressed); the area select
 * sends the chapter; Show more sends the cursor and appends; right / wrong is a shape AND words;
 * "Retry wrong" redoes ONLY the missed questions and the result keeps the run's ORIGINAL denominator
 * (6 / 6 from the Wrong filter, 2 / 3 for a run split over two pages), logged as runKind retry; the
 * Practice dialog shows the same Next up; the Book select opens another book; keyboard focus is
 * visible; every new control is >= 44 px; nothing outside the header scrolls sideways at 390/834/1440.
 * Fails when: a retry recomputes its denominator from the missed set, a filter sends the wrong
 * parameter, a bar loses its text, a control shrinks under 44 px, or a viewport scrolls sideways.
 * ⛔ Mutation-checked when written (see the README row).
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIST = process.env.HG_DIST || resolve(fileURLToPath(new URL('.', import.meta.url)), '../app/frontend/dist');
const SHOTS = process.env.HG_SHOTS || '/var/tmp/p2c-shots';
if (!existsSync(join(DIST, 'index.html'))) { console.log(`FAIL  X0  no build at ${DIST} — run vite build first`); process.exit(2); }
mkdirSync(SHOTS, { recursive: true });
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
const server = createServer((req, res) => {
  const path = new URL(req.url, 'http://x').pathname; const file = join(DIST, path === '/' ? 'index.html' : path);
  if (!file.startsWith(DIST) || !existsSync(file)) { res.writeHead(404); res.end('no'); return; }
  res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' }); res.end(readFileSync(file));
});
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const BASE = `http://127.0.0.1:${server.address().port}`;
const results = [];
const check = (id, pass, detail) => { results.push(pass); console.log(`${pass ? 'PASS' : 'FAIL'}  ${id}  ${detail ?? ''}`); };

// ---- the book: 3 chapters, keyed questions (correct index known, so the gate answers on purpose) ----
const CH = { 1: 'Chapter 1: Basics', 2: 'Chapter 2: Trees', 3: 'Chapter 3: Nets' };
const N = { 1: 3, 2: 6, 3: 2 };
const bank = [];
for (const c of [1, 2, 3]) for (let q = 1; q <= N[c]; q += 1) {
  bank.push({ question: `Gate Q c${c} q${q}: which is right?`, options: ['Alpha', 'Beta', 'Gamma', 'Delta'], correct: (c + q) % 4,
    explanations: null, source: { chapter: c, block: `ch0${c}-b01`, question: `ch0${c}-b01-q${q}` } });
}
const CORRECT = new Map(bank.map((b) => [b.question, b.correct]));
const module_ = (title) => ({ moduleId: 'geron-homl3', tutorialData: { title, sections: [1, 2, 3].map((c) => ({ title: CH[c], themeColor: 'indigo-500', items: [{ term: `Lesson ${c}`, blocks: [{ type: 'text', content: 'Hi.' }] }] })) }, quizData: bank });
const other = { moduleId: 'gate-other', tutorialData: { title: 'Other book', sections: [{ title: 'Chapter 1: Other', themeColor: 'indigo-500', items: [{ term: 'L', blocks: [{ type: 'text', content: 'x' }] }] }] }, quizData: [] };

// ---- the server's wire shapes (store.mastery / store.history_page) ----
const MASTERY = { module: 'geron-homl3', areaKind: 'chapter', exam: null, window: 200, minAnswers: 5, target: 80, unassigned: 0, areas: [
  { id: 'ch01', name: CH[1], chapters: [1], answered: 12, right: 11, pct: 92, enough: true, lastAt: '2026-10-22T01:00:00+00:00' },
  { id: 'ch02', name: CH[2], chapters: [2], answered: 6, right: 4, pct: 67, enough: true, lastAt: '2026-10-22T02:00:00+00:00' },
  { id: 'ch03', name: CH[3], chapters: [3], answered: 3, right: 0, pct: 0, enough: false, lastAt: '2026-10-22T03:00:00+00:00' },
], nextUp: { id: 'ch02', name: CH[2], reason: 'weakest', answered: 6, right: 4, pct: 67 } };
const log = (id, key, ok, run, kind = 'practice') => ({ id: `a:${id}`, source: 'log', question: key, chapter: Number(key.slice(2, 4)), domain: null, runKind: kind, runId: run, correct: ok, confidence: null, chosen: 0, at: `2026-10-22T0${id % 9}:00:00+00:00` });
// Run R2 (ch2, 6 asked, q2 + q5 missed) on page 1; run R1 (ch1, 3 asked, q3 missed) split over pages 1 and 2.
const R2 = [6, 5, 4, 3, 2, 1].map((q, i) => log(100 - i, `ch02-b01-q${q}`, q !== 2 && q !== 5, 'run-r2'));
const R1a = [log(60, 'ch01-b01-q1', true, 'run-r1'), log(59, 'ch01-b01-q2', true, 'run-r1')];
const R1b = [log(58, 'ch01-b01-q3', false, 'run-r1')];
const LEGACY = { id: 'w:7', source: 'legacy', question: null, chapter: 2, domain: null, runKind: null, runId: 'old', correct: false, confidence: null, chosen: 1, at: '2026-10-01T01:00:00+00:00', block: 'ch02-b01', quizKind: 'bank', body: { question: 'An older wrong answer, before history began', options: ['a', 'b'], correct: 0 } };
const RUNS = { 'run-r2': { answered: 6, right: 4 }, 'run-r1': { answered: 3, right: 2 } };
const COUNTS = { all: 12, wrong: 4, flagged: 2 };
function history(u) {
  const f = u.searchParams.get('filter') || 'all'; const cursor = u.searchParams.get('cursor'); const ch = u.searchParams.get('chapter');
  const page = (items, nextCursor) => ({ module: 'geron-homl3', filter: f, items, nextCursor, counts: COUNTS, runs: Object.fromEntries(Object.entries(RUNS).filter(([k]) => items.some((i) => i.runId === k))) });
  if (f === 'flagged') return { module: 'geron-homl3', filter: 'flagged', nextCursor: null, counts: COUNTS, runs: {}, items: [
    { id: 'f:ch02-b01-q5', source: 'flag', question: 'ch02-b01-q5', chapter: 2, flaggedAt: '2026-10-22T05:00:00+00:00', lastCorrect: false, lastAt: '2026-10-22T04:00:00+00:00' },
    { id: 'f:ch03-b01-q1', source: 'flag', question: 'ch03-b01-q1', chapter: 3, flaggedAt: '2026-10-22T05:01:00+00:00', lastCorrect: null, lastAt: null }] };
  if (ch === '2') return page([...R2.filter((i) => f === 'all' || !i.correct), LEGACY], null);
  if (f === 'wrong') return page([...R2, ...R1a, ...R1b].filter((i) => !i.correct).concat([LEGACY]), null);
  return cursor === 'a:59' ? page([...R1b, LEGACY], null) : page([...R2, ...R1a], 'a:59');
}

const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
const browser = await chromium.launch({ executablePath: process.env.GATE_CHROME || chromium.executablePath() });

async function open({ width = 1366, height = 900 } = {}) {
  const gets = { history: [], mastery: [] }; const posts = { answers: [] };
  const page = await (await browser.newContext({ viewport: { width, height } })).newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(String(e).slice(0, 160)));
  const native = []; page.on('dialog', (d) => { native.push(d.type()); void d.dismiss(); });
  await page.route('**/api/**', (route) => {
    const u = new URL(route.request().url()); const m = route.request().method();
    const body = () => JSON.parse(route.request().postData() || '{}');
    if (u.pathname === '/api/auth/me') return json(route, { account: { id: 2, username: 'gate', displayName: 'Gate', isOwner: false } });
    if (u.pathname === '/api/modules') return json(route, { books: [
      { file: 'geron-homl3', book: 'geron-homl3', base: 'book/geron-homl3/', moduleId: 'geron-homl3', title: 'Gate Book', chapters: 3, lessons: 3, questions: bank.length, default: true },
      { file: 'gate-other', book: 'gate-other', base: 'book/gate-other/', moduleId: 'gate-other', title: 'Other book', chapters: 1, lessons: 1, questions: 0 }] });
    if (u.pathname === '/api/account/stats') return json(route, { completed: [], attempts: [], wrongAnswers: [], wrongTotal: 0 });
    if (u.pathname === '/api/mastery') { gets.mastery.push(u.searchParams.get('module')); return json(route, u.searchParams.get('module') === 'geron-homl3' ? MASTERY : { ...MASTERY, module: 'gate-other', areas: [], nextUp: null }); }
    if (u.pathname === '/api/history') { gets.history.push(Object.fromEntries(u.searchParams)); return json(route, u.searchParams.get('module') === 'geron-homl3' ? history(u) : { items: [], nextCursor: null, counts: { all: 0, wrong: 0, flagged: 0 }, runs: {} }); }
    if (u.pathname === '/api/answers' && m === 'POST') { posts.answers.push(body()); return json(route, { outcome: 'logged' }, 201); }
    if (u.pathname === '/api/review/seen' && m === 'POST') return json(route, { outcome: 'created' });
    if (u.pathname === '/api/review/due') return json(route, { due: [], dueCount: 0, total: 0 });
    if (u.pathname === '/api/review/stats') return json(route, { dueNow: 0, dueToday: 0, next7: [], total: 0, leeches: 0, retention: null });
    if (u.pathname === '/api/study/prefs') return json(route, { module: 'geron-homl3', newPerDay: 20, sessionSize: 20 });
    if (u.pathname === '/api/flags' && m === 'GET') return json(route, { flags: [], count: 0 });
    if (u.pathname === '/api/progress') return json(route, { module: 'geron-homl3', completed: {} });
    if (u.pathname === '/api/general') return json(route, { ai_question_count: 5, fresh_quiz_size: 10 });
    if (u.pathname === '/api/provider') return json(route, { ready: true, model: 'stub-model', token_required: false });
    return json(route, {});
  });
  await page.route('**/book/geron-homl3/module.json', (route) => json(route, module_('Gate Book')));
  await page.route('**/book/gate-other/module.json', (route) => json(route, other));
  await page.goto(BASE, { waitUntil: 'networkidle' }); await page.waitForTimeout(700);
  return { page, gets, posts, errors, native };
}
const nav = async (page, id) => { if (!(await page.locator(id).isVisible())) { await page.locator('#menu-btn').click(); await page.waitForTimeout(300); } await page.locator(id).click(); await page.waitForTimeout(700); };
const text = (page, sel) => page.locator(sel).first().innerText().catch(() => '');
const raw = (page, sel) => page.locator(sel).first().evaluate((e) => e.innerText.replace(/\s+/g, ' ').trim()).catch(() => '');
// The viewer's shadow root also holds a <style> (@import …): read only the non-style nodes.
const questionText = (page) => page.evaluate(() => { const v = document.querySelector('#question-text rich-text-viewer'); const root = v && v.shadowRoot ? v.shadowRoot : document.querySelector('#question-text'); if (!root) return ''; const out = []; const walk = (n) => { if (n.nodeName === 'STYLE' || n.nodeName === 'LINK') return; if (n.nodeType === 3) out.push(n.textContent); n.childNodes.forEach(walk); }; walk(root); return out.join('').replace(/\s+/g, ' ').trim(); });
const cards = (page) => page.locator('#options-container .option-card');
const sideways = (page) => page.evaluate(() => Math.max(-1, ...[...document.querySelectorAll('body *')].filter((e) => !e.closest('header') && e.getClientRects().length).map((e) => Math.round(e.getBoundingClientRect().right - window.innerWidth))));
const minBox = (page, sel) => page.$$eval(sel, (els) => els.filter((e) => e.getClientRects().length).map((e) => { const r = e.getBoundingClientRect(); return Math.min(Math.round(r.width), Math.round(r.height)); }));
/** Answer the run: `plan` = per question true (pick the right option) / false (pick a wrong one). Returns the questions seen. */
async function answerRun(page, plan) {
  const seen = [];
  for (let i = 0; i < plan.length; i += 1) {
    const q = (await questionText(page)).trim(); seen.push(q);
    const right = CORRECT.get(q) ?? 0;
    await cards(page).nth(plan[i] ? right : (right + 1) % 4).click(); await page.waitForTimeout(250);
    await page.locator('#next-btn').click(); await page.waitForTimeout(450);
  }
  return seen;
}
const fraction = (page) => page.evaluate(() => (document.getElementById('final-fraction')?.textContent || '').trim());
const rowsOf = (page) => page.$$eval('#history-list > li', (gs) => gs.map((g) => ({ run: g.getAttribute('data-run'), retry: Boolean(g.querySelector('[data-retry-run]')), rows: [...g.querySelectorAll('ul > li')].map((r) => ({ c: r.getAttribute('data-correct'), sr: r.querySelector('.sr-only')?.textContent || '', label: r.textContent })) })));

// ---- 1. Account → Progress: mastery bars + Next up ----------------------------------------------------
{
  const { page, gets, errors } = await open();
  await nav(page, '#nav-account');
  check('P1 Account shows the Progress block for the open book (mastery read for geron-homl3)', await page.locator('#account-progress-panel').isVisible() && gets.mastery.includes('geron-homl3'), gets.mastery.join(','));
  const rows = await page.$$eval('#mastery-list > li', (ls) => ls.map((l) => ({ id: l.getAttribute('data-area'), t: l.querySelector('[data-cell="pct"]')?.innerText.replace(/\s+/g, ' ').trim(), barHidden: l.querySelector('[aria-hidden="true"]') !== null, tc: l.querySelector('[data-cell="pct"]')?.textContent.replace(/\s+/g, ' ').trim() })));
  const by = Object.fromEntries(rows.map((r) => [r.id, r.t]));
  check('P2 every bar has its number as text: 92% 11/12 · 67% 4/6 target 80% · Not enough yet 0/3', rows.length === 3 && by.ch01 === '92% 11/12' && by.ch02 === '67% 4/6 target 80%' && by.ch03 === 'Not enough yet 0/3' && rows.every((r) => r.tc === r.t), JSON.stringify(by));
  check('P3 the bar itself is decoration (aria-hidden), the text carries the fact', rows.every((r) => r.barHidden));
  const nu = await raw(page, '#mastery-next-up');
  check('P4 Next up = the server\'s weakest (Chapter 2: Trees 67%), never the 0% area with 3 answers', /Next up\s*Chapter 2: Trees\s*67%/i.test(nu) && !/Nets/.test(nu), nu);
  await page.locator('#mastery-next-up-btn').click(); await page.waitForTimeout(800);
  const s = await raw(page, '#quiz-scope-label');
  const q = await answerRun(page, [true, true, true, true, true, true]);
  check('P5 Practice from Next up runs ONLY that area (6 ch2 questions) and lands on 6 / 6', q.every((x) => / c2 /.test(x)) && q.length === 6 && (await fraction(page)) === '6 / 6', `scope="${s}" seen=${q.map((x) => x.slice(7, 14)).join(',')} fraction=${await fraction(page)}`);
  check('P6 no page errors', errors.length === 0, errors.join('|'));
  await page.close();
}

// ---- 2. History: filters, area, Show more, words + shapes, focus -----------------------------------------
{
  const { page, gets, errors } = await open();
  await nav(page, '#nav-account');
  const first = gets.history[0] || {};
  check('H1 History asks for filter=all, no area, no cursor; All is pressed', first.filter === 'all' && !first.chapter && !first.cursor && (await page.locator('#history-filter-all').getAttribute('aria-pressed')) === 'true', JSON.stringify(first));
  let g = await rowsOf(page);
  check('H2 grouped by run: R2 (6 rows) offers Retry wrong; R1 (its miss not loaded yet) does not', g.length === 2 && g[0].run === 'run-r2' && g[0].rows.length === 6 && g[0].retry && g[1].run === 'run-r1' && !g[1].retry, JSON.stringify(g.map((x) => [x.run, x.rows.length, x.retry])));
  check('H3 right / wrong is a shape AND words for a screen reader (never colour alone)', g.flatMap((x) => x.rows).every((r) => (r.c === 'true' && r.sr === 'Right:') || (r.c === 'false' && r.sr === 'Wrong:')), JSON.stringify(g[0].rows.map((r) => [r.c, r.sr])));
  await page.locator('#history-more-btn').click(); await page.waitForTimeout(600);
  const more = gets.history.at(-1) || {};
  g = await rowsOf(page);
  check('H4 Show more sends cursor a:59 and appends: R1 grows to 3 rows and now offers Retry; the pre-v5 row reads Earlier', more.cursor === 'a:59' && g.length === 3 && g[1].rows.length === 3 && g[1].retry && !(await page.locator('#history-more-btn').count())
    && /earlier/i.test(await raw(page, '#history-list > li:nth-child(3)')), `${JSON.stringify(more)} ${JSON.stringify(g.map((x) => [x.run, x.rows.length, x.retry]))}`);
  await page.locator('#history-filter-all').focus(); await page.keyboard.press('Tab'); await page.waitForTimeout(150);
  const foc = await page.evaluate(() => ({ id: document.activeElement?.id, ring: getComputedStyle(document.activeElement).boxShadow }));
  check('F1 keyboard: Tab moves All -> Wrong and the focus ring is visible', foc.id === 'history-filter-wrong' && foc.ring !== 'none' && foc.ring !== '', JSON.stringify(foc));
  await page.keyboard.press('Enter'); await page.waitForTimeout(600);
  const w = gets.history.at(-1) || {};
  g = await rowsOf(page);
  check('H5 Wrong (by keyboard): asks filter=wrong, is pressed, lists only wrong rows', w.filter === 'wrong' && (await page.locator('#history-filter-wrong').getAttribute('aria-pressed')) === 'true' && (await page.locator('#history-filter-all').getAttribute('aria-pressed')) === 'false'
    && g.flatMap((x) => x.rows).length === 4 && g.flatMap((x) => x.rows).every((r) => r.c === 'false'), `${JSON.stringify(w)} rows=${g.flatMap((x) => x.rows).map((r) => r.c).join(',')}`);
  await page.locator('#history-filter-flagged').click(); await page.waitForTimeout(600);
  g = await rowsOf(page);
  check('H6 Flagged: asks filter=flagged; a never-answered flag reads "Not answered"', (gets.history.at(-1) || {}).filter === 'flagged' && g.flatMap((x) => x.rows).map((r) => r.sr).join('|') === 'Wrong:|Not answered:', g.flatMap((x) => x.rows).map((r) => r.sr).join('|'));
  await page.locator('#history-filter-all').click(); await page.waitForTimeout(400);
  await page.locator('#history-area').selectOption('ch02'); await page.waitForTimeout(600);
  const a = gets.history.at(-1) || {};
  check('H7 the area select sends chapter=2 and the list follows', a.chapter === '2' && a.filter === 'all' && (await rowsOf(page)).flatMap((x) => x.rows).length === 7, JSON.stringify(a));
  const stamps = await page.$$eval('#history-list span.tabular-nums', (ss) => ss.map((s) => s.textContent));
  check('H9 every time stamp reads dd-mm · hh:mm (a plain space here is 2 px wide: "22-1008:00")', stamps.length > 0 && stamps.every((s) => /^\d\d-\d\d · \d\d:\d\d$/.test(s)), stamps.slice(0, 3).join(' | '));
  check('H8 no page errors', errors.length === 0, errors.join('|'));
  await page.close();
}

// ---- 3. Retry wrong keeps the ORIGINAL denominator ------------------------------------------------------
{
  const { page, posts, errors } = await open();
  await nav(page, '#nav-account');
  await page.locator('#history-filter-wrong').click(); await page.waitForTimeout(600);
  await page.locator('[data-retry-run="run-r2"]').click(); await page.waitForTimeout(800);
  const scope = await raw(page, '#quiz-scope-label');
  const q = await answerRun(page, [true, true]);
  const fr = await fraction(page);
  const kinds = [...new Set(posts.answers.map((x) => x.runKind))];
  check('R1 Retry wrong from the Wrong filter redoes ONLY the 2 misses of run R2 (q2, q5)', q.length === 2 && q.every((x) => / c2 q[25]:/.test(x)) && /retrying 2 of 6/i.test(scope), `scope="${scope}" seen=${q.map((x) => x.slice(7, 14)).join(',')}`);
  check('R2 ...and the result keeps the ORIGINAL denominator: 6 / 6 (not 2 / 2)', fr === '6 / 6', fr);
  check('R3 retry answers are logged as runKind retry (left out of mastery)', posts.answers.length === 2 && kinds.length === 1 && kinds[0] === 'retry', JSON.stringify(posts.answers.map((x) => [x.question, x.runKind])));
  await nav(page, '#nav-account');
  await page.locator('#history-filter-all').click(); await page.waitForTimeout(500);
  await page.locator('#history-more-btn').click(); await page.waitForTimeout(600);
  await page.locator('[data-retry-run="run-r1"]').click(); await page.waitForTimeout(800);
  const q1 = await answerRun(page, [false]);
  check('R4 a run split over two pages: retry its 1 miss, miss it again -> 2 / 3 (its own denominator)', q1.length === 1 && / c1 q3:/.test(q1[0]) && (await fraction(page)) === '2 / 3', `${q1.map((x) => x.slice(7, 14))} ${await fraction(page)}`);
  check('R5 no page errors', errors.length === 0, errors.join('|'));
  await page.close();
}

// ---- 4. the Practice dialog's Next up row + the Book select --------------------------------------------
{
  const { page, gets, errors } = await open();
  await nav(page, '#nav-quiz');
  const row = await raw(page, '#setup-next-up');
  check('S1 Practice dialog: Next up row = Chapter 2: Trees 67% with a Practice button', /Next up\s*Chapter 2: Trees\s*67%/.test(row) && await page.locator('#setup-next-up-btn').isEnabled(), row);
  await page.locator('#setup-next-up-btn').click(); await page.waitForTimeout(800);
  const q = (await questionText(page)).trim();
  check('S2 ...and starts a run of that area', / c2 /.test(q), q.slice(0, 30));
  await nav(page, '#nav-account');
  await page.locator('#progress-book').selectOption('gate-other'); await page.waitForTimeout(1200);
  check('B1 the Book select opens the other book (its mastery is read)', gets.mastery.includes('gate-other') && /Other book/i.test(await raw(page, '#account-progress-panel')), gets.mastery.join(','));
  check('B2 a book with no areas says so, no error', /No answers yet/i.test(await raw(page, '#account-progress-panel')) && errors.length === 0, errors.join('|'));
  await page.close();
}

// ---- 5. three widths: sizes, no sideways scroll, screenshots -------------------------------------------
for (const [w, h] of [[390, 844], [834, 1112], [1440, 900]]) {
  const { page, errors, native } = await open({ width: w, height: h });
  await nav(page, '#nav-account');
  await page.locator('#history-more-btn').click(); await page.waitForTimeout(600);
  await page.locator('#account-progress-panel').scrollIntoViewIfNeeded();
  const d = await sideways(page);
  const boxes = await minBox(page, '#progress-book, #mastery-next-up-btn, #history-filter-all, #history-filter-wrong, #history-filter-flagged, #history-area, [data-retry-run]');
  await page.locator('#account-progress-panel').screenshot({ path: `${SHOTS}/account-progress-${w}.png` });
  await page.screenshot({ path: `${SHOTS}/account-page-${w}.png`, fullPage: true });
  await nav(page, '#nav-quiz');
  const p = await sideways(page);
  const nb = await minBox(page, '#setup-next-up-btn');
  await page.screenshot({ path: `${SHOTS}/practice-nextup-${w}.png`, fullPage: true });
  check(`W ${w}px: nothing outside the header sticks out (Account Progress / Practice); every new control >= 44 px`, d <= 0 && p <= 0 && boxes.length >= 8 && boxes.every((n) => n >= 44) && nb[0] >= 44 && errors.length === 0 && native.length === 0,
    `overflow ${d}/${p} boxes ${boxes.join(',')} next-up ${nb.join(',')} ${errors.join('|')}`);
  await page.close();
}

await browser.close(); server.close();
const bad = results.filter((r) => !r).length;
console.log(`\n${results.length - bad}/${results.length} passed · screenshots in ${SHOTS}`);
process.exit(bad ? 1 : 0);
