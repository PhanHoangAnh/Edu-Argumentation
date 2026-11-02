#!/usr/bin/env node
/**
 * gate-r-b15.mjs — B15 PARITY: the deep-link defect must be REPRODUCED on the React port,
 * not fixed and not replaced by a different one.
 *
 * edu-replatform Phase 03, Exit Gate row "B15 is reproduced, not fixed". Tier 1, browser.
 *
 * ⛔ NOT REGISTERED IN run-gates-react.sh — the same standing as gate-c-theme.mjs. The Exit
 *    Gate lists B15 as its own command (`node gates/b15probe.mjs`), and b15probe.mjs is an
 *    AGENT-PROBE that cannot fail by construction ("T13 — Agent-Probe, NOT an assertion").
 *    This file is that probe's missing ASSERTION. It is kept out of the frozen R- vector so
 *    a product-side red does not turn the automated Tier-1 fence into a suite people learn
 *    to ignore — but it is executable, so the finding is a command and not a paragraph.
 *
 * ⛔ "SAME RESULT" IS DEFINED, NOT IMPLIED (C-6): compare ONLY `visibleScreens` and `hash`,
 *    before and after the LEARN click. ⛔ NEVER the pixel geometry — b15probe emits
 *    tutorial-content=1018x3144, which legitimately differs on a React port.
 *
 * ⛔ A "FIXED" B15 IS A FAILED GATE. The legacy behaviour is: arriving on a deep link and
 *    clicking LEARN DISCARDS it, jumps to nextLesson() and STAMPS THE HASH
 *    (app.js:1238-1241 -> selectTheory() writes the hash). Fixing that is a Phase 04+
 *    decision WITH ITS OWN GATE CHANGE, not a side effect of a port. R-B15b below asserts
 *    the discard EXPLICITLY (conjunct 1) so a "fix" cannot read green.
 *
 * ============================================================================
 * ⛔⛔ REWRITTEN 2026-09-22 (item C) — R-B15b WAS A STALE-LITERAL GATE DEFECT.
 * ============================================================================
 * WHAT IT USED TO DO, and why that was wrong:
 *   It pinned `after.hash === '#chapter=1&block=1'`, a literal measured on :8791 against an
 *   EMPTY progress store. But the destination is `nextLesson()`, which is A FUNCTION OF THE
 *   PROGRESS STORE. The user's live store holds 18 completions, so `nextLesson()` correctly
 *   returns ch02-b07 and the gate read RED at 2/3 — against a product that was behaving
 *   EXACTLY as B15 specifies. Three independent runs confirmed it: 3/3 on :8791, 3/3 on a
 *   clean-store instance of the byte-identical deployed bundle, 2/3 on the live store.
 *
 *   ⛔ THE FIX IS TO THE **GATE**, NOT THE PRODUCT. B15 is still reproduced, defect intact.
 *
 *   ⛔ It is the SIXTH instance of the stale-literal class in this program — after
 *      `total === 21`, `-eq 49`, the B1 `=== 41` temptation, F-1's mtime and A-G17's
 *      fixture — the class `deploy-study.sh` now bans by name. The tell is always the same:
 *      an assertion pins a number that MOVES ON ITS OWN, so the gate measures the
 *      environment instead of the behaviour.
 *
 * WHAT IT DOES NOW — assert the BEHAVIOUR, derive the number:
 *   R-B15b is a CONJUNCTION of two halves, and both are load-bearing:
 *     (1) DISCARD  — `after.hash !== deepLinkHash`. This IS the defect. If someone "fixes"
 *                    B15 so the deep link is honoured, this half goes RED, which is the
 *                    required outcome.
 *     (2) DESTINATION — `after.hash === nextLessonHash`, where nextLessonHash is COMPUTED
 *                    HERE from two live reads: `/book/<id>/module.json` (chapter and block
 *                    counts) and `/api/progress?module=<id>` (the completions). Nothing is
 *                    pinned; the expectation moves with the store exactly as the product
 *                    does.
 *   Splitting them matters: (2) alone would pass a product that never moved the hash if the
 *   deep link happened to BE the next lesson, and (1) alone would pass a jump to anywhere.
 *
 * ⛔ ANTI-VACUITY FENCE. If the derived next-lesson hash EQUALS the deep-link hash, the two
 *    conjuncts contradict each other and the run can distinguish nothing. That is not a
 *    failure of the product, so the gate THROWS rather than reporting either colour —
 *    silence would be a gate reporting a verdict it did not earn.
 *
 * BASELINE — `visibleScreens` only. It is store-INDEPENDENT (which screens are on, not
 * which lesson), so it stays a literal. Measured on :8791 21-09-26, re-measured 22-09-26.
 *
 * Run it against either stack:
 *   GATE_BASE=http://127.0.0.1:8791            node gate-r-b15.mjs   # legacy — expect GREEN
 *   GATE_BASE=http://192.168.100.66:8792       node gate-r-b15.mjs   # React  — the real check
 */
