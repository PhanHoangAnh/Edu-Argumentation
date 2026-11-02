#!/usr/bin/env node
/**
 * gate-exam.mjs — G9, exam-recall-suite P3 (22-10-26): the timed mock exam in a REAL browser, on the BUILT
 * app, against the REAL backend + the ISOLATED gate DB (edu_study_gate), signed in as a throwaway account.
 * Tier 1/2. Nothing is stubbed: every number on screen comes from addons/exam.py.
 *
 * Stage (unless GATE_BASE + EXAM_TOKEN are given): spawns `gates/stubs/exam_fixture.py serve` with the
 * test venv — a COPY of app/backend + the built dist (EXAM_WEB, default app/frontend/dist) under
 * /var/tmp/p3c-exam-stage, the 2 fixture books (gate-exam-book WITH an `exam` block, gate-noexam-book
 * without), `admin migrate --no-backup` on the gate DB, one throwaway account (deleted at the end).
 *
 *   A  1440 · book WITH the block: the Practice dialog's Exam row shows the book's facts read-only
 *      (GATE-CLF · 65 q · 90 min, no steppers, "estimate" in the help line).
 *   B  Start -> "Question 1 of 65", the clock from the server (~90:00), answer (saved on the server),
 *      Flag (aria-pressed + navigator chip flag + server flags), navigator: click jumps, keyboard
 *      (Arrow / Home / End move focus, Enter jumps), every chip says its state in words.
 *   C  RELOAD mid-exam: the page comes back on the book; Practice -> Resume reopens the SAME run (same
 *      id, the 2 answers, the flag) and the clock reads the SERVER's remaining time (+/- 3 s).
 *   D  Leave via a header tab -> the APP dialog "Leave exam?" (no native dialog); Stay keeps the exam;
 *      Leave goes; the run stays open on the server.
 *   K  the browser Back button during an exam: the app leaves the exam screen without asking (it is a
 *      route change, not a header tab); the run is NOT corrupted — still open, same answers/flags,
 *      Resume brings it back.
 *   S  Submit -> app dialog "63 unanswered · 1 flagged." -> result: Raw 1 / 65 (2%), "Estimate 114 / 1000
 *      · pass 700 · Below pass" + the "Estimate only" note, 4 domain bars with number text, 64 missed
 *      (1 Wrong, 63 Skipped), Retry missed (64).
 *   P  834 · book WITHOUT the block: "Practice exam", editable Questions 30 / Minutes 60 labelled as
 *      defaults; set 5 q; answer 3 right / 2 wrong; result Raw 3 / 5, NO Estimate, NO pass/fail;
 *      Retry missed (2) -> only the 2 missed, the result keeps the ORIGINAL total ("5 / 5", never "2 / 2").
 *   T  390 · a REAL 1-minute run: Resume shows < 1 min; reload -> Resume -> the clock continued; at 0:00
 *      it submits on its own -> the result (server finishedBy "deadline").
 *   L  every width: no sideways scroll outside <header>, every visible exam button >= 44 px tall (chips
 *      44 x 44), the position line on one line, no console error, no 5xx, NEVER a native dialog.
 *
 * Run:  node gates/gate-exam.mjs           (needs Playwright: gates/node_modules -> /var/tmp/edu-verify/node_modules)
 * Env:  EXAM_WEB (built dist to stage), EXAM_PY (default /var/tmp/edu-study-testvenv/bin/python3),
 *       EXAM_PORT (8788), EXAM_SHOTS (default /var/tmp/p3c-exam-shots), GATE_BASE + EXAM_TOKEN (use a running stage).
 * Fails when (red proofs, gates/README.md): the leave guard uses window.confirm (D: native dialog);
 *   the result shows an Estimate without the block (P); Retry missed recounts the total (P: "2 / 2");
 *   the timer counts from the device clock instead of the server's deadline (C).
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');
const SHOTS = process.env.EXAM_SHOTS || '/var/tmp/p3c-exam-shots';
fs.mkdirSync(SHOTS, { recursive: true });
const EX = 'gate-exam-book';
const NO = 'gate-noexam-book';
const CHOOSE_N = { 'ch01-b01-q1': [0, 2], 'ch01-b01-q2': [1, 3] };      // = exam_fixture.py
const correctOf = (key) => CHOOSE_N[key] ? [...CHOOSE_N[key]] : Number(/q(\d+)$/.exec(key)[1]) % 4;
const wrongOf = (key) => { const c = correctOf(key); return Array.isArray(c) ? [0, 1] : (c + 1) % 4; };

const results = [];
const check = (id, pass, detail = '') => { results.push(Boolean(pass)); console.log(`${pass ? 'PASS' : 'FAIL'}  ${id}${detail ? '  ' + detail : ''}`); };

// ------------------------------------------------------------------------------------------- stage
let BASE = process.env.GATE_BASE || '';
let TOKEN = process.env.EXAM_TOKEN || '';
let stage = null;
if (!BASE || !TOKEN) {
  const py = process.env.EXAM_PY || '/var/tmp/edu-study-testvenv/bin/python3';
  const args = [path.join(REPO, 'gates/stubs/exam_fixture.py'), 'serve', '--port', process.env.EXAM_PORT || '8788'];
  if (process.env.EXAM_WEB) args.push('--web', process.env.EXAM_WEB);
  stage = spawn(py, args, { cwd: REPO, stdio: ['pipe', 'pipe', 'inherit'] });
  const ready = await new Promise((resolve, reject) => {
    let buf = '';
    const t = setTimeout(() => reject(new Error('stage did not start in 90 s')), 90_000);
    stage.stdout.on('data', (d) => {
      buf += d;
      const m = /READY (\{.*\})/.exec(buf);
      if (m) { clearTimeout(t); resolve(JSON.parse(m[1])); }
    });
    stage.on('exit', (code) => reject(new Error(`stage exited ${code}`)));
  });
  BASE = ready.base; TOKEN = ready.token;
  console.log(`INFO stage ${BASE} account ${ready.user} (${ready.migrate.join(' ')})`);
}
const host = new URL(BASE).hostname;
const browser = await chromium.launch();
const native = [];          // every native dialog, any page — must stay empty
const bad = [];             // 5xx on /api/
const errors = [];          // console errors / page errors (404s of book art listed apart)
const missing = [];

async function newPage(width, height = 900) {
  const ctx = await browser.newContext({ viewport: { width, height } });
  await ctx.addCookies([{ name: 'edu_session', value: TOKEN, domain: host, path: '/' }]);
  const page = await ctx.newPage();
  page.on('dialog', (d) => { native.push(`${width}:${d.type()}:${d.message()}`); void d.dismiss(); });
  page.on('pageerror', (e) => errors.push(`${width}: ${String(e).slice(0, 140)}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(`${width}: ${m.text().slice(0, 140)}`); });
  page.on('response', (r) => {
    if (r.status() >= 500 && r.url().includes('/api/')) bad.push(`${r.status()} ${r.url()}`);
    if (r.status() === 404) missing.push(new URL(r.url()).pathname);
  });
  return { ctx, page };
}

const api = async (page, method, route, body) => {
  const r = method === 'GET' ? await page.request.get(BASE + route) : await page.request.post(BASE + route, { data: body, headers: { Origin: BASE } });
  return { status: r.status(), body: await r.json().catch(() => ({})) };
};
const examOpen = async (page, mod) => (await api(page, 'GET', `/api/exam/open?module=${mod}`)).body;
/** A rerun on a reused stage: submit any run left open by an earlier (aborted) run of this gate. */
const closeOpen = async (page, mod) => { const o = await examOpen(page, mod); if (o.run) await api(page, 'POST', '/api/exam/finish', { runId: o.run.id }); };
const vis = (page, sel) => page.locator(sel).first().isVisible().catch(() => false);
// <rich-text-viewer> renders into a shadow root; its `content` attribute holds the (URI-encoded) text.
const curKey = async (page) => (/\((ch\d+-b\d+-q\d+)\)/.exec(decodeURIComponent(await page.locator('#question-text rich-text-viewer').first().getAttribute('content') || '')) || [])[1];
const position = async (page) => (await page.locator('#exam-position').innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
const navTo = async (page, id) => {
  if (!(await vis(page, id))) { await page.locator('#menu-btn').click(); await page.waitForTimeout(300); }
  await page.locator(id).click();
};
async function openPractice(page) {
  await navTo(page, '#nav-quiz');
  await page.waitForSelector('#exam-row', { timeout: 15_000 });
  await page.waitForTimeout(400);
}
async function examAnswer(page, choice) {
  const picks = Array.isArray(choice) ? choice : [choice];
  for (const i of picks) {
    await page.locator('#options-container .option-card').nth(i).click();
    await page.waitForFunction(() => /Saved/.test(document.querySelector('#exam-status')?.textContent || ''), null, { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(150);
  }
}
/** The visible clock in seconds ("1:29:58" / "0:41"). */
const clockSeconds = async (page) => {
  const t = (await page.locator('#exam-timer').innerText()).replace(/[^\d:]/g, '');
  return t.split(':').map(Number).reduce((a, n) => a * 60 + n, 0);
};
async function layout(page, width, tag) {
  const L = await page.evaluate(() => {
    const over = Math.max(-1, ...[...document.querySelectorAll('body *')].filter((e) => !e.closest('header') && e.getClientRects().length)
      .map((e) => Math.round(e.getBoundingClientRect().right - window.innerWidth)));
    const root = document.querySelector('#exam-run') || document.querySelector('#exam-result') || document;
    const small = [...root.querySelectorAll('button')].filter((b) => b.getClientRects().length && b.offsetParent)
      .map((b) => ({ id: b.id || b.getAttribute('aria-label') || b.textContent.trim().slice(0, 20), h: Math.round(b.getBoundingClientRect().height), w: Math.round(b.getBoundingClientRect().width) }))
      .filter((b) => b.h < 44 || (b.id.startsWith('Question') && b.w < 44));
    const pos = document.querySelector('#exam-position');
    const lh = pos ? parseFloat(getComputedStyle(pos).lineHeight) || 28 : 0;
    return { over, small, posLines: pos ? Math.round(pos.getBoundingClientRect().height / lh) : 0 };
  });
  check(`L ${width} ${tag}: no sideways scroll outside the header, buttons >= 44 px, position on one line`, L.over <= 0 && !L.small.length && L.posLines <= 1,
    `over ${L.over} small ${JSON.stringify(L.small.slice(0, 4))} lines ${L.posLines}`);
}

try {
  // ================================================================== A-S: 1440, book WITH the block
  {
    const W = 1440;
    const { ctx, page } = await newPage(W);
    await page.goto(`${BASE}/${EX}/`, { waitUntil: 'networkidle' });
    await closeOpen(page, EX); await closeOpen(page, NO);
    await page.locator('#read-tutorial-btn').click();            // a lesson route, so Back has somewhere in-app to go
    await page.waitForTimeout(800);
    await openPractice(page);
    const row = (await page.locator('#exam-row').innerText()).replace(/\s+/g, ' ');
    check('A1 Exam row (block): "Exam · GATE-CLF · 65 q · 90 min", read-only (no steppers), help says the scaled score is an estimate',
      /^Exam\b/.test(row) && /GATE-CLF · 65 q · 90 min/.test(row) && (await page.locator('#exam-questions').count()) === 0 && /estimate/i.test(row), row);
    await page.locator('#exam-row').screenshot({ path: `${SHOTS}/exam-row-block-${W}.png` });
    await page.locator('#exam-start-btn').click();
    await page.waitForSelector('#exam-run', { timeout: 15_000 });
    const runId = await page.locator('#exam-run').getAttribute('data-run');
    const srv0 = await examOpen(page, EX);
    const secs0 = await clockSeconds(page);
    check('B1 Start -> "Question 1 of 65", run id = the server\'s open run, clock ~90:00 from the server', (await position(page)) === 'Question 1 of 65'
      && srv0.run?.id === runId && Math.abs(secs0 - srv0.run.remainingSeconds) <= 3 && secs0 > 5390, `${await position(page)} ${secs0}s vs server ${srv0.run?.remainingSeconds}s`);
    const k1 = await curKey(page);
    await examAnswer(page, correctOf(k1));
    await page.locator('#exam-next-btn').click(); await page.waitForTimeout(250);
    const k2 = await curKey(page);
    await examAnswer(page, wrongOf(k2));
    await page.locator('#exam-flag-btn').click();
    await page.waitForFunction(() => /Flagged/.test(document.querySelector('#exam-status')?.textContent || ''), null, { timeout: 6000 }).catch(() => {});
    const srv1 = await examOpen(page, EX);
    check('B2 two answers + a flag saved ON THE SERVER (answers {k1: right, k2: wrong}, flags [k2])', JSON.stringify(srv1.run?.answers?.[k1]) === JSON.stringify(correctOf(k1))
      && JSON.stringify(srv1.run?.answers?.[k2]) === JSON.stringify(wrongOf(k2)) && JSON.stringify(srv1.run?.flags) === JSON.stringify([k2]), JSON.stringify({ a: srv1.run?.answers, f: srv1.run?.flags }));
    check('B3 Flag button: aria-pressed true, label "Unflag question", status said Flagged', (await page.locator('#exam-flag-btn').getAttribute('aria-pressed')) === 'true'
      && (await page.locator('#exam-flag-btn').getAttribute('aria-label')) === 'Unflag question');
    const navOpen = (await page.locator('#exam-nav-toggle').getAttribute('aria-expanded')) === 'true';
    if (!navOpen) await page.locator('#exam-nav-toggle').click();
    const chip = (i) => page.locator(`#exam-nav-panel button[data-index="${i}"]`);
    const words = [await chip(0).getAttribute('aria-label'), await chip(1).getAttribute('aria-label'), await chip(2).getAttribute('aria-label')];
    check('B4 navigator: 65 chips; chip states in WORDS (answered / unanswered, flagged, current) + shape (data-state), not colour only',
      (await page.locator('#exam-nav-panel button[data-index]').count()) === 65 && words[0] === 'Question 1, answered' && words[1] === 'Question 2, answered, flagged, current'
      && words[2] === 'Question 3, unanswered' && (await chip(1).getAttribute('data-flagged')) === 'true' && /2\/65 answered · 1 flagged/.test(await page.locator('#exam-nav-summary').innerText()), JSON.stringify(words));
    await chip(4).click(); await page.waitForTimeout(250);
    check('B5 navigator click jumps: chip 5 -> "Question 5 of 65"', (await position(page)) === 'Question 5 of 65', await position(page));
    await chip(0).focus(); await page.keyboard.press('ArrowRight');
    const f1 = await page.evaluate(() => document.activeElement?.dataset?.index);
    await page.keyboard.press('End');
    const f2 = await page.evaluate(() => document.activeElement?.dataset?.index);
    await page.keyboard.press('Home'); await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight'); await page.keyboard.press('Enter');
    await page.waitForTimeout(250);
    const focusRing = await page.evaluate(() => getComputedStyle(document.activeElement).boxShadow);
    check('B6 keyboard: ArrowRight -> chip 2, End -> chip 65, Home + 2 x ArrowRight + Enter -> "Question 3 of 65"; focus is visible (ring)',
      f1 === '1' && f2 === '64' && (await position(page)) === 'Question 3 of 65' && focusRing !== 'none', `${f1} ${f2} ${await position(page)} ring ${focusRing.slice(0, 40)}`);
    await page.screenshot({ path: `${SHOTS}/exam-run-${W}.png`, fullPage: true });
    await layout(page, W, 'exam run');

    // ---- C: reload mid-exam -> Resume = the same run, the server's time
    await page.reload({ waitUntil: 'networkidle' }); await page.waitForTimeout(800);
    const afterReload = { url: new URL(page.url()).pathname, exam: await vis(page, '#exam-run') };
    console.log(`INFO C reload lands on ${afterReload.url}, exam screen shown: ${afterReload.exam}`);
    await openPractice(page);
    const resumeShown = await vis(page, '#exam-resume-btn');
    const leftText = await page.locator('#exam-open-left').innerText().catch(() => '');
    await page.locator('#exam-resume-btn').click();
    await page.waitForSelector('#exam-run', { timeout: 10_000 });
    const srv2 = await examOpen(page, EX);
    const secs2 = await clockSeconds(page);
    const nav2 = await page.$$eval('#exam-nav-panel button[data-index]', (bs) => bs.slice(0, 2).map((b) => `${b.dataset.state}${b.dataset.flagged ? '+flag' : ''}`));
    check('C1 after a reload: Practice shows Resume + time left; Resume reopens the SAME run with its 2 answers and the flag', resumeShown && /minutes left/.test(leftText)
      && (await page.locator('#exam-run').getAttribute('data-run')) === runId && JSON.stringify(nav2) === '["answered","answered+flag"]', `${leftText} ${JSON.stringify(nav2)}`);
    check('C2 the clock after the reload = the SERVER\'s remaining time (+/- 3 s), lower than before', Math.abs(secs2 - srv2.run.remainingSeconds) <= 3 && secs2 < secs0,
      `${secs2}s vs server ${srv2.run.remainingSeconds}s (was ${secs0}s)`);

    // ---- D: leave via a header tab -> the app dialog
    await navTo(page, '#nav-account');
    await page.waitForSelector('#app-dialog', { timeout: 5000 }).catch(() => {});
    const dlg = { title: await page.locator('#app-dialog-title').innerText().catch(() => ''), body: await page.locator('#app-dialog-body').innerText().catch(() => '') };
    await page.locator('#app-dialog').screenshot({ path: `${SHOTS}/leave-dialog-${W}.png` }).catch(() => {});
    check('D1 header tab during the exam -> the APP dialog "Leave exam?" ("Timer keeps running"), no native dialog', dlg.title === 'Leave exam?' && /Timer keeps running/.test(dlg.body)
      && native.length === 0, `${dlg.title} | ${dlg.body} | native ${native.length}`);
    await page.locator('#app-dialog-cancel').click(); await page.waitForTimeout(300);
    check('D2 Stay -> still in the exam, same question', (await vis(page, '#exam-run')) && !(await vis(page, '#app-dialog')));
    await navTo(page, '#nav-account');
    await page.locator('#app-dialog-confirm').click(); await page.waitForTimeout(800);
    const srv3 = await examOpen(page, EX);
    check('D3 Leave -> the Account page; the run stays OPEN on the server (timer running)', !(await vis(page, '#exam-run')) && srv3.run?.id === runId && srv3.run.remainingSeconds > 0,
      new URL(page.url()).pathname);

    // ---- K: the browser Back button during an exam
    await openPractice(page);
    await page.locator('#exam-resume-btn').click();
    await page.waitForSelector('#exam-run', { timeout: 10_000 });
    const before = await examOpen(page, EX);
    await page.goBack(); await page.waitForTimeout(1200);
    const backState = { url: new URL(page.url()).pathname, exam: await vis(page, '#exam-run'), dialog: await vis(page, '#app-dialog') };
    const srv4 = await examOpen(page, EX);
    console.log(`INFO K Back during the exam -> ${backState.url}, exam screen ${backState.exam}, app dialog ${backState.dialog}`);
    check('K1 Back during the exam does NOT corrupt the run: still open, same id, same answers + flags, deadline unchanged', srv4.run?.id === runId
      && JSON.stringify(srv4.run.answers) === JSON.stringify(before.run.answers) && JSON.stringify(srv4.run.flags) === JSON.stringify(before.run.flags)
      && srv4.run.deadlineAt === before.run.deadlineAt && native.length === 0, JSON.stringify(backState));
    if (backState.exam) {
      check('K2 (Back stayed on the exam screen)', true);
    } else {
      await openPractice(page);
      await page.locator('#exam-resume-btn').click();
      await page.waitForSelector('#exam-run', { timeout: 10_000 });
      check('K2 after Back, Practice -> Resume brings the same run back', (await page.locator('#exam-run').getAttribute('data-run')) === runId);
    }

    // ---- S: submit -> result
    await page.locator('#exam-submit-btn').click();
    await page.waitForSelector('#app-dialog', { timeout: 5000 });
    const sub = { title: await page.locator('#app-dialog-title').innerText(), body: await page.locator('#app-dialog-body').innerText() };
    await page.locator('#app-dialog').screenshot({ path: `${SHOTS}/submit-dialog-${W}.png` });
    check('S1 Submit -> app dialog "Submit exam?" with "63 unanswered · 1 flagged."', sub.title === 'Submit exam?' && sub.body === '63 unanswered · 1 flagged.', JSON.stringify(sub));
    await page.locator('#app-dialog-confirm').click();
    await page.waitForSelector('#exam-result', { timeout: 15_000 });
    const raw = (await page.locator('#exam-raw').innerText()).replace(/\s+/g, ' ');
    const est = (await page.locator('#exam-estimate').innerText().catch(() => '')).replace(/\s+/g, ' ');
    const note = await page.locator('#exam-estimate-note').innerText().catch(() => '');
    check('S2 result: Raw "1 / 65 (2%)"; "Estimate 114 / 1000 pass 700 · Below pass" (linear, server\'s); the "Estimate only" note', raw === '1 / 65 (2%)'
      && /^Estimate 114 \/ 1000 pass 700 · Below pass$/i.test(est) && /Estimate only/.test(note), `${raw} | ${est} | ${note}`);
    const areas = await page.$$eval('#exam-areas > li', (ls) => ls.map((l) => l.innerText.replace(/\s+/g, ' ').trim()));
    check('S3 per-area: 4 domain rows, each with "% right/total" as TEXT (bar is decoration)', areas.length === 4 && /^Cloud Concepts/.test(areas[0])
      && areas.every((a) => /\d+% \d+\/(16|19|22|8)$/.test(a)), JSON.stringify(areas));
    const missedTags = await page.$$eval('#exam-missed > li > span:first-child', (ss) => ss.map((s) => s.textContent.trim()));
    check('S4 missed list: 64 (1 Wrong, 63 Skipped, shown as WORDS); "Retry missed (64)"', missedTags.length === 64 && missedTags.filter((t) => t === 'Wrong').length === 1
      && missedTags.filter((t) => t === 'Skipped').length === 63 && /Retry missed \(64\)/i.test(await page.locator('#exam-retry-missed-btn').innerText()));
    await page.screenshot({ path: `${SHOTS}/exam-result-block-${W}.png`, fullPage: true });
    await layout(page, W, 'result');
    const srv5 = await examOpen(page, EX);
    check('S5 server: run closed by submit, last = it', srv5.run === null && srv5.last?.id === runId && srv5.last.finishedBy === 'submit');
    await ctx.close();
  }

  // ================================================================== P: 834, book WITHOUT the block
  {
    const W = 834;
    const { ctx, page } = await newPage(W, 1112);
    await page.goto(`${BASE}/${NO}/`, { waitUntil: 'networkidle' });
    await openPractice(page);
    const row = (await page.locator('#exam-row').innerText()).replace(/\s+/g, ' ');
    const q0 = await page.locator('#exam-questions-value').innerText(); const m0 = await page.locator('#exam-minutes-value').innerText();
    check('P1 Exam row (no block): "Practice exam", editable Questions 30 / Minutes 60, help says they are Defaults; no exam facts, no "estimate"',
      /^Practice exam/.test(row) && q0 === '30' && m0 === '60' && /Defaults/.test(row) && (await page.locator('#exam-facts').count()) === 0 && !/estimate/i.test(row), row);
    for (let i = 0; i < 5; i += 1) await page.locator('#exam-questions button[aria-label="Fewer questions"]').click();
    await page.locator('#exam-row').screenshot({ path: `${SHOTS}/exam-row-noblock-${W}.png` });
    const q1 = await page.locator('#exam-questions-value').innerText();
    await page.locator('#exam-start-btn').click();
    await page.waitForSelector('#exam-run', { timeout: 15_000 });
    check('P2 Questions stepped 30 -> 5; Start -> "Question 1 of 5", caption "Practice exam"', q1 === '5' && (await position(page)) === 'Question 1 of 5'
      && /^Practice exam/i.test(await page.locator('#quiz-scope-label').innerText()), `${q1} ${await position(page)}`);
    await layout(page, W, 'exam run');
    await page.screenshot({ path: `${SHOTS}/exam-run-${W}.png`, fullPage: true });
    for (let i = 0; i < 5; i += 1) {
      const k = await curKey(page);
      await examAnswer(page, i < 3 ? correctOf(k) : wrongOf(k));
      if (i < 4) { await page.locator('#exam-next-btn').click(); await page.waitForTimeout(200); }
    }
    await page.locator('#exam-submit-btn').click();
    await page.waitForSelector('#app-dialog'); const body = await page.locator('#app-dialog-body').innerText();
    await page.locator('#app-dialog-confirm').click();
    await page.waitForSelector('#exam-result', { timeout: 15_000 });
    const resText = (await page.locator('#exam-result').innerText()).replace(/\s+/g, ' ');
    check('P3 result without the block: Raw "3 / 5 (60%)"; NO Estimate, NO pass/fail anywhere; per-chapter areas; dialog said "All answered."',
      body === 'All answered.' && (await page.locator('#exam-raw').innerText()).replace(/\s+/g, ' ') === '3 / 5 (60%)' && (await page.locator('#exam-estimate').count()) === 0
      && (await page.locator('#exam-verdict').count()) === 0 && !/estimate|pass/i.test(resText) && /Chapter \d: Gate topic/.test(resText), resText.slice(0, 160));
    await page.screenshot({ path: `${SHOTS}/exam-result-noblock-${W}.png`, fullPage: true });
    await layout(page, W, 'result');
    await page.locator('#exam-retry-missed-btn').click();
    await page.waitForSelector('#question-text', { timeout: 10_000 }); await page.waitForTimeout(400);
    const scope = await page.locator('#quiz-scope-label').innerText().catch(() => '');
    for (let i = 0; i < 2; i += 1) {
      const k = await curKey(page);
      const c = correctOf(k);
      for (const o of Array.isArray(c) ? c : [c]) await page.locator('#options-container .option-card').nth(o).click();
      if (Array.isArray(c)) await page.locator('#check-btn').click();
      await page.waitForTimeout(300);
      await page.locator('#next-btn').click(); await page.waitForTimeout(500);
    }
    const frac = await page.locator('#final-fraction').innerText().catch(() => '');
    check('P4 Retry missed: a run of ONLY the 2 missed ("retrying 2 of 5"); both right -> the result reads "5 / 5" (the ORIGINAL total, not 2 / 2)',
      /retrying 2 of 5/i.test(scope) && frac.replace(/\s+/g, ' ') === '5 / 5', `"${scope}" -> "${frac}"`);
    await ctx.close();
  }

  // ================================================================== T: 390, a real 1-minute run
  {
    const W = 390;
    const { ctx, page } = await newPage(W, 844);
    await page.goto(`${BASE}/${EX}/`, { waitUntil: 'networkidle' });
    await openPractice(page);
    await page.locator('#exam-row').screenshot({ path: `${SHOTS}/exam-row-block-${W}.png` });
    const blockRow = await page.evaluate(() => { const r = document.querySelector('#exam-row').getBoundingClientRect(); return Math.round(r.right - window.innerWidth); });
    check('T0 390 px: the block Exam row fits (no sideways overflow)', blockRow <= 0, String(blockRow));
    await page.goto(`${BASE}/${NO}/`, { waitUntil: 'networkidle' });
    const st = await api(page, 'POST', '/api/exam/start', { module: NO, questions: 5, minutes: 1 });
    check('T1 a 1-minute run started (API, same origin) -> 201', st.status === 201 && st.body.run?.remainingSeconds <= 60, String(st.status));
    await openPractice(page);
    const left = await page.locator('#exam-open-left').innerText().catch(() => '');
    await page.locator('#exam-resume-btn').click();
    await page.waitForSelector('#exam-run', { timeout: 10_000 });
    const s1 = await clockSeconds(page);
    check('T2 Resume: "Under a minute left", the clock < 1:00', /Under a minute/.test(left) && s1 <= 60 && s1 > 0, `${left} ${s1}s`);
    await examAnswer(page, correctOf(await curKey(page)));
    await page.locator('#exam-flag-btn').click(); await page.waitForTimeout(400);
    await layout(page, W, 'exam run');
    await page.screenshot({ path: `${SHOTS}/exam-run-${W}.png`, fullPage: true });
    await page.locator('#exam-nav-toggle').click(); await page.waitForTimeout(200);
    await page.screenshot({ path: `${SHOTS}/exam-run-nav-${W}.png`, fullPage: true });
    await layout(page, W, 'navigator open');
    const hdr = await page.evaluate(() => { const p = document.querySelector('#quiz-scope-label'); return p ? p.scrollWidth - p.clientWidth : -1; });
    check('T3 390 px header: the caption is not clipped', hdr <= 0, String(hdr));
    await page.waitForTimeout(5000);
    await page.reload({ waitUntil: 'networkidle' }); await page.waitForTimeout(600);
    await openPractice(page);
    await page.locator('#exam-resume-btn').click();
    await page.waitForSelector('#exam-run', { timeout: 10_000 });
    const s2 = await clockSeconds(page);
    const srv = await examOpen(page, NO);
    check('T4 reload -> Resume: the clock continued from the SERVER deadline (lower, = server +/- 3 s)', s2 < s1 - 3 && Math.abs(s2 - srv.run.remainingSeconds) <= 3,
      `${s1}s -> ${s2}s (server ${srv.run?.remainingSeconds}s)`);
    const lowTag = await page.locator('#exam-timer').innerText();
    check('T5 under 5 min the clock says "Low" in TEXT (not colour only)', /Low/i.test(lowTag), lowTag.replace(/\s+/g, ' '));
    await page.waitForSelector('#exam-result', { timeout: (s2 + 20) * 1000 });
    const srvEnd = await examOpen(page, NO);
    const raw = (await page.locator('#exam-raw').innerText()).replace(/\s+/g, ' ');
    check('T6 at 0:00 it submits on its own -> the result (1 / 5); the server closed it by the deadline', raw === '1 / 5 (20%)' && srvEnd.run === null
      && ['deadline', 'submit'].includes(srvEnd.last?.finishedBy), `${raw} finishedBy ${srvEnd.last?.finishedBy}`);
    console.log(`INFO T finishedBy = ${srvEnd.last?.finishedBy} (submit = the client's 0:00 Submit landed first; deadline = the server closed it)`);
    await page.screenshot({ path: `${SHOTS}/exam-result-${W}.png`, fullPage: true });
    await layout(page, W, 'result');
    await ctx.close();
  }
} catch (error) {
  check('X harness', false, String(error).slice(0, 300));
} finally {
  const notArt = [...new Set(missing)].filter((p) => !/\/(book|assets)\/|favicon|cover/.test(p));
  console.log(`INFO 404s: ${JSON.stringify([...new Set(missing)])}`);
  check('L no native dialog, ever (window.confirm / alert / beforeunload)', native.length === 0, JSON.stringify(native));
  check('L no 5xx from /api/, no console error, no unexpected 404', !bad.length && !errors.length && !notArt.length, `${bad.join(',')} ${errors.join(' | ')} ${notArt.join(',')}`);
  await browser.close();
  if (stage) {
    stage.stdin.end();
    await new Promise((r) => { stage.on('exit', r); setTimeout(r, 20_000); });
  }
  const passed = results.filter(Boolean).length;
  console.log(`\n${passed}/${results.length} passed`);
  process.exit(passed === results.length ? 0 : 1);
}
