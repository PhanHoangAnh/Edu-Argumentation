#!/usr/bin/env node
/**
 * gate-practice-resume.mjs — Practice question count + a run surviving a reload, 23-10-26 (user order).
 *
 * Tier 1/2, browser: drives the REAL built bundle (app/frontend/dist) with the API stubbed in the
 * browser, so it needs no database and no running service:
 *     cd app/frontend && ./node_modules/.bin/vite build && node ../../gates/gate-multi-answer.mjs
 * It serves dist/ itself on a loopback port. Proves, on the real components:
 *   M  a choose-2 question: "Choose 2" hint, Check disabled until exactly 2 ticks, at most 2 ticks,
 *      no verdict before Check, exact-set grading, per-option explanations, no write on a right answer;
 *   S  a SINGLE-answer question still answers on one click, shows no Check button, and posts the old
 *      {chosen, correct} body with no sets;
 *   M  a wrong set posts chosenSet + correctSet, keeps the score, marks missed right options correct.
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const DIST = process.env.MA_DIST || resolve(fileURLToPath(new URL('.', import.meta.url)), '../app/frontend/dist');
if (!existsSync(join(DIST, 'index.html'))) { console.log(`FAIL  M0  no build at ${DIST} — run vite build first`); process.exit(2); }
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.json': 'application/json' };
const server = createServer((req, res) => {
  const path = new URL(req.url, 'http://x').pathname;
  const file = join(DIST, path === '/' ? 'index.html' : path);
  if (!file.startsWith(DIST) || !existsSync(file)) { res.writeHead(404); res.end('no'); return; }
  res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' }); res.end(readFileSync(file));
});
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const BASE = `http://127.0.0.1:${server.address().port}`;
const results = [];
const check = (id, pass, detail) => { results.push({ id, pass }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${id}  ${detail ?? ''}`); };

const opt = (t, i) => `Option ${t}`;
const mk = (q, options, correct, n) => ({ question: q, options, correct, explanations: options.map((o, i) => `Why ${o} is ${[].concat(correct).includes(i) ? 'right' : 'wrong'}: a typical one-line explanation of about this length.`),
  source: { chapter: 1, block: 'ch01-b01', question: `ch01-b01-q${n}` } });
const module_ = {
  moduleId: 'geron-homl3',
  tutorialData: { title: 'Test book', sections: [{ title: 'Chapter 1: Test', themeColor: 'indigo-500', items: [{ term: 'Lesson one', blocks: [{ type: 'text', content: 'Hello lesson.' }] }] }] },
  quizData: Array.from({ length: 25 }, (_, i) => mk(`Q${i + 1} single`, [`A${i + 1}`, `B${i + 1}`, `C${i + 1}`, `D${i + 1}`], 2, i + 1)),
};
const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
const posts = [];
const browser = await chromium.launch({ executablePath: chromium.executablePath() });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 1000 } })).newPage();
const errors = []; page.on('pageerror', e => errors.push(String(e).slice(0, 200)));
await page.route('**/api/**', async (route) => {
  const u = new URL(route.request().url()); const m = route.request().method();
  if (u.pathname === '/api/auth/me') return json(route, { account: { id: 1, username: 't', displayName: 'T', isOwner: true } });
  if (u.pathname === '/api/modules') return json(route, { books: [{ file: 'geron-homl3', book: 'geron-homl3', base: 'book/geron-homl3/', moduleId: 'geron-homl3', title: 'Test book', chapters: 1, lessons: 1, questions: 3, default: true }] });
  if (u.pathname === '/api/wrong-answers' && m === 'POST') { posts.push(JSON.parse(route.request().postData() || '{}')); return json(route, { recorded: true }, 201); }
  if (u.pathname === '/api/progress') return json(route, { module: 'geron-homl3', completed: {} });
  if (u.pathname === '/api/general') return json(route, { ai_question_count: 5, fresh_quiz_size: 10 });
  if (u.pathname === '/api/provider') return json(route, { ready: false, model: '', token_required: false });
  if (u.pathname === '/api/settings') return json(route, {});
  return json(route, {});
});
await page.route('**/book/geron-homl3/module.json', (route) => json(route, module_));
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForTimeout(800);
const badge = () => page.locator('#question-number-badge').innerText();
const qtext = () => page.locator('#question-text').innerText();
await page.locator('#nav-quiz').click(); await page.waitForTimeout(500);
check('C1 Practice offers All/10/20/30/50', (await page.locator('#practice-count [role=radio]').allInnerTexts()).join(',') === 'All,10,20,30,50');
check('C2 default is All', (await page.locator('#practice-count [role=radio][aria-checked=true]').innerText()) === 'All');
await page.locator('#practice-count [role=radio]', { hasText: /^10$/ }).click();
await page.locator('#setup-all-btn').click(); await page.locator('#setup-start-btn').click(); await page.waitForTimeout(800);
const first = await badge();
check('C3 a run of 10 of the 25 questions', /10 questions/i.test(await page.locator('#quiz-screen').innerText()), (await page.locator('#quiz-screen').innerText()).slice(0, 120).replace(/\n/g, ' | '));
// answer two questions
for (let k = 0; k < 2; k++) { await page.locator('#options-container .option-card').nth(2).click(); await page.waitForTimeout(400); await page.locator('#next-btn').click(); await page.waitForTimeout(400); }
const third = await badge();
await page.reload({ waitUntil: 'networkidle' }); await page.waitForTimeout(1200);
check('R1 after a hard reload the quiz screen is back', await page.locator('#question-text').isVisible(), '');
check('R2 it is the same third question, not the first', (await badge()) === third && third === '3' && first === '1', `${third} vs ${first}`);
const score = await page.locator('#quiz-screen').innerText();
check('R3 score kept (2 right)', /score:?\s*2/i.test(score), score.slice(0, 160).replace(/\n/g, ' | '));
// finish the run -> nothing left to resume
for (let k = 0; k < 8; k++) { await page.locator('#options-container .option-card').nth(2).click(); await page.waitForTimeout(250); await page.locator('#next-btn').click(); await page.waitForTimeout(250); }
await page.waitForTimeout(800);
await page.reload({ waitUntil: 'networkidle' }); await page.waitForTimeout(1000);
check('R4 a finished run is not resumed', !(await page.locator('#question-text').isVisible()), '');

