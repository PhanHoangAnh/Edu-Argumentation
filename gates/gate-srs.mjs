#!/usr/bin/env node
/**
 * gate-srs.mjs — active recall + spaced repetition in the reader, 21-10-26.
 *
 * Tier 1/2, browser: the REAL built bundle (app/frontend/dist) with the API stubbed in the browser:
 *     cd app/frontend && ./node_modules/.bin/vite build && node ../../gates/gate-srs.mjs
 * Proves: an ordinary quiz answer enrols the question (POST /api/review/seen) and a review run does NOT;
 * the Practice dialog shows "N due" + "Review due (N)"; a review run shows the question ALONE first
 * (recall-first: no option cards until "Show options"); a wrong answer is graded `again` by itself;
 * a right answer waits for Hard / Good / Easy (also for a choose-N question) and that click grades and
 * moves on; and with the server silent the dialog shows no review UI at all (nothing breaks).
 * ⛔ Mutation-checked when written (see the README row).
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const DIST = process.env.MA_DIST || resolve(fileURLToPath(new URL('.', import.meta.url)), '../app/frontend/dist');
if (!existsSync(join(DIST, 'index.html'))) { console.log(`FAIL  X0  no build at ${DIST} — run vite build first`); process.exit(2); }
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
const mk = (q, options, correct, n) => ({ question: q, options, correct, explanations: options.map((o) => `Why ${o}.`), source: { chapter: 1, block: 'ch01-b01', question: `ch01-b01-q${n}` } });
const module_ = {
  moduleId: 'geron-homl3',
  tutorialData: { title: 'Test book', sections: [{ title: 'Chapter 1: Test', themeColor: 'indigo-500', items: [{ term: 'Lesson one', blocks: [{ type: 'text', content: 'Hello.' }] }] }] },
  quizData: [mk('Q1 single', ['A1', 'B1', 'C1', 'D1'], 0, 1), mk('Q2 single', ['A2', 'B2', 'C2', 'D2'], 2, 2), mk('Q3 choose two', ['A3', 'B3', 'C3', 'D3', 'E3'], [1, 3], 3)],
};
const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
const browser = await chromium.launch({ executablePath: chromium.executablePath() });

async function open(dueMode) {
  const posts = { seen: [], grade: [] };
  const page = await (await browser.newContext({ viewport: { width: 1366, height: 768 } })).newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(String(e).slice(0, 160)));
  await page.route('**/api/**', (route) => {
    const u = new URL(route.request().url()); const m = route.request().method();
    if (u.pathname === '/api/auth/me') return json(route, { account: { id: 1, username: 't', displayName: 'T', isOwner: true } });
    if (u.pathname === '/api/modules') return json(route, { books: [{ file: 'geron-homl3', book: 'geron-homl3', base: 'book/geron-homl3/', moduleId: 'geron-homl3', title: 'Test book', chapters: 1, lessons: 1, questions: 3, default: true }] });
    if (u.pathname === '/api/review/seen' && m === 'POST') { posts.seen.push(JSON.parse(route.request().postData() || '{}')); return json(route, { outcome: 'created' }); }
    if (u.pathname === '/api/review/grade' && m === 'POST') { posts.grade.push(JSON.parse(route.request().postData() || '{}')); return json(route, { question: 'x' }); }
    if (u.pathname === '/api/review/due') {
      if (dueMode === 'down') return route.fulfill({ status: 500, body: 'no' });
      if (dueMode === 'empty') return json(route, { due: [], dueCount: 0, total: 0 });
      return json(route, { due: [{ question: 'ch01-b01-q2', dueAt: 'x', reps: 1, lapses: 0 }, { question: 'ch01-b01-q3', dueAt: 'x', reps: 2, lapses: 0 }, { question: 'ch01-b01-q1', dueAt: 'x', reps: 1, lapses: 1 }], dueCount: 3, total: 3 });
    }
    if (u.pathname === '/api/progress') return json(route, { module: 'geron-homl3', completed: {} });
    if (u.pathname === '/api/general') return json(route, { ai_question_count: 5, fresh_quiz_size: 10 });
    if (u.pathname === '/api/provider') return json(route, { ready: false, model: '', token_required: false });
    return json(route, {});
  });
  await page.route('**/book/geron-homl3/module.json', (route) => json(route, module_));
  await page.goto(BASE, { waitUntil: 'networkidle' }); await page.waitForTimeout(800);
  return { page, posts, errors };
}
const cards = (page) => page.locator('#options-container .option-card');
const exists = (page, sel) => page.locator(sel).count().then((n) => n > 0);

// ---- 1. an ordinary run enrols questions, with no recall panel ---------------------------------
{
  const { page, posts, errors } = await open('due');
  await page.locator('#nav-quiz').click(); await page.waitForTimeout(500);
  check('E1 Practice dialog says 3 due and offers Review due (3)', /3 questions due for review/i.test(await page.locator('#review-status').innerText()) && /review due \(3\)/i.test(await page.locator("#setup-review-btn").innerText()));
  await page.locator('#setup-all-btn').click(); await page.locator('#setup-start-btn').click(); await page.waitForTimeout(900);
  check('E2 ordinary run: options show at once, no recall panel', (await cards(page).count()) === 4 && !(await exists(page, '#recall-panel')));
  await cards(page).nth(0).click(); await page.waitForTimeout(300);          // Q1: A1 is right
  check('E3 right answer enrols with correct:true', posts.seen.length === 1 && posts.seen[0].question === 'ch01-b01-q1' && posts.seen[0].correct === true, JSON.stringify(posts.seen[0]));
  await page.locator('#next-btn').click(); await page.waitForTimeout(300);
  await cards(page).nth(0).click(); await page.waitForTimeout(300);          // Q2: A2 wrong
  check('E4 wrong answer enrols with correct:false', posts.seen.length === 2 && posts.seen[1].question === 'ch01-b01-q2' && posts.seen[1].correct === false, JSON.stringify(posts.seen[1]));
  await page.locator('#next-btn').click(); await page.waitForTimeout(300);
  await cards(page).nth(1).click(); await cards(page).nth(3).click(); await page.locator('#check-btn').click(); await page.waitForTimeout(300);  // Q3 choose-2 right
  check('E5 choose-N answer enrols too', posts.seen.length === 3 && posts.seen[2].question === 'ch01-b01-q3' && posts.seen[2].correct === true);
  check('E6 an ordinary run grades nothing', posts.grade.length === 0);
  check('E7 no page errors', errors.length === 0, errors.join('|'));
  await page.close();
}

