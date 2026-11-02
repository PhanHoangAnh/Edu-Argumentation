#!/usr/bin/env node
/**
 * gate-multi-answer.mjs — choose-N (multi-answer) quiz questions, 21-10-26 (user-approved).
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
 * ⛔ Mutation-checked when written: with sameSet() forced to return true, M15, M16 and R1 go RED (19/22).
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
const mk = (q, options, correct, n) => ({ question: q, options, correct, explanations: options.map((o, i) => `Why ${o} is ${[].concat(correct).includes(i) ? 'right' : 'wrong'}.`),
  source: { chapter: 1, block: 'ch01-b01', question: `ch01-b01-q${n}` } });
const module_ = {
  moduleId: 'geron-homl3',
  tutorialData: { title: 'Test book', sections: [{ title: 'Chapter 1: Test', themeColor: 'indigo-500', items: [{ term: 'Lesson one', blocks: [{ type: 'text', content: 'Hello lesson.' }] }] }] },
  quizData: [
    mk('Q1 choose two', ['A1', 'B1', 'C1', 'D1', 'E1'], [1, 3], 1),
    mk('Q2 single', ['A2', 'B2', 'C2', 'D2'], 2, 2),
    mk('Q3 choose two', ['A3', 'B3', 'C3', 'D3', 'E3'], [0, 2], 3),
  ],
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
await page.setViewportSize({ width: 1366, height: 768 });
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForTimeout(800);
await page.locator('#nav-quiz').click(); await page.waitForTimeout(500);
await page.locator('#setup-all-btn').click(); await page.locator('#setup-start-btn').click(); await page.waitForTimeout(800);

const vis = (sel) => page.evaluate((s) => { const e = document.querySelector(s); if (!e) return false; const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).display !== 'none'; }, sel);
const cards = () => page.locator('#options-container .option-card');
const reveals = () => cards().evaluateAll((els) => els.map((e) => e.getAttribute('data-reveal')));
const pressed = () => cards().evaluateAll((els) => els.map((e) => e.getAttribute('aria-pressed')));

// ---- Q1: choose two of five ------------------------------------------------------------
const qtext = () => page.evaluate(() => { const v = document.querySelector('#question-text rich-text-viewer'); return (v && v.shadowRoot ? v.shadowRoot.textContent : document.querySelector('#question-text').textContent) || ''; });
check('M1 question text is Q1', (await qtext()).includes('Q1'), await qtext());
check('M2 the pinned bar says Choose 2', /choose 2/i.test(await page.locator('#next-hint').innerText()), await page.locator('#next-hint').innerText());
check('M2b no extra hint line above the options', (await page.locator('#multi-hint').count()) === 0);
check('M3 five cards', (await cards().count()) === 5);
check('M4 Check is visible and disabled, Next hidden', (await vis('#check-btn')) && (await page.locator('#check-btn').isDisabled()) && !(await vis('#next-btn')));
await cards().nth(0).click(); await cards().nth(1).click(); await cards().nth(2).click();
await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
const lay = await page.evaluate(() => { const bar = document.querySelector('#action-container').getBoundingClientRect().top; return [...document.querySelectorAll('#options-container .option-card')].map((c) => Math.round(bar - c.getBoundingClientRect().bottom)); });
// 23-10-26: options are ONE column now (user), so five cards no longer fit above the bar unscrolled; the contract is that scrolled to the end, the LAST card clears the pinned bar.
check('L1 at 1366x768 scrolled to the end, the last of the 5 options sits clear above the pinned bar', lay.length === 5 && lay[4] >= 8, JSON.stringify(lay));
check('M5 at most 2 ticks (third click ignored)', JSON.stringify(await pressed()) === JSON.stringify(['true', 'true', 'false', 'false', 'false']), JSON.stringify(await pressed()));
check('M6 no verdict before Check', (await reveals()).every((r) => r === null));
check('M7 Check enabled with exactly 2', !(await page.locator('#check-btn').isDisabled()));
await cards().nth(0).click(); await cards().nth(3).click();
check('M8 untick + tick works: B and D ticked', JSON.stringify(await pressed()) === JSON.stringify(['false', 'true', 'false', 'true', 'false']), JSON.stringify(await pressed()));
await page.screenshot({ path: (process.env.MA_SHOTS || '/var/tmp') + '/ma-q1-ticked.png' });
await page.locator('#check-btn').click(); await page.waitForTimeout(500);
check('M9 exact set -> B and D correct, others incorrect', JSON.stringify(await reveals()) === JSON.stringify(['incorrect', 'correct', 'incorrect', 'correct', 'incorrect']), JSON.stringify(await reveals()));
check('M10 score 1, Next visible, Check gone', (await page.locator('#score-tracker').innerText()) === '1' && (await vis('#next-btn')) && !(await vis('#check-btn')));
check('M11 a right answer posts nothing', posts.length === 0);
const expl = await cards().nth(1).locator('.explanation-text').innerText();
check('M12 explanations shown per option', expl.includes('Why B1 is right'), expl.replace(/\s+/g, ' ').slice(0, 60));
await page.screenshot({ path: (process.env.MA_SHOTS || '/var/tmp') + '/ma-q1-answered.png' });
await page.locator('#next-btn').click(); await page.waitForTimeout(400);

// ---- Q2: single answer must behave exactly as before ----------------------------------
check('S1 Q2 shows no Choose hint and no Check button', !/choose/i.test(await page.locator('#next-hint').innerText().catch(() => '')) && (await page.locator('#check-btn').count()) === 0);
check('S2 Next hidden until answered', !(await vis('#next-btn')));
await cards().nth(0).click(); await page.waitForTimeout(500);
check('S3 one click answers (incorrect pick), C marked correct', JSON.stringify(await reveals()) === JSON.stringify(['incorrect', 'incorrect', 'correct', 'incorrect']), JSON.stringify(await reveals()));
check('S4 single miss posts chosen/correct, no sets', posts.length === 1 && posts[0].chosen === 0 && posts[0].correct === 2 && posts[0].chosenSet === undefined, JSON.stringify(posts[0]));
await page.locator('#next-btn').click(); await page.waitForTimeout(400);

// ---- Q3: a wrong set ------------------------------------------------------------------
check('M13 Q3 is choose-2 and starts clean', /choose 2.*0 selected/i.test(await page.locator('#next-hint').innerText()), await page.locator('#next-hint').innerText());
await cards().nth(0).click(); await cards().nth(1).click();
await page.locator('#check-btn').click(); await page.waitForTimeout(500);
check('M14 wrong set: A right (picked), B wrong (picked), C right (missed)', JSON.stringify(await reveals()) === JSON.stringify(['correct', 'incorrect', 'correct', 'incorrect', 'incorrect']), JSON.stringify(await reveals()));
check('M15 score stays 1', (await page.locator('#score-tracker').innerText()) === '1');
const last = posts[posts.length - 1];
check('M16 wrong set posted with both sets', posts.length === 2 && JSON.stringify(last.chosenSet) === '[0,1]' && JSON.stringify(last.correctSet) === '[0,2]' && last.chosen === 0 && last.correct === 0, JSON.stringify(last));
await page.screenshot({ path: (process.env.MA_SHOTS || '/var/tmp') + '/ma-q3-wrong.png' });
await page.locator('#next-btn').click(); await page.waitForTimeout(800);
const result = await page.locator('#final-fraction').innerText().catch(() => '');
check('R1 result screen shows 1 of 3', /1\s*\/\s*3|1 of 3/.test(result), result);
check('E0 no page errors', errors.length === 0, errors.join(' | '));
await browser.close();
server.close();
const bad = results.filter((r) => !r.pass);
console.log(`\n${results.length - bad.length}/${results.length} passed`);
process.exit(bad.length ? 1 : 0);