import { chromium } from 'playwright';

const BASE = process.env.GATE_BASE || process.env.R_REMOTE || 'http://192.168.100.66:8767';  // P6b 24-09-26: was :8792 (retired)
const MODULE_ID = process.env.GATE_MODULE || 'geron-homl3';
/** ⚑ 29-09-26 (study-rooms-qna P1, V1): since Phase 06a the two derivation reads need a session
 *  (live /book/<id>/module.json and /api/progress answer 401 without one). Optional: when set,
 *  both fetches and the browser context carry `edu_session=<token>`. Unset = the old behaviour. */
const GATE_COOKIE = process.env.GATE_COOKIE || '';

/** The deep link the probe arrives on. Its whole job is to be SOMETHING OTHER THAN the
 *  next lesson, which the fence below verifies rather than assumes. */
const DEEP_CHAPTER = Number(process.env.GATE_DEEP_CHAPTER || 1);
const DEEP_BLOCK = Number(process.env.GATE_DEEP_BLOCK || 8);
const deepLinkHash = `#chapter=${DEEP_CHAPTER}&block=${DEEP_BLOCK}`;

/** Store-INDEPENDENT baseline. Which screens are visible does not depend on progress. */
const SCREENS = {
  before: ['welcome-screen'],
  after: ['welcome-screen', 'tutorial-screen'],
};

