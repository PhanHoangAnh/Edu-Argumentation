#!/usr/bin/env node
/**
 * gate-review-reminder.mjs — the floating review reminder (quiz/ReviewReminder.tsx), 01-11-26.
 *
 * Tier 1/2, browser: the REAL built bundle (app/frontend/dist) with the API stubbed in the browser:
 *     cd app/frontend && ./node_modules/.bin/vite build && node ../../gates/gate-review-reminder.mjs
 * Proves: with cards due the button sits on the right edge with a red badge = dueCount and shakes
 * (animation reviewNudge); its panel has ONE row per chapter (blocks of one chapter merged, book order,
 * unknown blocks under "Other" last) and a chapter's Review button asks /api/review/due-in for THAT
 * chapter's blocks only and opens a recall-first run of them; the Review button opens a "how many"
 * field (99 typed on a 2-question chapter becomes 2, 1 runs 1); the button hides during the quiz; with
 * nothing due there is no badge and no motion; with the server failing there is no button at all.
 * 01-11-26 per-chapter rework. Screenshots: /var/tmp/review-reminder-*.png.
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
const mk = (q, options, correct, ch, n) => ({ question: q, options, correct, explanations: options.map((o) => `Why ${o}.`), source: { chapter: ch, block: `ch0${ch}-b01`, question: `ch0${ch}-b01-q${n}` } });
const module_ = {
  moduleId: 'geron-homl3',
  tutorialData: { title: 'Test book', sections: [
    { title: 'Chapter 1: Cloud', themeColor: 'indigo-500', items: [{ term: 'Lesson one', blocks: [{ type: 'text', content: 'Hello.' }] }] },
    { title: 'Chapter 2: Storage', themeColor: 'indigo-500', items: [{ term: 'Lesson two', blocks: [{ type: 'text', content: 'Hi.' }] }] },
  ] },
  quizData: [mk('Q1', ['A1', 'B1', 'C1', 'D1'], 0, 1, 1), mk('Q2', ['A2', 'B2', 'C2', 'D2'], 2, 1, 2), mk('Q3', ['A3', 'B3', 'C3', 'D3'], 1, 2, 1)],
};
// One block per chapter, plus "other" (cards with no book key) which must land in "Other", last.
const BLOCKS = { blocks: [{ block: 'ch01-b01', due: 2 }, { block: 'ch02-b01', due: 1 }, { block: 'other', due: 4 }], dueCount: 7, total: 9 };
const CARDS = { 'ch01-b01': [{ question: 'ch01-b01-q2', dueAt: 'x', reps: 1, lapses: 0 }, { question: 'ch01-b01-q1', dueAt: 'x', reps: 2, lapses: 0 }], 'ch02-b01': [{ question: 'ch02-b01-q1', dueAt: 'x', reps: 1, lapses: 0 }] };
const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
const browser = await chromium.launch({ executablePath: chromium.executablePath() });
async function open(dueMode) {
  const page = await (await browser.newContext({ viewport: { width: 1366, height: 768 } })).newPage();
  const dueIn = [];
  const errors = []; page.on('pageerror', (e) => errors.push(String(e).slice(0, 160)));
  await page.route('**/api/**', (route) => {
    const u = new URL(route.request().url());
    if (u.pathname === '/api/auth/me') return json(route, { account: { id: 1, username: 't', displayName: 'T', isOwner: true } });
    if (u.pathname === '/api/modules') return json(route, { books: [{ file: 'geron-homl3', book: 'geron-homl3', base: 'book/geron-homl3/', moduleId: 'geron-homl3', title: 'Test book', chapters: 2, lessons: 2, questions: 3, default: true }] });
    if (u.pathname === '/api/review/due-blocks') {
      if (dueMode === 'down') return route.fulfill({ status: 500, body: 'no' });
      if (dueMode === 'empty') return json(route, { blocks: [], dueCount: 0, total: 5 });
      return json(route, BLOCKS);
    }
    if (u.pathname === '/api/review/due-in') {
      const blocks = (u.searchParams.get('blocks') || '').split(',');
      const limit = Number(u.searchParams.get('limit'));
      dueIn.push({ blocks: blocks.join(','), limit });
      const due = blocks.flatMap((b) => CARDS[b] || []).slice(0, limit);
      return json(route, { due, dueCount: due.length });
    }
    if (u.pathname === '/api/progress') return json(route, { module: 'geron-homl3', completed: {} });
    if (u.pathname === '/api/general') return json(route, { ai_question_count: 5, fresh_quiz_size: 10 });
    if (u.pathname === '/api/provider') return json(route, { ready: false, model: '', token_required: false });
    return json(route, {});
  });
  await page.route('**/book/geron-homl3/module.json', (route) => json(route, module_));
  await page.goto(BASE, { waitUntil: 'networkidle' }); await page.waitForTimeout(800);
  return { page, errors, dueIn };
}
const btn = (page) => page.locator('#review-reminder');
const exists = (page, sel) => page.locator(sel).count().then((n) => n > 0);
const anim = (page) => btn(page).evaluate((el) => getComputedStyle(el).animationName);

