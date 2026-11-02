#!/usr/bin/env node
/**
 * gate-r-journey.mjs — R-suite: THE WHOLE USER JOURNEY, END TO END. A quiz is STARTED,
 * every question is ANSWERED, the run is FINISHED, and the narrowed re-run is exercised.
 *
 * edu-replatform Phase 03, EVL fix 004. Tier 2, browser-backed, against $R_BASE.
 *
 * ═══ WHY THIS FILE EXISTS ══════════════════════════════════════════════════════════════
 *
 * ⛔⛔ D-10 SURVIVED 54 GREEN GATES BECAUSE NOT ONE OF THEM FINISHED A QUIZ.
 *
 *    `showResults` — 93 lines, one of the plan's own six spanning functions — was UNPORTED.
 *    Running a quiz on the deployed :8792 reached `Question 6 of 5`, rendered zero option
 *    cards, and NEVER showed `#result-screen`: the app had no ending. The suite could not
 *    see it because every gate in it measures a SURFACE — does this selector resolve, is
 *    this element contained, is this computed padding in band — and then stops. The furthest
 *    any of them went was gate-r-contract's sweep, which starts a quiz, samples ONE state,
 *    and navigates away.
 *
 *    This is the THIRD time this program has hit the same shape, and that is why it is
 *    written down rather than fixed quietly:
 *      · D-1 — scroll was dead app-wide.   NO GATE SCROLLED.
 *      · D-8 — the nav died after one use. NO GATE CLICKED NAV TWICE.
 *      · D-10 — the quiz had no ending.    NO GATE FINISHED A QUIZ.
 *    A suite of surface checks is blind to any defect that only exists in a SEQUENCE. So
 *    this file asserts a journey, and its assertions are about what the sequence produced.
 *
 * ═══ THE INDEPENDENCE RULE ═════════════════════════════════════════════════════════════
 *
 * ⛔ THE EXPECTATIONS ARE DERIVED IN NODE, FROM `module.json`, NEVER FROM THE DOM BEING
 *    MEASURED. Same discipline as gate-r-dom's `total === 21` deletion: a derivation
 *    computed from the page it checks is a tautology. Here node reads the book's own
 *    `quizData`, filters it by `source.block` (the app's own rule, app.js:3093-3096 —
 *    and the port's, QuizSetupScreen.practiceQuestionsFor), and knows the question COUNT
 *    and every `correct` index BEFORE the browser starts. That is what makes it possible
 *    to answer DELIBERATELY — one right and the rest wrong — which is what R-J4 needs.
 * ⛔ THE BANK IS NOT SHUFFLED. Measured 22-09-26: `Math.random` and `sort(() =>` appear
 *    nowhere in the legacy quiz path, and practiceQuestionsFor is a plain `filter`. If a
 *    shuffle is ever introduced, THIS GATE MUST BREAK — do not "fix" it by reading the
 *    correct answer out of the DOM, which would hand the expectation back to the page.
 *
 * ═══ THE FLOORS ════════════════════════════════════════════════════════════════════════
 *
 * Every assertion below carries one, because each of them has a trivially-true reading:
 *   R-J1  "the result screen is visible"      is free if the run had 0 questions.
 *   R-J2  "the counter never exceeded N"      is free if the counter never MOVED.
 *   R-J3  "the shown score equals the tally"  is free at 0/0, and weak at 5/5 or 0/5.
 *   R-J4  "the denominator is the original"   is free if the narrowed set IS the original.
 *   R-J5  "no explanation text when closed"    is free if the app renders NO explanations
 *                                              at all, or if the question has none.
 *   R-J6  "every option resolved"              is free if there is 1 option, or if the
 *                                              learner's pick happened to be correct.
 * The floors are asserted in the SAME boolean, so a fixture that cannot prove the point
 * makes the gate RED rather than green-and-meaningless.
 *
 * ═══ R-J5 / R-J6 — ADDED 22-09-26 (EVL fix 005) ════════════════════════════════════════
 *
 * ⛔⛔ D-11 — THE ANSWER LEAKED BEFORE THE LEARNER ANSWERED. `OptionCard` rendered the
 *     explanation unconditionally; the 41px closed card clipped it to one line, and because
 *     the correct option's explanation READS DIFFERENTLY from the three distractors the
 *     answer was identifiable without answering. On a self-assessment app that is the
 *     product's purpose defeated, not a cosmetic slip.
 *     ⚑ IT SURVIVED 59 GREEN GATES, and R-B1 — the one gate that measures this very
 *       element — could not see it: its band (35 <= closed <= 45) is satisfied at 41px
 *       whether the strip is EMPTY or FULL, because the 41px is PADDING. ⛔ R-B1 is correct
 *       and is NOT changed; R-J5 is a SEPARATE assertion about CONTENT, not geometry. A
 *       geometry gate cannot answer a content question, and widening R-B1 to cover this
 *       would have broken the band that catches the padding regression.
 *     ⛔ R-J5 asserts ABSENCE FROM THE DOM, not invisibility. Clipped, masked, coloured or
 *       0px-tall text is still readable by devtools, by selection, by a screen reader and
 *       by a screenshot — so "you cannot see it" is not the claim being made.
 *
 * ⛔⛔ D-12 — the reveal opened on only 2 of 4 cards and carried none of the legacy's
 *     treatment. R-J6 asserts that EVERY option resolves, with its label, its colour and
 *     `opacity-50` on the ones the learner did not pick.
 *     ⛔ ITS EXPECTED COUNT IS DERIVED from the question's own `options.length` in
 *       module.json — never a literal `=== 4`. That literal is the stale-literal class that
 *       has already bitten this program five times (`total === 21`, `-eq 49`, the B1
 *       `=== 41` temptation, F-1's mtime, A-G17's fixture).
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

// ⚠ This gate reads NOTHING from the repo tree — its expectation comes from the book's
//   module.json ($R_LIB_ROOT) and its observation from the browser ($R_BASE). So there is
//   deliberately no R_REPO knob here: a COPY of this file run against a fault build needs
//   only R_BASE repointed, which is what makes the fault-proof control exact.
const BASE = process.env.R_BASE || 'http://127.0.0.1:8795';
const MODULE = process.env.R_MODULE || 'geron-homl3';
const LIB_ROOT = process.env.R_LIB_ROOT || '/var/tmp/edu-smoke/lib';
// ch01-b01 is the FIRST block of the FIRST chapter and carries 5 written questions.
// Chosen because it is the one block guaranteed to exist in any book the harness accepts.
const BLOCK = process.env.R_JOURNEY_BLOCK || 'ch01-b01';

const results = [];
const check = (id, pass, detail) => {
  results.push({ id, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${id}  ${detail}`);
};

/* ═════════ derivation, in NODE, from SOURCE ═════════ */
const moduleJson = JSON.parse(fs.readFileSync(path.join(LIB_ROOT, MODULE, 'module.json'), 'utf8'));
const bank = Array.isArray(moduleJson.quizData) ? moduleJson.quizData : [];
// practiceQuestionsFor(bank, [BLOCK]) — filter on source.block, never on position.
const ASKED = bank.filter((q) => q?.source?.block === BLOCK);
const CORRECT_AT = ASKED.map((q) => q.correct);