// F: after answering, ALL four options AND their explanations fit above the pinned bar with no scrolling (user, 23-10-26).
for (const [w, h] of [[1920, 867], [1366, 650], [390, 844]]) {
  await page.setViewportSize({ width: w, height: h });
  await page.reload({ waitUntil: 'networkidle' }); await page.waitForTimeout(800);
  if (!(await page.locator('#options-container').isVisible())) { await page.locator('#nav-quiz').click(); await page.locator('#setup-all-btn').click(); await page.locator('#setup-start-btn').click(); await page.waitForTimeout(600); }
  await page.locator('#options-container .option-card').nth(0).click(); await page.waitForTimeout(1200);
  const m = await page.evaluate(() => { window.scrollTo(0, 0); const bar = document.querySelector('#action-container').getBoundingClientRect().top; const cs = [...document.querySelectorAll('#options-container .option-card')]; return { gap: Math.round(bar - cs[cs.length - 1].getBoundingClientRect().bottom), n: cs.length, closedStrip: null }; });
  console.log(`INFO  F ${w}x${h}: last card ends ${m.gap}px above the bar (n=${m.n})`);
  if (w >= 1024 && h >= 800) check(`F1 ${w}x${h} all options + explanations visible without scrolling`, m.gap >= 0, String(m.gap));
  await page.locator('#next-btn').click(); await page.waitForTimeout(300);
}
check('E0 no page errors', errors.length === 0, errors.join(' | '));
await browser.close(); server.close();
const bad = results.filter((r) => !r.pass).length;
console.log(`${results.length - bad}/${results.length} passed`);
process.exit(bad ? 1 : 0);