// ---- 2. a review run -------------------------------------------------------------------------------
{
  const { page, posts, errors } = await open('due');
  await page.locator('#nav-quiz').click(); await page.waitForTimeout(500);
  await page.locator('#setup-review-btn').click(); await page.waitForTimeout(900);
  check('V1 header says Review · 3 due', /review\s*·\s*3 due/i.test(await page.locator('#quiz-scope-label').innerText()), await page.locator('#quiz-scope-label').innerText());
  check('V2 recall-first: the question shows ALONE (no option cards, a recall box, Show options)', (await cards(page).count()) === 0 && (await exists(page, '#recall-input')) && (await exists(page, '#recall-show-btn')));
  check('V3 first card is the first due question (Q2)', (await page.evaluate(() => { const v = document.querySelector('#question-text rich-text-viewer'); return v && v.shadowRoot ? v.shadowRoot.textContent : document.querySelector('#question-text').textContent; })).includes('Q2'));
  await page.locator('#recall-input').fill('something from memory'); await page.locator('#recall-show-btn').click(); await page.waitForTimeout(300);
  check('V4 Show options reveals the four options and removes the recall box', (await cards(page).count()) === 4 && !(await exists(page, '#recall-panel')));
  await cards(page).nth(0).click(); await page.waitForTimeout(400);           // Q2 wrong
  check('V5 a wrong answer is graded again at once (exactly one post)', posts.grade.length === 1 && posts.grade[0].question === 'ch01-b01-q2' && posts.grade[0].grade === 'again', JSON.stringify(posts.grade));
  check('V6 no grade buttons after a wrong answer; Next is available', !(await exists(page, '#grade-buttons')) && (await page.locator('#next-btn').isVisible()));
  check('V7 a review run enrols nothing', posts.seen.length === 0);
  await page.locator('#next-btn').click(); await page.waitForTimeout(400);
  check('V8 next card is recall-first again, and the recall box is empty', (await cards(page).count()) === 0 && (await page.locator('#recall-input').inputValue()) === '');
  await page.locator('#recall-show-btn').click(); await page.waitForTimeout(300);
  check('V9 Q3 is choose-2: Check shows, tick the right two', (await exists(page, '#check-btn')));
  await cards(page).nth(1).click(); await cards(page).nth(3).click(); await page.locator('#check-btn').click(); await page.waitForTimeout(400);
  check('V10 right choose-N answer: Hard / Good / Easy appear, Next hidden, nothing graded yet', (await exists(page, '#grade-hard-btn')) && (await exists(page, '#grade-good-btn')) && (await exists(page, '#grade-easy-btn')) && !(await page.locator('#next-btn').isVisible()) && posts.grade.length === 1);
  await page.locator('#grade-easy-btn').click(); await page.waitForTimeout(400);
  check('V11 Easy grades the question easy and moves on', posts.grade.length === 2 && posts.grade[1].question === 'ch01-b01-q3' && posts.grade[1].grade === 'easy', JSON.stringify(posts.grade[1]));
  await page.locator('#recall-show-btn').click(); await page.waitForTimeout(300);
  await cards(page).nth(0).click(); await page.waitForTimeout(400);            // Q1 right
  await page.locator('#grade-good-btn').click(); await page.waitForTimeout(700);
  check('V12 Good grades the last card and the run finishes', posts.grade.length === 3 && posts.grade[2].grade === 'good' && (await page.locator('#result-screen').isVisible().catch(() => false)), JSON.stringify(posts.grade[2]));
  check('V13 no enrolment calls during the whole review', posts.seen.length === 0);
  check('V14 no page errors', errors.length === 0, errors.join('|'));
  await page.close();
}

// ---- 3. nothing due / server silent -------------------------------------------------------------------
for (const [mode, label] of [['empty', 'empty deck'], ['down', 'server answers 500']]) {
  const { page, errors } = await open(mode);
  await page.locator('#nav-quiz').click(); await page.waitForTimeout(600);
  check(`N1 ${label}: no Review button`, !(await exists(page, '#setup-review-btn')));
  if (mode === 'down') check('N2 server 500: no review line either, dialog still works', !(await exists(page, '#review-status')) && (await page.locator('#setup-start-btn').isVisible()));
  else check('N2 empty deck: the explanatory line shows', /come back for review/i.test(await page.locator('#review-status').innerText()));
  check(`N3 ${label}: no page errors`, errors.length === 0, errors.join('|'));
  await page.close();
}
await browser.close(); server.close();
const bad = results.filter((r) => !r).length;
console.log(`\n${results.length - bad}/${results.length} passed`);
process.exit(bad ? 1 : 0);