// THE ANSWER PLAN. Question 1 right, every other one wrong — deliberately, so the run
// finishes with a MIX. A mix is what R-J3 needs (0/N and N/N both match a broken tally by
// accident) and what R-J4 needs (a narrowed set strictly smaller than the original, and
// not empty). ⛔ Do not "simplify" this to "always click option 0".
const PLAN = CORRECT_AT.map((correct, i) => (i === 0 ? correct : correct === 0 ? 1 : 0));
const EXPECT_SCORE = PLAN.filter((pick, i) => pick === CORRECT_AT[i]).length;
const EXPECT_WRONG = ASKED.length - EXPECT_SCORE;

// R-J6's FIXTURE, CHOSEN IN NODE — the first question the plan answers WRONGLY that has at
// least three options. ⛔ NOT a hardcoded question index: measured 22-09-26, question 2 of
// ch01-b01 is TRUE/FALSE (2 options), so a fixed "question 2" made R-J6 red on its floor
// forever — green after a fix is impossible, which is a gate that can never pass and
// therefore a gate nobody keeps. All three reveal treatments (the correct card, the
// learner's own wrong pick, and an untouched wrong option) need >= 3 options to coexist.
const J6_AT = ASKED.findIndex(
  (q, i) => (q?.options || []).length >= 3 && PLAN[i] !== CORRECT_AT[i],
);

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('response', (r) => { if (r.status() >= 400) consoleErrors.push(`HTTP ${r.status()} ${r.url()}`); });