// ---- 1. cards due ------------------------------------------------------------------------------------
{
  const { page, errors, dueIn } = await open('due');
  const box = await btn(page).boundingBox();
  check('D1 button visible on the right edge, around mid-height', Boolean(box) && box.x + box.width > 1366 - 40 && box.y > 768 * 0.3 && box.y < 768 * 0.7, JSON.stringify(box));
  check('D2 red badge shows the total due count', (await page.locator('#review-reminder-badge').innerText()).trim() === '7');
  check('D3 button shakes (animation reviewNudge)', (await anim(page)) === 'reviewNudge', await anim(page));
  await page.screenshot({ path: '/var/tmp/review-reminder-due.png' });
  await btn(page).click(); await page.waitForTimeout(300);
  const rows = await page.locator('#review-reminder-chapters li').allInnerTexts();
  check('D4 one row per chapter, book order, Other last', rows.length === 3 && /Chapter 1: Cloud/.test(rows[0]) && /2 left/.test(rows[0]) && /Chapter 2: Storage/.test(rows[1]) && /1 left/.test(rows[1]) && /Other/.test(rows[2]) && /4 left/.test(rows[2]), rows.map((r) => r.replace(/\n/g, ' ')).join(' | '));
  await page.screenshot({ path: '/var/tmp/review-reminder-panel.png' });
  await page.keyboard.press('Escape'); await page.waitForTimeout(200);
  check('D5 Escape closes the panel', !(await exists(page, '#review-reminder-panel')));
  await btn(page).click(); await page.waitForTimeout(200);
  check('D6 Review opens a how-many field, not a run', !(await exists(page, '.review-pick-input')) && (await page.locator('li[data-chapter="chapter-0"] .review-pick-btn').click().then(() => page.waitForTimeout(200)).then(() => exists(page, '.review-pick-input'))) && dueIn.length === 0);
  const input = page.locator('li[data-chapter="chapter-0"] .review-pick-input');
  await input.fill('99'); await input.blur(); await page.waitForTimeout(100);
  check('D7 typing 99 on a 2-question chapter corrects to 2', (await input.inputValue()) === '2', await input.inputValue());
  await page.locator('li[data-chapter="chapter-0"] .review-pick-start').click(); await page.waitForTimeout(900);
  check('D7b the run asks for that chapter\'s blocks with limit 2 and runs 2', dueIn.length === 1 && dueIn[0].blocks === 'ch01-b01' && dueIn[0].limit === 2 && /chapter 1: cloud\s*·\s*2 due/i.test(await page.locator('#quiz-scope-label').innerText()), JSON.stringify(dueIn) + ' ' + await page.locator('#quiz-scope-label').innerText());
  check('D8 recall-first: the question shows alone with a recall box', (await exists(page, '#recall-input')) && (await page.locator('#options-container .option-card').count()) === 0);
  check('D9 reminder hidden during the quiz', !(await btn(page).isVisible()));
  check('D10 no page errors', errors.length === 0, errors.join('|'));
  await page.close();
}