const results = [];
const check = (id, pass, detail) => {
  results.push({ id, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${id}  ${detail}`);
};

// ── DERIVE the expectation from the LIVE stack ────────────────────────────────
// ⛔ Two reads, both live, neither pinned. This is the whole point of the rewrite.
const jsonAt = async (path) => {
  const res = await fetch(`${BASE}${path}`, GATE_COOKIE ? { headers: { Cookie: `edu_session=${GATE_COOKIE}` } } : undefined);
  if (!res.ok) throw new Error(`derivation read failed: GET ${path} -> ${res.status}`);
  return res.json();
};

const moduleJson = await jsonAt(`/book/${MODULE_ID}/module.json`);
const sections = moduleJson?.tutorialData?.sections;
if (!Array.isArray(sections) || sections.length === 0) {
  // A book with no sections makes nextLesson() undefined. Refuse rather than guess.
  throw new Error(`derivation refused: ${MODULE_ID} has no tutorialData.sections[]`);
}
// blocksOfChapter() == chapter.items[] (state/BookProvider.tsx:68-75).
const blockCountOf = (ci) => (Array.isArray(sections[ci]?.items) ? sections[ci].items.length : 0);

const progress = await jsonAt(`/api/progress?module=${encodeURIComponent(MODULE_ID)}`);
const completed = progress?.completed ?? {};
// theoryBlockId() verbatim (state/ProgressProvider.tsx:43-45).
const blockIdOf = (ci, bi) => `ch${String(ci + 1).padStart(2, '0')}-b${String(bi + 1).padStart(2, '0')}`;

// nextLesson() verbatim (state/theoryNav.ts) — FIRST INCOMPLETE block, chapters in order;
// a finished book returns its LAST block with done:true, never null.
function nextLesson() {
  for (let ci = 0; ci < sections.length; ci += 1) {
    const count = blockCountOf(ci);
    for (let bi = 0; bi < count; bi += 1) {
      if (!completed[blockIdOf(ci, bi)]) return { ci, bi, done: false };
    }
  }
  const last = sections.length - 1;
  return { ci: last, bi: Math.max(0, blockCountOf(last) - 1), done: true };
}

const next = nextLesson();
const nextLessonHash = `#chapter=${next.ci + 1}&block=${next.bi + 1}`;
const completedCount = Object.keys(completed).length;

console.log(
  `DERIVED  module=${MODULE_ID} chapters=${sections.length} completions=${completedCount}`
  + ` firstIncomplete=${blockIdOf(next.ci, next.bi)} done=${next.done}`
  + ` -> expected post-LEARN hash ${nextLessonHash}  (deep link was ${deepLinkHash})`,
);

// ⛔ ANTI-VACUITY FENCE — see the header. Throw, never report a colour we cannot earn.
if (nextLessonHash === deepLinkHash) {
  throw new Error(
    `gate refused: the derived next lesson (${nextLessonHash}) EQUALS the deep link`
    + ` (${deepLinkHash}), so "the deep link was discarded" and "it landed on nextLesson()"`
    + ` cannot be told apart. Re-point the probe with GATE_DEEP_CHAPTER / GATE_DEEP_BLOCK.`,
  );
}
// A deep link past the end of its chapter is not a B15 probe, it is a broken fixture.
if (DEEP_BLOCK > blockCountOf(DEEP_CHAPTER - 1)) {
  throw new Error(
    `gate refused: deep link ${deepLinkHash} points past chapter ${DEEP_CHAPTER}'s`
    + ` ${blockCountOf(DEEP_CHAPTER - 1)} blocks.`,
  );
}

// ── Drive the browser ─────────────────────────────────────────────────────────
const browser = await chromium.launch({ executablePath: process.env.GATE_CHROME || chromium.executablePath() });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
if (GATE_COOKIE) {
  await ctx.addCookies([{ name: 'edu_session', value: GATE_COOKIE, url: BASE, httpOnly: true }]);
}
const page = await ctx.newPage();

const snap = () => page.evaluate(() => ({
  // ⚠ The SAME enumeration b15probe.mjs uses, including the `#home-screen` phantom, so the
  //   two agree by construction. `.hidden-view` is the hide mechanism on both stacks.
  visibleScreens: [...document.querySelectorAll('[id$="-screen"], #home-screen')]
    .filter((e) => !e.classList.contains('hidden-view')).map((e) => e.id),
  hash: location.hash,
  // REPORTED, NOT ASSERTED by R-B15a/b — it is what tells "not reproduced" apart from
  // "reproduced". R-B15c does assert it.
  title: (document.getElementById('tutorial-main-title') || {}).textContent?.trim().slice(0, 60) || '',
}));

await page.goto(`${BASE}/${deepLinkHash}`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1800);
const before = await snap();

const learn = page.locator('#read-tutorial-btn');
const clickable = (await learn.count()) > 0 && (await learn.isVisible());
if (clickable) { await learn.click(); await page.waitForTimeout(1800); }
const after = await snap();
await browser.close();

const sameScreens = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

check('R-B15a BEFORE the LEARN click: visibleScreens + hash match the deep link',
  sameScreens(before.visibleScreens, SCREENS.before) && before.hash === deepLinkHash,
  `got=${JSON.stringify({ visibleScreens: before.visibleScreens, hash: before.hash })}`
  + ` expected=${JSON.stringify({ visibleScreens: SCREENS.before, hash: deepLinkHash })}`
  + ` | title(reported)=${JSON.stringify(before.title)}`);

// ⛔ TWO CONJUNCTS. (1) is the DEFECT and must hold; (2) is the DESTINATION, derived.
const discarded = clickable && after.hash !== deepLinkHash;
const landedOnNext = clickable && after.hash === nextLessonHash;
check('R-B15b AFTER the LEARN click: the deep link is DISCARDED and the hash is overwritten '
  + 'with the live store\'s own first-incomplete block (a "fixed" B15 is a FAILED gate)',
  clickable && sameScreens(after.visibleScreens, SCREENS.after) && discarded && landedOnNext,
  (clickable ? '' : '⛔ #read-tutorial-btn was not clickable — ')
  + `got=${JSON.stringify({ visibleScreens: after.visibleScreens, hash: after.hash })}`
  + ` | conjunct1 discarded(hash !== ${deepLinkHash})=${discarded}`
  + ` | conjunct2 landedOnNextLesson(hash === ${nextLessonHash}, DERIVED from`
  + ` ${completedCount} live completions)=${landedOnNext}`
  + ` | screens expected=${JSON.stringify(SCREENS.after)}`
  + ' — the legacy LEARN handler calls selectTheory(nextLesson()), which STAMPS the hash'
  + ' (app.js:1238-1241). conjunct1 RED means the deep link was HONOURED, i.e. B15 was'
  + ' FIXED — that is a Phase 04+ decision and needs its own gate change, not a silent pass.'
  + ' conjunct2 RED means it jumped somewhere that is NOT the first incomplete block.');

check('R-B15c the reader actually LOADED A LESSON on the deep link (not a placeholder shell)',
  // ⚑ 24-09-26 (plan D9): the title is "<n>. <term>" — the number is REQUIRED and is stripped before the
  //   placeholder test, or "13. Theory block 13" would slip past it and pass on a broken build.
  after.title.length > 0 && /^\d+\.\s/.test(after.title) && !/^Theory block \d+$/.test(after.title.replace(/^\d+\.\s/, '')),
  `title=${JSON.stringify(after.title)} — ⛔ "Theory block N" is BlockRenderer's PLACEHOLDER:`
  + ' it means the reader opened with NO BOOK LOADED. The legacy app loads the book on the'
  + ' deep-link path and shows the real lesson title. This is a SEPARATE, LARGER defect than'
  + ' B15 itself and is why "B15 looks fixed" on :8792 is not a fix.');

console.log(`\n${results.filter((r) => r.pass).length}/${results.length} passed`);
const failed = results.filter((r) => !r.pass);
if (failed.length) console.log('FAILED: ' + failed.map((r) => r.id).join(', '));
if (failed.length) process.exit(1);
