#!/usr/bin/env node
/**
 * gate-r-writeui.mjs — R-suite: EVERY WRITE, DRIVEN THROUGH THE REAL UI. Phase 04, Tier 2.
 *
 * gate-r-write.mjs proves the ROUTES. This file proves the PAGE reaches them the way a reader
 * does — click, answer, submit — and that what the page SHOWS afterwards is what the store
 * holds. The lesson from Phase 03 (D-1, D-8, D-10) is that a defect living in a SEQUENCE is
 * invisible to every surface check; so each assertion here is about what a journey produced.
 *
 * Runs against the write harness (:8796 + the stub on :8797), with its OWN stores under
 * /var/tmp. ⛔ Never the user's progress.json.
 *
 * ⛔ EXPECTATIONS COME FROM module.json IN NODE, never from the DOM being measured (the
 *    journey gate's independence rule): the correct option indices, the question counts and the
 *    exercise answers are all known before the browser starts.
 *
 * Ten result lines (RS-COUNT in gate-r-self.mjs moves with this number):
 *   UI-MODULEID UI-RECORD UI-EXERCISE UI-AIQUIZ UI-GENERATE UI-ASK UI-COPY UI-DEEPER UI-SETTINGS UI-RENAME
 * ⚑ R24 (23-09-26): UI-RUN (a cell ran through the proxy) retired with the runner -> UI-COPY.
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.R_WRITE_BASE || 'http://127.0.0.1:8796';
const STORES = process.env.R_WRITE_STORES || '/var/tmp/edu-write-harness/stores';
const LIB = process.env.R_LIB_ROOT || '/var/tmp/edu-smoke/lib';
const MODULE = 'geron-homl3';
if (!STORES.startsWith('/var/tmp/')) {
  console.error(`REFUSING: R_WRITE_STORES=${STORES} is not under /var/tmp.`);
  process.exit(2);
}

const results = [];
const check = (id, pass, detail) => {
  results.push({ id, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${id}  ${detail}`);
};
// ⚑ Phase 06a (ruling R25): progress is PER ACCOUNT in PostgreSQL now, and :8792 no longer writes
//   progress.json. The store is read through the API, as the signed-in gate account (the session
//   cookie comes from lib/auth-preload.mjs) — i.e. exactly what the reader's own page reads.
const progress = async () => {
  try {
    const r = await fetch(`${BASE}/api/progress?module=${encodeURIComponent(MODULE)}`);
    return (await r.json()).completed || {};
  } catch { return {}; }
};

const mod = JSON.parse(fs.readFileSync(path.join(LIB, MODULE, 'module.json'), 'utf8'));
const bankFor = (id) => mod.quizData.filter((q) => q?.source?.block === id);

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await ctx.newPage();
const consoleErrors = [];
page.on('pageerror', (e) => consoleErrors.push(String(e)));
const click = (sel) => page.evaluate((s) => document.querySelector(s)?.click(), sel);
const text = (sel) => page.evaluate((s) => (document.querySelector(s)?.textContent || '').replace(/\s+/g, ' ').trim(), sel);
const shown = (id) => page.evaluate((s) => document.getElementById(s)?.offsetParent !== null, id);
/** Reader at chapter/block, via the hash route the app itself writes. */
async function reader(chapter, block) {
  await page.goto(`${BASE}/#chapter=${chapter}&block=${block}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(900);
  await click('#nav-learn');
  await page.waitForTimeout(900);
}
/** Every rich-text-viewer shadow root's text under a selector — light-DOM text cannot see them. */
const shadowText = (sel) =>
  page.evaluate((s) => {
    const root = document.querySelector(s);
    if (!root) return '';
    const parts = [root.innerText || ''];
    root.querySelectorAll('rich-text-viewer').forEach((v) => parts.push(v.shadowRoot ? v.shadowRoot.textContent || '' : ''));
    return parts.join(' ').replace(/\s+/g, ' ');
  }, sel);

/* ---- UI-MODULEID: every book's progress key is the LEGACY's (app.js moduleIdFor) ----
 * ⛔ Found BY EYE on the live :8792, 23-09-26: the port's moduleIdFor returned the raw file stem
 *    ("SageMaker_Clarify"), the server's MODULE_ID rejected it and module_key() fell back to
 *    geron-homl3 — so a SageMaker card read "22 of 4 lessons", and with writes live a completion
 *    in that book would have landed in the user's GÉRON progress. The expectation is derived by
 *    running the LEGACY function itself (extracted from aws-quiz-app/js/app.js) in node. */
const appJs = fs.readFileSync(path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'aws-quiz-app/js/app.js'), 'utf8');
const legacySrc = /function moduleIdFor\(parsedData, bookFile = null\) \{[\s\S]*?\n\}/.exec(appJs)?.[0];
const legacyModuleIdFor = legacySrc ? new Function(`${legacySrc}; return moduleIdFor;`)() : null;
const listed = await (await fetch(`${BASE}/api/modules`)).json();
const expectedIds = new Set((listed.books || []).map((b) => (b.moduleId && !/^t-/.test(b.moduleId) ? b.moduleId : legacyModuleIdFor({}, b.file))));
const seenIds = new Set();
page.on('request', (r) => {
  const u = new URL(r.url());
  if (u.pathname === '/api/progress' && r.method() === 'GET') seenIds.add(u.searchParams.get('module'));
});
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
const missingIds = [...expectedIds].filter((id) => !seenIds.has(id));
const strayIds = [...seenIds].filter((id) => !expectedIds.has(id));
check('UI-MODULEID the page reads every book\'s progress under the LEGACY key (app.js moduleIdFor, run in node) — none falls back to another book',
  Boolean(legacyModuleIdFor) && expectedIds.size >= 3 && missingIds.length === 0 && strayIds.length === 0 && [...seenIds].some((id) => /^f-/.test(id)),
  `expected=${JSON.stringify([...expectedIds])} seen=${JSON.stringify([...seenIds])} missing=${JSON.stringify(missingIds)} stray=${JSON.stringify(strayIds)}`);

/* ---- UI-RECORD: Begin Assessment -> 100% -> the block is ticked, ON DISK and ON SCREEN ---- */
const BLOCK = 'ch01-b01';
const asked = bankFor(BLOCK);
await reader(1, 1);
const btnLabel = await text('#tutorial-to-quiz-label');
await click('#tutorial-to-quiz-btn');
await page.waitForTimeout(900);
for (let i = 0; i < asked.length; i += 1) {
  await page.evaluate((k) => document.querySelectorAll('#options-container .option-card')[k]?.click(), asked[i].correct);
  await page.waitForTimeout(250);
  await click('#next-btn');
  await page.waitForTimeout(350);
}
await page.waitForTimeout(1500);
const onResult = await shown('result-screen');
const resultMsg = await text('#result-message');
const stored = (await progress())[BLOCK];
check('UI-RECORD Begin Assessment answered 100% -> #result-screen says "Block complete" AND the account\'s progress store holds the block (source written)',
  asked.length >= 2 && /Begin Assessment|Retake/.test(btnLabel) && onResult && /Block complete/.test(resultMsg)
    && stored?.score === asked.length && stored?.total === asked.length && stored?.source === 'written',
  `label="${btnLabel}" asked=${asked.length} result=${onResult} message="${resultMsg.slice(0, 120)}" stored=${JSON.stringify(stored)}`);

/* ---- UI-EXERCISE: multiple-choice exercises, all right -> the block ticks as exercise-mcq ---- */
const EX_CH = 3;
const exItemIndex = mod.tutorialData.sections[EX_CH - 1].items.findIndex((it) => /exercise/i.test(it?.term || ''));
const exBlock = mod.tutorialData.sections[EX_CH - 1].items[exItemIndex];
const exList = (exBlock.blocks.find((b) => Array.isArray(b?.exercises)) || {}).exercises || [];
const exId = `ch${String(EX_CH).padStart(2, '0')}-b${String(exItemIndex + 1).padStart(2, '0')}`;
await reader(EX_CH, exItemIndex + 1);
await page.evaluate(() => {
  const panel = document.querySelector('[data-exercise-panel]');
  [...(panel?.querySelectorAll('button') || [])].find((b) => /multiple choice/i.test(b.textContent || ''))?.click();
});
await page.waitForTimeout(600);
for (const [row, entry] of exList.entries()) {
  await page.evaluate(([r, k]) => {
    const rows = document.querySelectorAll('[data-exercise-row]');
    rows[r]?.querySelectorAll('.option-card')[k]?.click();
  }, [row, entry.correct]);
  await page.waitForTimeout(250);
}
await page.waitForTimeout(1500);
const exStatus = await text('[data-exercise-panel] p.mb-4');
const exStored = (await progress())[exId];
check('UI-EXERCISE every multiple-choice exercise answered right -> "all correct" and the block ticks as exercise-mcq (zero model calls)',
  exList.length >= 2 && /all correct/.test(exStatus) && exStored?.source === 'exercise-mcq' && exStored?.total === exList.length,
  `block=${exId} exercises=${exList.length} status="${exStatus.slice(0, 140)}" stored=${JSON.stringify(exStored)}`);

/* ---- UI-AIQUIZ: the reader's AI quiz -> an AI-written run of ai_question_count questions ---- */
await reader(2, 7);
const aiEnabled = await page.evaluate(() => !document.getElementById('block-ai-quiz-btn')?.disabled);
await click('#block-ai-quiz-btn');
await page.waitForTimeout(2500);
const aiScope = await text('#quiz-scope-label');
const aiCards = await page.evaluate(() => document.querySelectorAll('#options-container .option-card').length);
check('UI-AIQUIZ the reader AI quiz button (enabled: provider ready) opens an AI-written run from the stub',
  aiEnabled && (await shown('quiz-screen')) && /^AI-written · 5 questions$/.test(aiScope) && aiCards === 4,
  `enabled=${aiEnabled} scope="${aiScope}" cards=${aiCards}`);

/* ---- UI-GENERATE: GENERATE QUIZ tab -> picker in generate mode -> loading -> run ---- */
await click('#nav-generated-quiz');
await page.waitForTimeout(700);
const setupTitle = await text('#setup-title');
await click('#setup-all-btn');
await page.waitForTimeout(300);
const setupCount = await text('#setup-count');
await click('#setup-start-btn');
await page.waitForTimeout(3000);
const genScope = await text('#quiz-scope-label');
const genTab = await page.evaluate(() => document.getElementById('nav-generated-quiz')?.getAttribute('aria-current'));
check('UI-GENERATE the GENERATE QUIZ tab opens the picker in generate mode, counts AI questions, and starts an AI run',
  setupTitle === 'AI-Quiz' && /AI questions$/.test(setupCount) && /^AI-written · 20 questions$/.test(genScope) && genTab === 'true',
  `title="${setupTitle}" count="${setupCount}" scope="${genScope}" navActive=${genTab}`);

/* ---- UI-ASK: the tutor answers, with its source badge, and the conversation survives a reload ---- */
await reader(2, 7);
await click('#ask-fab');
await page.waitForTimeout(400);
const askContext = await text('#ask-context');
await page.fill('#ask-input', 'what is a stratum?');
await page.keyboard.press('Enter');
await page.waitForTimeout(2500);
const askLog = await shadowText('#ask-log');
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(900);
await click('#nav-learn');
await page.waitForTimeout(600);
await click('#ask-fab');
await page.waitForTimeout(400);
const askLogAfter = await shadowText('#ask-log');
check('UI-ASK a question gets the tutor answer with its SOURCE badge, grounded label shown, and the log survives a reload',
  /This lesson/i.test(askLog) && /Stub tutor answer/.test(askLog) && /what is a stratum\?/.test(askLog)
    && /Stub tutor answer/.test(askLogAfter) && askContext.includes('·'),
  `context="${askContext}" log="${askLog.slice(0, 120)}" afterReload=${/Stub tutor answer/.test(askLogAfter)}`);

/* ---- UI-COPY: ruling R24 — code is a STATIC listing with a Copy button, and Copy copies ----
 * Expected source derived in node from module.json. The harness is 127.0.0.1 (a secure context), so
 * this proves the navigator.clipboard path; the http-LAN fallback is proven live (P4 report §R24). */
await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE });
await reader(1, 8);
const cellData = mod.tutorialData.sections[0].items[7].blocks.find((b) => b?.type === 'code_cells')?.cells?.[0];
const copyInfo = await page.evaluate(() => {
  const card = document.querySelector('#tutorial-content section[data-cell]');
  const buttons = card ? [...card.querySelectorAll('button')].map((b) => b.getAttribute('aria-label') || '') : [];
  card?.querySelector('button[data-copy]')?.click();
  return { buttons, text: card ? (card.textContent || '') : '' };
});
await page.waitForTimeout(400);
const clip = await page.evaluate(() => navigator.clipboard.readText().catch((e) => `ERR ${e}`));
const label = await page.evaluate(() => document.querySelector('#tutorial-content section[data-cell] button[data-copy]')?.textContent?.trim());
check('UI-COPY a code cell is a STATIC listing (one button: Copy — no Edit/Reset/Run, no kernel status) and Copy puts the exact source on the clipboard',
  Boolean(cellData) && copyInfo.buttons.length === 1 && /^Copy cell \d+$/.test(copyInfo.buttons[0])
    && clip === cellData.source && label === 'Copied' && !/Running|Done in|Run disabled/.test(copyInfo.text),
  `buttons=${JSON.stringify(copyInfo.buttons)} label="${label}" clipboardMatches=${clip === cellData?.source} (${String(clip).length} chars)`);

/* ---- UI-DEEPER: the [object Object] defect is gone — shadow roots pierced ---- */
await reader(2, 7);
const deeper = await page.evaluate(() => {
  const panels = [...document.querySelectorAll('#tutorial-content details[data-deeper]')];
  let text = '';
  panels.forEach((p) => {
    p.open = true;
    text += ' ' + (p.innerText || '');
    p.querySelectorAll('rich-text-viewer').forEach((v) => { text += ' ' + (v.shadowRoot?.textContent || ''); });
  });
  const everywhere = [...document.querySelectorAll('#tutorial-content rich-text-viewer')].map((v) => v.shadowRoot?.textContent || '').join(' ');
  return { panels: panels.length, rows: panels.reduce((n, p) => n + p.querySelectorAll('li').length, 0),
    label: panels[0]?.querySelector('summary')?.textContent?.trim() || '', objectObject: /\[object Object\]/.test(text + everywhere + document.body.innerText) };
});
check('UI-DEEPER `deeper` renders as the "Go deeper" <details> with term — text rows, and ZERO "[object Object]" anywhere (shadow roots included)',
  deeper.panels >= 1 && deeper.rows >= 1 && /^Go deeper · /.test(deeper.label) && deeper.objectObject === false,
  JSON.stringify(deeper));

/* ---- UI-SETTINGS: the form loads, says a key is STORED, and never shows a secret ---- */
await click('#nav-settings');
await page.waitForTimeout(1200);
const settings = await page.evaluate(() => ({
  form: document.getElementById('settings-form')?.offsetParent !== null,
  keyState: document.getElementById('api-key-state')?.textContent || '',
  keyField: document.getElementById('set-api-key')?.value ?? null,
  model: document.getElementById('set-model')?.value ?? null,
  html: document.documentElement.outerHTML,
}));
const leaked = ['SECRETVALUE', 'RUNNERSECRET'].filter((s) => settings.html.includes(s));
check('UI-SETTINGS the settings form shows "A key is stored", an EMPTY key field, the model, and no secret anywhere in the DOM',
  settings.form && /A key is stored/.test(settings.keyState) && settings.keyField === '' && settings.model === 'edu-tutor' && leaked.length === 0,
  `form=${settings.form} keyState="${settings.keyState.slice(0, 40)}" keyField="${settings.keyField}" model=${settings.model} leaked=${JSON.stringify(leaked)}`);

/* ---- UI-RENAME: double-click the card title, type, Enter -> library-meta.json ---- */
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
await page.locator(`#library-grid [data-rename="${MODULE}"]`).dblclick();
await page.waitForTimeout(300);
const input = page.locator('#library-grid input[type="text"]');
const hasInput = await input.count();
await input.fill('Renamed by gate');
await input.press('Enter');
await page.waitForTimeout(1200);
let metaTitle = null;
try { metaTitle = JSON.parse(fs.readFileSync(path.join(STORES, 'library-meta.json'), 'utf8')).titles?.[MODULE]; } catch { /* absent */ }
const cardTitle = await text(`#library-grid [data-rename="${MODULE}"]`);
const stillOpen = await page.evaluate((m) => document.querySelector(`#library-grid [data-book="${m}"]`)?.getAttribute('aria-current'), MODULE);
check('UI-RENAME double-click the title -> input -> Enter renames it (card + library-meta.json) WITHOUT toggling the book',
  hasInput === 1 && metaTitle === 'Renamed by gate' && cardTitle === 'Renamed by gate' && stillOpen === 'true',
  `input=${hasInput} meta="${metaTitle}" card="${cardTitle}" stillOpen=${stillOpen} pageErrors=${consoleErrors.length}`);

await browser.close();
console.log(`\n${results.filter((r) => r.pass).length}/${results.length} passed`);
const failed = results.filter((r) => !r.pass);
if (failed.length) console.log('FAILED: ' + failed.map((r) => r.id).join(', '));
if (failed.length) process.exit(1);