{
  const { page, errors, dueIn } = await open('due');
  await btn(page).click(); await page.waitForTimeout(200);
  await page.locator('li[data-chapter="chapter-0"] .review-pick-btn').click(); await page.waitForTimeout(200);
  await page.locator('li[data-chapter="chapter-0"] .review-pick-input').fill('1'); await page.keyboard.press('Enter'); await page.waitForTimeout(900);
  check('P1 typing 1 + Enter runs 1 question', dueIn[0]?.limit === 1 && /·\s*1 due/i.test(await page.locator('#quiz-scope-label').innerText()), JSON.stringify(dueIn));
  check('P2 no page errors', errors.length === 0, errors.join('|'));
  await page.close();
}
{
  const { page, dueIn } = await open('due');
  await btn(page).click(); await page.waitForTimeout(200);
  await page.locator('li[data-chapter="chapter-0"] .review-pick-btn').click(); await page.waitForTimeout(200);
  await page.screenshot({ path: '/var/tmp/review-reminder-pick.png' });
  await page.locator('li[data-chapter="chapter-0"] .review-pick-start').click(); await page.waitForTimeout(900);
  check('P3 blank field runs the whole chapter (2)', dueIn[0]?.limit === 2, JSON.stringify(dueIn));
  await page.close();
}

// ---- C. the reader's chat button: the glyph's drawn box is centred in the circle (01-11-26) ----------
{
  const { page, errors } = await open('due');
  await page.locator('#nav-learn').click(); await page.waitForTimeout(600);
  const m = await page.evaluate(() => {
    const fab = document.querySelector('#ask-fab'); const svg = fab?.querySelector('svg'); if (!fab || !svg) return null;
    const f = fab.getBoundingClientRect(); const g = svg.getBBox(); const ctm = svg.getScreenCTM();
    const cx = ctm.a * (g.x + g.width / 2) + ctm.e, cy = ctm.d * (g.y + g.height / 2) + ctm.f;
    return { dx: +(cx - (f.left + f.width / 2)).toFixed(2), dy: +(cy - (f.top + f.height / 2)).toFixed(2) };
  });
  check('C1 chat glyph centred in its button (<= 0.5 px both axes)', Boolean(m) && Math.abs(m.dx) <= 0.5 && Math.abs(m.dy) <= 0.5, JSON.stringify(m));
  await page.locator('#ask-fab').screenshot({ path: '/var/tmp/review-reminder-chatfab.png' });
  check('C2 no page errors', errors.length === 0, errors.join('|'));
  await page.close();
}

// ---- 2. nothing due / server failing -------------------------------------------------------------------
{
  const { page, errors } = await open('empty');
  check('E1 nothing due: button shows, no badge', (await btn(page).isVisible()) && !(await exists(page, '#review-reminder-badge')));
  check('E2 nothing due: no motion', (await anim(page)) === 'none', await anim(page));
  await page.screenshot({ path: '/var/tmp/review-reminder-done.png' });
  await btn(page).click(); await page.waitForTimeout(200);
  check('E3 nothing due: panel says all reviewed, no Start button', /all reviewed/i.test(await page.locator('#review-reminder-panel').innerText()) && !(await exists(page, '#review-reminder-start')));
  check('E4 no page errors', errors.length === 0, errors.join('|'));
  await page.close();
}
{
  const { page, errors } = await open('down');
  check('F1 server 500: no reminder at all', !(await exists(page, '#review-reminder')));
  check('F2 no page errors', errors.length === 0, errors.join('|'));
  await page.close();
}
await browser.close(); server.close();
const bad = results.filter((r) => !r).length;
console.log(`\n${results.length - bad}/${results.length} passed`);
process.exit(bad ? 1 : 0);