const read = (id) => page.evaluate((s) => document.getElementById(s)?.textContent ?? null, id);
const visibleScreens = () =>
  page.evaluate(() =>
    [...document.querySelectorAll('[id$="-screen"]')]
      .filter((el) => !el.classList.contains('hidden-view'))
      .map((el) => el.id),
  );
// ⛔ `offsetParent !== null` is the REAL visibility test, not the class. A class check would
//    pass on an element whose ancestor container is the hidden one — which is exactly the
//    state D-10 produced (#result-screen had correct content and no layout box).
const isShown = (id) => page.evaluate((s) => document.getElementById(s)?.offsetParent !== null, id);
const domClick = (id) => page.evaluate((s) => document.getElementById(s)?.click(), id);

/* ═════════ R-J5 / R-J6: the per-card observation ═════════
 * ⚠ READ FROM THE RENDERED DOM, never from a source string. React escapes `'`, `&` and `>`,
 *   so an assertion written against JSX source text passes or fails for the wrong reason.
 * ⚠ `opacity` is read COMPUTED, not as a class: `opacity-50` only means something if the
 *   stylesheet that defines it actually shipped (the missing-Tailwind failure of ruling R9).
 */
const CARD_STATE = () =>
  page.evaluate(() =>
    [...document.querySelectorAll('#options-container .option-card')].map((c) => {
      const inner = c.querySelector('.explanation-inner');
      const wrap = c.querySelector('.explanation-text');
      const letter = c.querySelector('.option-letter');
      const title = inner ? inner.querySelector('span') : null;
      const cs = getComputedStyle(c);
      return {
        innerLen: inner ? (inner.textContent || '').trim().length : -1,
        innerText: inner ? (inner.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60) : null,
        cardText: (c.textContent || '').replace(/\s+/g, ' ').trim(),
        expanded: wrap ? wrap.classList.contains('expanded') : null,
        reveal: c.dataset.reveal ?? null,
        label: title ? (title.textContent || '').trim() : null,
        labelClasses: title ? [...title.classList].sort().join(' ') : null,
        borderColor: cs.borderTopColor,
        opacity: Number(cs.opacity),
        dimmed: c.classList.contains('opacity-50'),
        answeredClass: c.classList.contains('answered'),
        letterBg: letter ? getComputedStyle(letter).backgroundColor : null,
      };
    }),
  );

