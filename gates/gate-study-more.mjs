#!/usr/bin/env node
/**
 * gate-study-more.mjs — G5, exam-recall-suite P1 (22-10-26): Stats row, session size, new-card cap,
 * flags, confidence-before-reveal, leech tag, AI-question enrolment, in a real browser.
 *
 * Tier 1/2, browser: the REAL built bundle (app/frontend/dist) with the API stubbed in the browser:
 *     cd app/frontend && ./node_modules/.bin/vite build && node ../../gates/gate-study-more.mjs
 * Env: SM_DIST (another build, for fault injection), SM_SHOTS (screenshots, default /var/tmp/p1c-shots).
 * Proves: the Practice dialog's Stats row is collapsed, then shows the server's numbers; Per review
 * clamps 10..50 in steps of 5 and saves; New / day saves; "Flagged (N)" appears; a review run shows
 * Sure / Unsure / Guess BEFORE any option and one tap reveals them; the answer is logged with that
 * confidence; an AI card is rebuilt from its stored body and tagged Leech (lapses >= 6); the flag
 * toggles with a visible "Flagged" / "Unflagged" (and "Not saved" + rollback on a failed save); an
 * ordinary run shows no confidence row; an AI-written question enrols WITH its body under the key
 * sha1-derived exactly like the server's; and nothing scrolls sideways at 390 / 834 / 1440.
 * Fails when: the confidence row is hidden or shown in an ordinary run, AI enrolment is skipped or the
 * key differs from the server's formula, the size picker does not clamp, a flag press is silent,
 * a new control is under 44 px, or a viewport scrolls sideways.
 * ⛔ Mutation-checked when written (see the README row).
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIST = process.env.SM_DIST || resolve(fileURLToPath(new URL('.', import.meta.url)), '../app/frontend/dist');
const SHOTS = process.env.SM_SHOTS || '/var/tmp/p1c-shots';
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

// The server's formula (store.ai_review_key), computed with node's own sha1 — NOT the bundle's.
const aiKey = (q) => `ai-${createHash('sha1').update(`${q.question.trim()}\n${q.options.map((o) => String(o).trim()).join('\n')}`, 'utf8').digest('hex').slice(0, 12)}`;
const mk = (q, options, correct, n) => ({ question: q, options, correct, explanations: options.map((o) => `Why ${o}.`), source: { chapter: 1, block: 'ch01-b01', question: `ch01-b01-q${n}` } });
const module_ = {
  moduleId: 'geron-homl3',
  tutorialData: { title: 'Test book', sections: [{ title: 'Chapter 1: Test', themeColor: 'indigo-500', items: [{ term: 'Lesson one', blocks: [{ type: 'text', content: 'Hello.' }] }] }] },
  quizData: [mk('Q1 single', ['A1', 'B1', 'C1', 'D1'], 0, 1), mk('Q2 single', ['A2', 'B2', 'C2', 'D2'], 2, 2), mk('Q3 choose two', ['A3', 'B3', 'C3', 'D3', 'E3'], [1, 3], 3)],
};
// A stored AI card (body only — no book holds it). Non-ASCII on purpose: the key hashes UTF-8 bytes.
const AI_BODY = { question: 'Gradient descent — which step size diverges?', options: ['Very large η', 'Tiny η', 'Adaptive η', 'Zero'], correct: 0, explanations: null };
const AI_CARD_KEY = aiKey(AI_BODY);
const FRESH = [
  { question: 'AI Q1: what does PCA keep?', options: ['Max variance', 'Min variance', 'Labels', 'Nothing'], correct: 0, explanations: ['Yes.', 'No.', 'No.', 'No.'] },
  { question: 'AI Q2: pick the two ensembles', options: ['Bagging', 'PCA', 'Boosting', 'k-means', 'SVD'], correct: [0, 2], explanations: null },
];
const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
const browser = await chromium.launch({ executablePath: process.env.GATE_CHROME || chromium.executablePath() });

async function open({ width = 1366, height = 768, flagFail = false } = {}) {
  const posts = { seen: [], grade: [], answers: [], flags: [], prefs: [] };
  const gets = { due: [] };
  let flagged = [{ question: 'ch01-b01-q3', flaggedAt: '2026-10-22T01:00:00Z' }];
  const page = await (await browser.newContext({ viewport: { width, height } })).newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(String(e).slice(0, 160)));
  const native = []; page.on('dialog', (d) => { native.push(d.type()); void d.dismiss(); });
  await page.route('**/api/**', (route) => {
    const u = new URL(route.request().url()); const m = route.request().method();
    const body = () => JSON.parse(route.request().postData() || '{}');
    if (u.pathname === '/api/auth/me') return json(route, { account: { id: 1, username: 't', displayName: 'T', isOwner: true } });
    if (u.pathname === '/api/modules') return json(route, { books: [{ file: 'geron-homl3', book: 'geron-homl3', base: 'book/geron-homl3/', moduleId: 'geron-homl3', title: 'Test book', chapters: 1, lessons: 1, questions: 3, default: true }] });
    if (u.pathname === '/api/review/seen' && m === 'POST') { posts.seen.push(body()); return json(route, { outcome: 'created' }); }
    if (u.pathname === '/api/review/grade' && m === 'POST') { posts.grade.push(body()); return json(route, { question: 'x' }); }
    if (u.pathname === '/api/review/due') {
      gets.due.push(u.searchParams.get('limit'));
      return json(route, { due: [
        { question: 'ch01-b01-q2', dueAt: 'x', reps: 1, lapses: 0 },
        { question: AI_CARD_KEY, dueAt: 'x', reps: 0, lapses: 7, leech: true, body: AI_BODY },
        { question: 'ch01-b01-q1', dueAt: 'x', reps: 1, lapses: 1 },
      ], dueCount: 3, total: 214 });
    }
    if (u.pathname === '/api/review/stats') return json(route, { module: 'geron-homl3', dueNow: 3, dueToday: 12, next7: [1, 0, 4, 2, 0, 0, 3].map((count, i) => ({ day: `2026-10-${23 + i}`, count })), next7Total: 10, total: 214, leeches: 3, leechKeys: [], newToday: 4, newPerDay: 20, sessionSize: 25, retention: 82, reviews30: 40, retentionDays: 30 });
    if (u.pathname === '/api/study/prefs' && m === 'GET') return json(route, { module: 'geron-homl3', newPerDay: 20, sessionSize: 25 });
    if (u.pathname === '/api/study/prefs' && m === 'POST') { posts.prefs.push(body()); return json(route, { module: 'geron-homl3', newPerDay: 20, sessionSize: 25, ...body() }); }
    if (u.pathname === '/api/flags' && m === 'GET') return json(route, { module: 'geron-homl3', flags: flagged, count: flagged.length });
    if (u.pathname === '/api/flags' && m === 'POST') {
      const b = body(); posts.flags.push(b);
      if (flagFail) return json(route, { error: 'no' }, 500);
      flagged = b.flagged ? [...flagged.filter((f) => f.question !== b.question), { question: b.question }] : flagged.filter((f) => f.question !== b.question);
      return json(route, { question: b.question, flagged: b.flagged });
    }
    if (u.pathname === '/api/answers' && m === 'POST') { posts.answers.push(body()); return json(route, { outcome: 'logged' }, 201); }
    if (u.pathname === '/api/quiz/fresh' && m === 'POST') return json(route, { questions: FRESH });
    if (u.pathname === '/api/progress') return json(route, { module: 'geron-homl3', completed: {} });
    if (u.pathname === '/api/general') return json(route, { ai_question_count: 5, fresh_quiz_size: 10 });
    if (u.pathname === '/api/provider') return json(route, { ready: true, model: 'stub-model', token_required: false });
    return json(route, {});
  });
  await page.route('**/book/geron-homl3/module.json', (route) => json(route, module_));
  await page.goto(BASE, { waitUntil: 'networkidle' }); await page.waitForTimeout(800);
  return { page, posts, gets, errors, native };
}
const cards = (page) => page.locator('#options-container .option-card');
const exists = (page, sel) => page.locator(sel).count().then((n) => n > 0);
const visible = (page, sel) => page.locator(sel).first().isVisible().catch(() => false);
const text = (page, sel) => page.locator(sel).first().innerText().catch(() => '');
// textContent, not innerText: the status line is CSS-uppercased (and sr-only on a phone).
const raw = (page, sel) => page.locator(sel).first().evaluate((e) => e.textContent.trim()).catch(() => '');
// On a phone the nav sits behind the menu button.
const nav = async (page, id) => { if (!(await page.locator(id).isVisible())) { await page.locator('#menu-btn').click(); await page.waitForTimeout(300); } await page.locator(id).click(); };
const questionText = (page) => page.evaluate(() => { const v = document.querySelector('#question-text rich-text-viewer'); return v && v.shadowRoot ? v.shadowRoot.textContent : document.querySelector('#question-text')?.textContent || ''; });
// How far anything OUTSIDE the site header sticks out past the right edge (<= 0 = fits).
// ⚠ The header itself overflows by 177 px at 834 px BEFORE P1 (#nav-qna / #nav-live; measured on the
//   committed build 22-10-26, also noted in the chat-dock report) — a pre-existing defect this gate
//   reports on its own line (W-hdr) but does not count against P1.
const sideways = (page) => page.evaluate(() => Math.max(-1, ...[...document.querySelectorAll('body *')].filter((e) => !e.closest('header') && e.getClientRects().length).map((e) => Math.round(e.getBoundingClientRect().right - window.innerWidth))));
const headerOver = (page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
const minBox = (page, sel) => page.$$eval(sel, (els) => els.filter((e) => e.getClientRects().length).map((e) => { const r = e.getBoundingClientRect(); return Math.min(Math.round(r.width), Math.round(r.height)); }));
const uuidLike = (s) => /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(String(s));

// ---- 1. the Practice dialog: Stats, Per review, New / day, Flagged (N) ----------------------------
{
  const { page, posts, gets, errors } = await open();
  await nav(page, '#nav-quiz'); await page.waitForTimeout(700);
  check('D1 Stats row is there and collapsed (numbers hidden until opened)', (await visible(page, '#review-stats summary')) && !(await visible(page, '#stats-due-today')) && /12 due today/.test(await text(page, '#review-stats summary')), await text(page, '#review-stats summary'));
  await page.locator('#review-stats summary').click(); await page.waitForTimeout(300);
  const nums = { due: await text(page, '#stats-due-today'), next7: await text(page, '#stats-next7'), ret: await text(page, '#stats-retention'), total: await text(page, '#stats-total'), leech: await text(page, '#stats-leeches') };
  check('D2 opened: due today 12 · next 7 days 10 · retention 82% · cards 214 · leeches 3', nums.due === '12' && nums.next7 === '10' && nums.ret === '82%' && nums.total === '214' && nums.leech === '3', JSON.stringify(nums));
  check('D3 the leech line explains the word', /Leech = missed 6\+ times/.test(await text(page, '#review-stats')));
  check('D4 Per review starts at the saved size (25)', (await text(page, '#session-size-value')) === '25', await text(page, '#session-size-value'));
  const more = page.locator('#session-size button[aria-label="More cards per review"]'); const fewer = page.locator('#session-size button[aria-label="Fewer cards per review"]');
  for (let i = 0; i < 9; i += 1) if (await more.isEnabled()) await more.click();
  check('D5 Per review stops at 50 and + is disabled', (await text(page, '#session-size-value')) === '50' && !(await more.isEnabled()), await text(page, '#session-size-value'));
  for (let i = 0; i < 12; i += 1) if (await fewer.isEnabled()) await fewer.click();
  check('D6 Per review stops at 10 and − is disabled', (await text(page, '#session-size-value')) === '10' && !(await fewer.isEnabled()), await text(page, '#session-size-value'));
  await page.locator('#new-per-day button[aria-label="More new cards per day"]').click();
  await page.waitForTimeout(1100);
  const last = posts.prefs.at(-1) || {};
  check('D7 one debounced save carries size 10 and New / day 25', posts.prefs.length >= 1 && last.sessionSize === 10 && last.newPerDay === 25 && last.module === 'geron-homl3', `${posts.prefs.length} posts, last ${JSON.stringify(last)}`);
  check('D8 the due list is re-read with the run size (limit=10)', gets.due.includes('10'), gets.due.join(','));
  check('D9 Flagged (1) offered', /flagged \(1\)/i.test(await text(page, '#setup-flagged-btn')), await text(page, '#setup-flagged-btn'));
  const boxes = await minBox(page, '#review-stats summary, #session-size button, #new-per-day button, #setup-flagged-btn, #setup-review-btn');
  check('D10 every new control is at least 44 px', boxes.length >= 7 && boxes.every((n) => n >= 44), boxes.join(','));
  check('D11 no page errors', errors.length === 0, errors.join('|'));
  await page.close();
}

// ---- 2. a review run: confidence first, leech, flag --------------------------------------------------
{
  const { page, posts, errors, native } = await open();
  await nav(page, '#nav-quiz'); await page.waitForTimeout(600);
  await page.locator('#setup-review-btn').click(); await page.waitForTimeout(900);
  check('V1 recall-first: no option yet, Sure / Unsure / Guess shown', (await cards(page).count()) === 0 && (await visible(page, '#confidence-sure-btn')) && (await visible(page, '#confidence-unsure-btn')) && (await visible(page, '#confidence-guess-btn')));
  const cb = await minBox(page, '#confidence-row button');
  check('V2 the three confidence buttons are at least 44 px', cb.length === 3 && cb.every((n) => n >= 44), cb.join(','));
  check('V3 a card with 0 lapses has no Leech tag', !(await exists(page, '#leech-tag')));
  await page.locator('#confidence-guess-btn').click(); await page.waitForTimeout(300);
  check('V4 one tap on Guess shows the options and removes the row', (await cards(page).count()) === 4 && !(await exists(page, '#confidence-row')));
  await cards(page).nth(0).click(); await page.waitForTimeout(400);             // Q2: A2 is wrong
  const a = posts.answers[0] || {};
  check('V5 the answer is logged with confidence guess, run review, a fresh uuid', posts.answers.length === 1 && a.question === 'ch01-b01-q2' && a.runKind === 'review' && a.confidence === 'guess' && a.correct === false && a.chosen === 0 && uuidLike(a.clientId), JSON.stringify(a));
  check('V6 the review grade still goes out (again)', posts.grade.length === 1 && posts.grade[0].grade === 'again');
  await page.locator('#next-btn').click(); await page.waitForTimeout(500);
  check('V7 the AI card is rebuilt from its stored body', (await questionText(page)).includes('which step size diverges'), (await questionText(page)).slice(0, 60));
  check('V8 lapses 7 -> the Leech tag shows', await visible(page, '#leech-tag'));
  check('V9 flag starts off (aria-pressed=false)', (await page.locator('#flag-btn').getAttribute('aria-pressed')) === 'false');
  await page.locator('#flag-btn').click(); await page.waitForTimeout(400);
  const f = posts.flags[0] || {};
  check('V10 flag on: sends the AI key (server formula) + its body; pressed; says Flagged', f.question === AI_CARD_KEY && f.flagged === true && f.body?.question === AI_BODY.question && (await page.locator('#flag-btn').getAttribute('aria-pressed')) === 'true' && (await raw(page, '#flag-status')) === 'Flagged', `${JSON.stringify({ q: f.question, want: AI_CARD_KEY })} status=${await raw(page, '#flag-status')}`);
  await page.locator('#flag-btn').click(); await page.waitForTimeout(400);
  check('V11 flag off: flagged:false, not pressed, says Unflagged', posts.flags[1]?.flagged === false && (await page.locator('#flag-btn').getAttribute('aria-pressed')) === 'false' && (await raw(page, '#flag-status')) === 'Unflagged', await raw(page, '#flag-status'));
  await page.locator('#confidence-sure-btn').click(); await page.waitForTimeout(300);
  await cards(page).nth(0).click(); await page.waitForTimeout(400);             // AI card: very large η is right
  const a2 = posts.answers[1] || {};
  check('V12 the AI card answer is logged under its key with confidence sure', a2.question === AI_CARD_KEY && a2.confidence === 'sure' && a2.correct === true, JSON.stringify(a2));
  check('V13 a review run enrols nothing; no native dialog; no page errors', posts.seen.length === 0 && native.length === 0 && errors.length === 0, `seen=${posts.seen.length} native=${native.join(',')} ${errors.join('|')}`);
  await page.close();
}

// ---- 3. an ordinary run + an AI-written run --------------------------------------------------------
{
  const { page, posts, errors } = await open();
  await nav(page, '#nav-quiz'); await page.waitForTimeout(500);
  await page.locator('#setup-all-btn').click(); await page.locator('#setup-start-btn').click(); await page.waitForTimeout(800);
  check('O1 ordinary run: options at once, no confidence row', (await cards(page).count()) === 4 && !(await exists(page, '#confidence-row')));
  await cards(page).nth(0).click(); await page.waitForTimeout(400);
  const o = posts.answers[0] || {};
  check('O2 logged as practice, no confidence; enrolment unchanged (book key, no body)', o.runKind === 'practice' && o.confidence === null && o.question === 'ch01-b01-q1' && posts.seen[0]?.question === 'ch01-b01-q1' && posts.seen[0]?.body === undefined, `${JSON.stringify(o)} ${JSON.stringify(posts.seen[0])}`);
  await nav(page, '#nav-generated-quiz'); await page.waitForTimeout(600);
  await page.locator('#setup-all-btn').click(); await page.locator('#setup-start-btn').click(); await page.waitForTimeout(1200);
  check('O3 the AI quiz shows its first question', (await questionText(page)).includes('what does PCA keep'), (await questionText(page)).slice(0, 50));
  await cards(page).nth(0).click(); await page.waitForTimeout(400);
  const s = posts.seen.at(-1) || {};
  check('O4 an AI question is enrolled WITH its body', s.body?.question === FRESH[0].question && Array.isArray(s.body?.options) && s.body.options.length === 4 && s.body.correct === 0 && s.correct === true, JSON.stringify(s).slice(0, 160));
  check('O5 ...under the server formula key (sha1 of question + options)', s.question === aiKey(FRESH[0]), `${s.question} vs ${aiKey(FRESH[0])}`);
  const l = posts.answers.at(-1) || {};
  check('O6 logged as quiz under the same key', l.runKind === 'quiz' && l.question === aiKey(FRESH[0]), JSON.stringify(l));
  check('O7 no page errors', errors.length === 0, errors.join('|'));
  await page.close();
}

// ---- 4. a failed flag save is not silent ----------------------------------------------------------
{
  const { page, posts, errors } = await open({ flagFail: true });
  await nav(page, '#nav-quiz'); await page.waitForTimeout(500);
  await page.locator('#setup-all-btn').click(); await page.locator('#setup-start-btn').click(); await page.waitForTimeout(800);
  await page.locator('#flag-btn').click(); await page.waitForTimeout(500);
  check('F1 server 500: says Not saved and rolls the flag back', posts.flags.length === 1 && (await raw(page, '#flag-status')) === 'Not saved' && (await page.locator('#flag-btn').getAttribute('aria-pressed')) === 'false', await raw(page, '#flag-status'));
  check('F2 no page errors', errors.length === 0, errors.join('|'));
  await page.close();
}

// ---- 5. three widths: no sideways scroll; screenshots -------------------------------------------------
for (const [w, h] of [[390, 844], [834, 1112], [1440, 900]]) {
  const { page, errors } = await open({ width: w, height: h });
  await nav(page, '#nav-quiz'); await page.waitForTimeout(600);
  await page.locator('#review-stats summary').click(); await page.waitForTimeout(300);
  const d = await sideways(page);
  await page.screenshot({ path: `${SHOTS}/practice-${w}.png`, fullPage: true });
  await page.locator('#setup-review-btn').click(); await page.waitForTimeout(900);
  const r = await sideways(page);
  const clipped = await page.locator('#quiz-scope-label').evaluate((e) => e.scrollWidth > e.clientWidth);
  await page.screenshot({ path: `${SHOTS}/review-confidence-${w}.png`, fullPage: false });
  await page.locator('#confidence-unsure-btn').click(); await cards(page).nth(0).click(); await page.locator('#next-btn').click(); await page.waitForTimeout(500);
  await page.locator('#flag-btn').click(); await page.waitForTimeout(300);
  const q = await sideways(page);
  const fb = await minBox(page, '#flag-btn');
  await page.screenshot({ path: `${SHOTS}/review-leech-flag-${w}.png`, fullPage: false });
  const hdr = await headerOver(page);
  console.log(`INFO  W-hdr ${w}px  whole-page overflow ${hdr} px${hdr > 0 ? ' (the pre-existing header nav defect, not P1)' : ''}`);
  check(`W ${w}px: nothing outside the header sticks out (dialog / review / flagged leech card); flag button >= 44 px; header scope label not clipped`, d <= 0 && r <= 0 && q <= 0 && fb[0] >= 44 && !clipped && errors.length === 0, `overflow ${d}/${r}/${q} flag ${fb[0]} scope-label-clipped=${clipped} ${errors.join('|')}`);
  await page.close();
}

await browser.close(); server.close();
const bad = results.filter((r) => !r).length;
console.log(`\n${results.length - bad}/${results.length} passed · screenshots in ${SHOTS}`);
process.exit(bad ? 1 : 0);