// The leak detector. ⛔ It can only ever be TOO WEAK, never spuriously red: a normalisation
// mismatch means the token is NOT found, which is the PASS direction. The primary assertion
// is `innerLen === 0`; this is the belt on top of it, catching explanation text parked
// anywhere else in the card's subtree.
const NORM = (s) => String(s ?? '').replace(/[*_`~#>[\]()]/g, '').replace(/\s+/g, ' ').trim();
const leakToken = (expl) => NORM(expl).slice(0, 24);
// ⚠ Skipped when the option's OWN text contains the token — an explanation that opens by
//   quoting its option would otherwise red a CORRECT build.
const leaks = (cardText, expl, optionText) => {
  const t = leakToken(expl);
  if (t.length < 12) return false;
  if (NORM(optionText).includes(t)) return false;
  return NORM(cardText).includes(t);
};

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);

/* ---- open the book. IDEMPOTENT: clicking an already-open card CLOSES it. ---- */
const bookIsOpen = () =>
  page.evaluate(
    (m) => document.querySelector(`#library-grid [data-book="${m}"]`)?.getAttribute('aria-current') === 'true',
    MODULE,
  );
if (!(await bookIsOpen())) {
  await page.locator(`#library-grid [data-book="${MODULE}"]`).click();
  await page.waitForTimeout(2000);
}
if (!(await bookIsOpen())) {
  throw new Error(
    `⛔ JOURNEY PRECONDITION FAILED: ${MODULE} is not the open book. Every assertion below` +
      ' would be measured against a CLOSED book — an empty picker and an empty run, which is' +
      ' precisely the vacuous-green state this file exists to prevent. Refusing to continue.',
  );
}

/* ---- start a run scoped to exactly ONE block, so the derivation above is exact ---- */
await domClick('nav-quiz');
await page.waitForTimeout(1200);
await domClick('setup-none-btn');
await page.waitForTimeout(300);
// ⛔ A DOM .click() on purpose: the checkbox lives inside a COLLAPSED <details>, so it has no
//    hit box. HTMLElement.click() dispatches a real, bubbling click that React's delegated
//    onChange receives — the same reason gate-r-contract clicks the nav this way.
const ticked = await page.evaluate((b) => {
  const el = document.querySelector(`#setup-tree input[data-block="${b}"]`);
  if (!el) return 'ABSENT';
  el.click();
  return el.checked;
}, BLOCK);
await page.waitForTimeout(400);
await domClick('setup-start-btn');
await page.waitForTimeout(1500);

/* ---- RUN 1: answer every question, advancing after each ---- */
const badges = [];       // #question-number-badge, sampled at every question
const hints = [];        // #next-hint, the element that carries "N of M"
let answered = 0;
let derivedScore = 0;    // counted from the DOM's own reveal, independent of #score-tracker
const startScreens = await visibleScreens();
const cardsAtStart = await page.evaluate(() => document.querySelectorAll('#options-container .option-card').length);

// R-J5 / R-J6 samples. Q1 is answered CORRECTLY by the plan and Q2 WRONGLY, which is why the
// closed/open pair is taken on Q1 and the three-state reveal (green / red / dimmed) on Q2.
let closedQ1 = null;
let openQ1 = null;
let revealJ6 = null;
// The legacy staggers the reveal by `50ms * index` (app.js:2981), so the settle wait is
// DERIVED from the option count rather than being a constant that rots when a question with
// more options appears.
const settleFor = (n) => 50 * Math.max(0, n - 1) + 300;

for (let i = 0; i < ASKED.length; i += 1) {
  badges.push(await read('question-number-badge'));
  hints.push(await read('next-hint'));
  if (i === 0) closedQ1 = await CARD_STATE();
  await page.evaluate((k) => document.querySelectorAll('#options-container .option-card')[k]?.click(), PLAN[i]);
  await page.waitForTimeout(320);
  if (i === 0 || i === J6_AT) {
    await page.waitForTimeout(settleFor((ASKED[i].options || []).length));
    if (i === 0) openQ1 = await CARD_STATE();
    if (i === J6_AT) revealJ6 = await CARD_STATE();
  }
  // The DOM's own verdict on the click, read back from the revealed card. This is a SECOND,
  // independent observation of the same fact the derivation predicted — if the two disagree
  // the fixture is wrong and R-J3's floor says so.
  const wasRight = await page.evaluate(
    (k) => document.querySelectorAll('#options-container .option-card')[k]?.dataset.reveal === 'correct',
    PLAN[i],
  );
  if (wasRight) derivedScore += 1;
  answered += 1;
  await domClick('next-btn');
  await page.waitForTimeout(380);
}
// The badge AFTER the finishing click — this is the exact sample that read "6" of 5.
const badgeAfterFinish = await read('question-number-badge');
const endScreens = await visibleScreens();
const resultShown = await isShown('result-screen');
const quizShown = await isShown('quiz-screen');
const finalScore = await read('final-score');
const finalFraction = await read('final-fraction');
const retryLabel = await read('result-retry-wrong-label');

const badgeNums = badges.map((b) => Number(b));
const maxBadge = badgeNums.length ? Math.max(...badgeNums) : -1;
const afterNum = Number(badgeAfterFinish);

/* ---- R-J1: the run TERMINATES in #result-screen ---- */
// FLOOR: >= 2 questions, and every one of them was actually answered and advanced past.
// Without it, a 0-question run lands on the result screen immediately and this reads green
// while proving that an EMPTY quiz ends — which is not the claim.
check(
  'R-J1 a complete quiz run TERMINATES in #result-screen (floor: >=2 questions, all answered)',
  ASKED.length >= 2 && answered === ASKED.length && resultShown === true && quizShown === false,
  `asked=${ASKED.length} answered=${answered} cardsAtStart=${cardsAtStart} ticked=${ticked}`
    + ` startScreens=[${startScreens}] endScreens=[${endScreens}]`
    + ` resultShown=${resultShown} quizShown=${quizShown}`
    + (ASKED.length < 2 ? '  <-- ⛔ FLOOR FAILED: fewer than 2 questions, "it ended" proves nothing' : '')
    + (resultShown === false ? '  <-- ⛔ THE RUN NEVER REACHED #result-screen (D-10)' : ''),
);

/* ---- R-J2: the question counter NEVER exceeds the total ---- */
// FLOOR: the counter must have REACHED the total. "never exceeded 5" is free if it never
// left 1 — which is the state a broken advance would produce, and the opposite defect.
const everyBadgeInRange = badgeNums.every((n) => Number.isFinite(n) && n >= 1 && n <= ASKED.length);
const afterInRange = Number.isFinite(afterNum) && afterNum >= 1 && afterNum <= ASKED.length;
check(
  'R-J2 the question counter NEVER exceeds the total, including after the finishing click (floor: it reached the total)',
  everyBadgeInRange && afterInRange && maxBadge === ASKED.length,
  `total=${ASKED.length} badges=[${badges.join(',')}] maxBadge=${maxBadge}`
    + ` badgeAfterFinishingClick=${JSON.stringify(badgeAfterFinish)} hints=[${hints.map((h) => JSON.stringify(h)).join(',')}]`
    + (maxBadge !== ASKED.length ? '  <-- ⛔ FLOOR FAILED: the counter never reached the last question, so "it never overran" is vacuous' : '')
    + (!afterInRange ? `  <-- ⛔ THE COUNTER OVERRAN: "Question ${badgeAfterFinish} of ${ASKED.length}" (D-10)` : ''),
);

/* ---- R-J3: the score shown equals the derived tally ---- */
// FLOOR: a MIX. At 0/N and N/N a tally that ignores its input can still match, so the gate
// insists the fixture produced at least one right AND at least one wrong answer.
const expectFraction = `${EXPECT_SCORE} / ${ASKED.length}`;
const expectPercent = `${Math.round((EXPECT_SCORE / ASKED.length) * 100)}%`;
check(
  'R-J3 #final-fraction and #final-score equal the tally derived IN NODE from module.json (floor: a mixed result)',
  EXPECT_SCORE > 0
    && EXPECT_WRONG > 0
    && derivedScore === EXPECT_SCORE
    && finalFraction === expectFraction
    && finalScore === expectPercent,
  `derivedInNode=${EXPECT_SCORE}/${ASKED.length} observedRevealCount=${derivedScore}`
    + ` finalFraction=${JSON.stringify(finalFraction)} expected=${JSON.stringify(expectFraction)}`
    + ` finalScore=${JSON.stringify(finalScore)} expected=${JSON.stringify(expectPercent)}`
    + ` correctIndices=[${CORRECT_AT}] plan=[${PLAN}]`
    + (EXPECT_SCORE === 0 || EXPECT_WRONG === 0
      ? '  <-- ⛔ FLOOR FAILED: the fixture is not a MIX, so a tally that ignores its input could match'
      : '')
    + (derivedScore !== EXPECT_SCORE
      ? '  <-- ⛔ the DOM reveal disagrees with the node derivation: the fixture, not the app, is wrong (shuffled bank?)'
      : ''),
);

/* ---- R-J4: the NARROWED re-run posts the ORIGINAL denominator ---- */
// ⛔⛔ THE CARRY INVARIANT, AND THE REASON THE 13 FIELDS ARE ONE REDUCER. A learner who
//     missed 4 of 5 and fixes them must finish at 5/5, NEVER 4/4: a block ticks at 100% and
//     the server re-checks `score == total`, so a narrowed run posting its own smaller
//     denominator would silently tick a block it never proved.
// FLOOR: `0 < narrowed < original`. If the narrowed set IS the original there is nothing to
// tell apart, and the assertion passes on an app with no carry at all.
await domClick('result-retry-wrong-btn');
await page.waitForTimeout(900);
const narrowedScreens = await visibleScreens();
const narrowedQuizShown = await isShown('quiz-screen');
const narrowedHint = await read('next-hint');
const narrowedCards = [];
let narrowedAnswered = 0;
// Answer them ALL correctly this time. The narrowed run is the misses, in the order they
// were missed — i.e. questions 2..N of the original, whose correct indices node already has.
for (let i = 1; i < ASKED.length; i += 1) {
  narrowedCards.push(await read('question-number-badge'));
  await page.evaluate((k) => document.querySelectorAll('#options-container .option-card')[k]?.click(), CORRECT_AT[i]);
  await page.waitForTimeout(320);
  narrowedAnswered += 1;
  await domClick('next-btn');
  await page.waitForTimeout(380);
}
const narrowedResultShown = await isShown('result-screen');
const narrowedFraction = await read('final-fraction');
const narrowedScore = await read('final-score');
const narrowedSize = EXPECT_WRONG;
// The whole point: the ORIGINAL denominator, and a perfect carried score.
const expectNarrowedFraction = `${ASKED.length} / ${ASKED.length}`;

check(
  'R-J4 the NARROWED re-run posts the ORIGINAL denominator, not its own (floor: 0 < narrowed < original)',
  narrowedSize > 0
    && narrowedSize < ASKED.length
    && narrowedQuizShown === true
    && narrowedAnswered === narrowedSize
    && narrowedResultShown === true
    && narrowedFraction === expectNarrowedFraction
    && narrowedScore === '100%',
  `original=${ASKED.length} narrowed=${narrowedSize} retryLabel=${JSON.stringify(retryLabel)}`
    + ` narrowedScreensAfterRetryClick=[${narrowedScreens}] narrowedQuizShown=${narrowedQuizShown}`
    + ` narrowedHint=${JSON.stringify(narrowedHint)} narrowedBadges=[${narrowedCards.join(',')}]`
    + ` finalFraction=${JSON.stringify(narrowedFraction)} expected=${JSON.stringify(expectNarrowedFraction)}`
    + ` finalScore=${JSON.stringify(narrowedScore)} expected="100%"`
    + (narrowedSize <= 0 || narrowedSize >= ASKED.length
      ? '  <-- ⛔ FLOOR FAILED: the narrowed set is not strictly smaller, so the two denominators are indistinguishable'
      : '')
    + (narrowedFraction === `${narrowedSize} / ${narrowedSize}`
      ? '  <-- ⛔ IT POSTED ITS OWN DENOMINATOR: the carry is broken and a partial run would tick a block'
      : '')
    + (narrowedQuizShown === false
      ? '  <-- ⛔ "Retry the N you missed" did not return to #quiz-screen (retryWrongOnly ends in startQuiz())'
      : ''),
);

/* ---- R-J5: the explanation is NOT IN THE DOM until the question is answered ---- */
// ⛔⛔ D-11. The assertion is ABSENCE, not invisibility: `.explanation-inner` must contain
//     ZERO characters while the card is closed. Clipped text is still readable by devtools,
//     by selection, by a screen reader and by a screenshot, so "it does not show" is not the
//     claim. The element itself STAYS (the frozen selector contract resolves it) — only its
//     content is withheld, which is exactly what `tmpl-quiz-option` ships (index.html:619).
// FLOORS, all three needed:
//   1. >= 2 options and a non-empty explanation PER option, derived in node from
//      module.json — otherwise "no explanation text" is true of a question that has none.
//   2. the closed sample actually saw the cards (length matches the derived option count).
//   3. after answering, EVERY card's inner is non-empty — without this an app that simply
//      never renders explanations at all reads green while being MORE broken, not less.
const OPTS_Q1 = Array.isArray(ASKED[0]?.options) ? ASKED[0].options : [];
const EXPL_Q1 = Array.isArray(ASKED[0]?.explanations) ? ASKED[0].explanations : [];
const j5Floor =
  OPTS_Q1.length >= 2
  && EXPL_Q1.length === OPTS_Q1.length
  && EXPL_Q1.every((e) => typeof e === 'string' && e.trim().length > 0)
  && Array.isArray(closedQ1) && closedQ1.length === OPTS_Q1.length
  && Array.isArray(openQ1) && openQ1.length === OPTS_Q1.length
  && openQ1.every((c) => c.innerLen > 0);
const closedEmpty = (closedQ1 || []).every((c) => c.innerLen === 0);
const leakedAt = (closedQ1 || [])
  .map((c, i) => (leaks(c.cardText, EXPL_Q1[i], OPTS_Q1[i]) ? i : -1))
  .filter((i) => i >= 0);
check(
  'R-J5 an UNANSWERED option card contains NO explanation text in the DOM, and does once answered (floor: the question HAS explanations, and all of them arrive on answer)',
  j5Floor && closedEmpty && leakedAt.length === 0,
  `options=${OPTS_Q1.length} explanationsDerivedInNode=${EXPL_Q1.length}`
    + ` closedInnerLens=[${(closedQ1 || []).map((c) => c.innerLen)}]`
    + ` openInnerLens=[${(openQ1 || []).map((c) => c.innerLen)}]`
    + ` closedInnerText=${JSON.stringify((closedQ1 || []).map((c) => c.innerText))}`
    + ` leakedTokenAtIndices=[${leakedAt}]`
    + (!j5Floor
      ? '  <-- ⛔ FLOOR FAILED: either the question carries no per-option explanations, the sample saw the wrong number of cards, or the explanations NEVER arrive — in which case "nothing leaked" is true of an app that renders nothing'
      : '')
    + (!closedEmpty
      ? '  <-- ⛔ THE ANSWER LEAKS BEFORE THE LEARNER ANSWERS (D-11): .explanation-inner is NON-EMPTY on a closed card. The correct option\'s explanation reads differently from the distractors, so the answer is identifiable without answering.'
      : '')
    + (leakedAt.length
      ? '  <-- ⛔ explanation text is parked ELSEWHERE in the closed card subtree'
      : '')
    + ' — ⛔ R-B1 CANNOT SEE THIS: its band (35 <= closed <= 45) is the PADDING and is satisfied'
    + ' at 41px whether the strip is empty or full. Do not "fix" a red here by touching R-B1.',
);

/* ---- R-J6: EVERY option resolves on answer — label, colour and dimming ---- */
// ⛔⛔ D-12. The legacy loops ALL cards (app.js:2934-2983); the port opened only the two the
//     learner touched. Asserted on QUESTION 2, which the answer plan answers WRONGLY on
//     purpose: that is the only fixture in which all three treatments exist at once — the
//     correct card (green), the learner's own wrong pick (red), and the wrong options they
//     never touched (opacity-50).
// ⛔ THE EXPECTED COUNT IS `options.length`, DERIVED IN NODE. Never `=== 4`.
// FLOOR: >= 3 options AND the pick was wrong AND at least one untouched wrong option exists,
//        or the three-way distinction the assertion makes does not exist in the fixture.
const OPTS_J6 = J6_AT >= 0 && Array.isArray(ASKED[J6_AT]?.options) ? ASKED[J6_AT].options : [];
const N2 = OPTS_J6.length;
const C2 = CORRECT_AT[J6_AT];
const P2 = PLAN[J6_AT];
const rv = revealJ6 || [];
const untouchedWrong = N2 - 2;                    // all options, minus the correct one, minus the pick
const j6Floor = J6_AT >= 0 && N2 >= 3 && P2 !== C2 && untouchedWrong >= 1 && rv.length === N2;
const expandedCount = rv.filter((c) => c.expanded === true).length;
const filledCount = rv.filter((c) => c.innerLen > 0).length;
const correctLabels = rv.filter((c) => c.label === 'Correct Answer').length;
const labelsOk = rv.every((c, i) => c.label === (i === C2 ? 'Correct Answer' : 'Incorrect'));
const labelColourOk =
  (rv[C2]?.labelClasses || '').includes('text-emerald-400')
  && rv.every((c, i) => (i === C2 ? true : (c.labelClasses || '').includes('text-brand-400')));
const borderOk =
  rv[C2]?.borderColor === 'rgb(16, 185, 129)' && rv[P2]?.borderColor === 'rgb(239, 68, 68)';
const dimOk = rv.every((c, i) =>
  i === C2 || i === P2 ? c.dimmed === false && c.opacity === 1 : c.dimmed === true && c.opacity === 0.5,
);
const answeredOk = rv.every((c) => c.answeredClass === true);
check(
  'R-J6 EVERY option resolves on answer — expanded + labelled + coloured, with opacity-50 on the untouched wrong ones (count DERIVED from options.length, floor: a wrong pick and >=3 options)',
  j6Floor
    && expandedCount === N2
    && filledCount === N2
    && correctLabels === 1
    && labelsOk
    && labelColourOk
    && borderOk
    && dimOk
    && answeredOk,
  `questionIndexChosenInNode=${J6_AT} optionsDerivedInNode=${N2} correctIndex=${C2} pickedIndex=${P2} cards=${rv.length}`
    + ` expanded=${expandedCount}/${N2} filled=${filledCount}/${N2}`
    + ` labels=${JSON.stringify(rv.map((c) => c.label))}`
    + ` labelClasses=${JSON.stringify(rv.map((c) => c.labelClasses))}`
    + ` borders=${JSON.stringify(rv.map((c) => c.borderColor))}`
    + ` opacity=[${rv.map((c) => c.opacity)}] dimmed=[${rv.map((c) => c.dimmed)}]`
    + ` answeredClass=[${rv.map((c) => c.answeredClass)}] letterBg=${JSON.stringify(rv.map((c) => c.letterBg))}`
    + (!j6Floor
      ? '  <-- ⛔ FLOOR FAILED: NO question in this block is both answered WRONGLY by the plan and carries >= 3 options (J6_AT = -1), or the sample saw the wrong number of cards — the green/red/dimmed distinction does not exist in this fixture. ⚠ ch01-b01 question 2 is TRUE/FALSE: that is why the fixture is SEARCHED FOR rather than fixed at index 1.'
      : '')
    + (j6Floor && expandedCount !== N2
      ? `  <-- ⛔ ONLY ${expandedCount} OF ${N2} CARDS REVEALED (D-12): the wrong options the learner did not pick never resolved`
      : '')
    + (j6Floor && expandedCount === N2 && !labelsOk
      ? '  <-- ⛔ the Correct Answer / Incorrect titles are missing or on the wrong card'
      : '')
    + (j6Floor && labelsOk && !borderOk
      ? '  <-- ⛔ the reveal colours are missing: #10b981 on the correct card, #ef4444 on the pick'
      : '')
    + (j6Floor && labelsOk && borderOk && !dimOk
      ? '  <-- ⛔ opacity-50 is missing (or is dimming the wrong cards). ⚠ read COMPUTED: the class means nothing if its stylesheet never shipped'
      : '')
    + ' — ⛔ NEVER `=== 4`: the count comes from the question\'s own options.length in module.json.',
);

console.log(`\nconsole/http errors during the journey: ${consoleErrors.length ? JSON.stringify(consoleErrors) : 'none'}`);
await browser.close();

console.log(`\n${results.filter((r) => r.pass).length}/${results.length} passed`);
const failed = results.filter((r) => !r.pass);
if (failed.length) console.log('FAILED: ' + failed.map((r) => r.id).join(', '));
if (failed.length) process.exit(1);
