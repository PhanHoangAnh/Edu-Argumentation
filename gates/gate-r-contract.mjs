#!/usr/bin/env node
/**
 * gate-r-contract.mjs — ⚑ THE FLAGSHIP R- GATE: the frozen DOM contract resolves in the
 * MOUNTED REACT DOM.
 *
 * edu-replatform Phase 03, checklist E1c. Tier 1/2, browser-backed.
 *
 * WHAT IT DOES
 *   Drives a STATE SWEEP — library -> narrow viewport -> book selected -> reader ->
 *   reader on an equation block -> reader on an exercise block (multiple-choice mode) ->
 *   quiz setup -> quiz -> settings -> ask — and asserts every contract entry resolves
 *   **>=1 time ACROSS the sweep**, never per page. `.option-card` only exists once an
 *   exercise is in choose-mode; `[data-block="*"]` only after a book is loaded. A per-page
 *   assertion would be red on a correct app.
 *
 * ⛔⛔ THE SWEEP ITERATES ALL **NINE** CATEGORIES ACTUALLY PRESENT IN THE FROZEN FILE:
 *       ids · classes.ours · classes.thirdParty · attributes · attributeExpressions ·
 *       tags · pseudo · hashRoutes · selectors
 *     ⛔ THE PLAN'S PROSE NAMES A CATEGORY THAT DOES NOT EXIST ON DISK — `katexClasses`.
 *        Measured 21/22-09-26: `classes` is NESTED `{ours, thirdParty}`, there is no
 *        `katexClasses` key, and `knownAbsent` is an ARRAY. A sweep written from the prose
 *        iterates a missing key, silently skips two real ones, and reads green.
 *     ⛔ `attributeExpressions` is ABSENT FROM THE CONTRACT'S OWN `counts` BLOCK. A sweep
 *        that enumerates `counts` skips the whole category — the one holding
 *        `[aria-current="true"]` and `[id$="-screen"]`. The category list below is derived
 *        from the FILE, and R-C5 asserts every top-level category was reached.
 *     ⛔ `attributes` holds BARE ATTRIBUTE NAMES (`aria-current`, `data-block`, …), not
 *        selectors. They are resolved as `[name]`. Passing them to querySelectorAll raw
 *        throws, and a try/catch around it would score them as "invalid" forever.
 *
 * ⛔ IT READS selector-contract.FROZEN.json, NEVER THE REGENERATED FILE.
 *    `gen-selector-contract.mjs` generates the contract FROM THE GATE SOURCES, so a React
 *    suite that queries fewer things regenerates a smaller contract and passes against it.
 *    That is A-G17's failure in a new costume. RS-FROZEN-SOURCE (gate-r-self.mjs) enforces it.
 *
 * ⛔ `?? []` ON knownAbsent IS BANNED. An empty list makes R-C3 ("each entry genuinely does
 *    not resolve") vacuously true. R-C2 asserts the list is non-empty AND exactly
 *    ['#home-screen'], so a second phantom cannot be added to dodge a red gate.
 *
 * ⛔ #home-screen IS A GENUINE PHANTOM, NOT A MISSING ELEMENT — in the contract's `ids`,
 *    queried by b15probe.mjs:12, and absent from the legacy index.html. DO NOT CREATE AN
 *    ELEMENT TO SATISFY A TYPO.
 *
 * ⛔⛔ R-C0 IS THE FLOOR THAT MAKES THE WHOLE FILE MEAN ANYTHING. The sweep runs against the
 *    LOCAL preview. That is only a claim about the deployed product if the local preview is
 *    serving the SAME BYTES. R-C0 compares the local index.html sha256 against :8792's.
 *    Without it this suite measures a build nobody is running.
 */
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.env.R_BASE || 'http://127.0.0.1:8795';
const REMOTE = process.env.R_REMOTE || 'http://192.168.100.66:8767';  // P6b 24-09-26: was :8792 (retired)
const MODULE = process.env.R_MODULE || 'geron-homl3';
const FROZEN = path.join(DIR, 'selector-contract.frozen.json');

/* ─────────────────────────────────────────────────────────────────────────────
 * DECLARED PHASE-03 GAPS — the contract entries that genuinely do NOT resolve in
 * the React port yet, each with the reason it does not.
 *
 * ⛔ THIS IS **NOT** `knownAbsent`, AND IT MUST NEVER BE MERGED INTO IT. `knownAbsent`
 *    is a property of the CONTRACT (a phantom selector that was never real). This is a
 *    property of THIS PORT at THIS PHASE — work that is not done yet.
 *
 * ⛔ IT HAS TEETH IN BOTH DIRECTIONS (R-C6). A gap that starts resolving turns this gate
 *    RED until the entry is deleted from the list; an unlisted miss turns R-C1 RED. An
 *    allowance you can grow silently is not an allowance, it is a hole — which is exactly
 *    what an `?? []` does to knownAbsent, and why that is banned two paragraphs up.
 * ───────────────────────────────────────────────────────────────────────────── */
const PHASE_03_DECLARED_GAPS = {
  'selectors #library-grid input[type="text"]':
    'the library rename input is a WRITE and belongs to Phase 04 (slice A3 declared it). '
    + '⛔ Do NOT fake it with a disabled input to turn this gate green.',
  /* ⚑ TWO ENTRIES ADDED 23-09-26 — A USER RULING, NOT A RED BEING QUIETED. The user, verbatim:
   *   "there is an upload button on the top bar of the UI, which open the filesystem upload
   *    interface. Replace that with the logout button since we already have the correct import
   *    button on the home page." The top bar's #custom-data-upload <input type="file"> and its
   *   <label for> are therefore DELETED from the product. The frozen file is sha-pinned and is NOT
   *   re-frozen; the two entries are declared here instead, so R-C6's reverse teeth hold: if the
   *   upload ever comes back, R-C6 prints NOW RESOLVING and goes red. gate-r-style.mjs R-S-NOFILE
   *   asserts the positive side (no top-bar control reaches a file input). */
  'attributeExpressions [for="custom-data-upload"]':
    'ruled removed 23-09-26 (user): the top-bar upload is replaced by LOG OUT; Import on the home page stays.',
  'selectors label[for="custom-data-upload"] svg':
    'ruled removed 23-09-26 (user): the top-bar upload icon is replaced by LOG OUT.',
  /* ⚑ FOUR ENTRIES DELETED 22-09-26 — BY THIS GATE'S OWN INSTRUCTION, and it is the gate
   *   getting STRICTER, not looser. They were:
   *       selectors #options-container .option-card
   *       selectors #options-container .option-card .option-text
   *       selectors #options-container .option-card .explanation-inner
   *       selectors #options-container .option-card .explanation-text
   *   all one defect — G-EVL-2, "the quiz never populates": `#setup-start-btn` was wired to
   *   `onStart={() => setScreen('quiz')}` (AppShell.tsx:210) and nothing dispatched
   *   `run/reset`, so `#options-container` rendered zero option cards.
   *
   *   The fix (quiz/QuizSetupScreen.start, via the EXISTING `run/reset` + `scope/set` actions)
   *   made all four RESOLVE, so R-C6's reverse teeth fired exactly as designed and printed
   *       ⛔ NOW RESOLVING (delete it from PHASE_03_DECLARED_GAPS): ...
   *   Deleting them is what that message demands. ⛔ The effect is the OPPOSITE of an
   *   allowance: R-C1's allowed-misses drop 6 -> 2 and these four are now REQUIRED to resolve
   *   on every future run. Measured across the sweep: resolved 106/112 -> 110/112.
   *   ⛔ Never re-add an entry here to quiet a red. The list shrinks as work lands; it grows
   *      only for a gap that is declared, reasoned and out of scope — like the one above. */
};

const results = [];
const check = (id, pass, detail) => {
  results.push({ id, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${id}  ${detail}`);
};

const contract = JSON.parse(fs.readFileSync(FROZEN, 'utf8'));

/* ---- the nine categories, DERIVED FROM THE FILE, never from the plan's prose ---- */
const CATEGORY_SOURCES = {
  ids: contract.ids,
  'classes.ours': contract.classes?.ours,
  'classes.thirdParty': contract.classes?.thirdParty,
  attributes: contract.attributes,
  attributeExpressions: contract.attributeExpressions,
  tags: contract.tags,
  pseudo: contract.pseudo,
  hashRoutes: contract.hashRoutes,
  selectors: contract.selectors,
};
// Everything in the frozen file that is an object-of-entries, so a NEW category added by a
// future re-freeze cannot slip past the nine hard-coded above.
const NON_CATEGORY_KEYS = new Set(['counts', 'knownAbsentEvidence', 'classes']);
const discovered = Object.entries(contract)
  .filter(([k, v]) => !NON_CATEGORY_KEYS.has(k) && v && typeof v === 'object' && !Array.isArray(v))
  .map(([k]) => k)
  .concat(['classes.ours', 'classes.thirdParty']);

const entries = [];
for (const [cat, obj] of Object.entries(CATEGORY_SOURCES)) {
  for (const key of Object.keys(obj || {})) entries.push({ cat, key, id: `${cat} ${key}` });
}

/* ---- R-C5 FIRST: prove the sweep is about to iterate every category on disk ---- */
const missedCategories = discovered.filter((d) => !(d in CATEGORY_SOURCES));
const perCat = Object.fromEntries(Object.entries(CATEGORY_SOURCES).map(([c, o]) => [c, Object.keys(o || {}).length]));
const emptyCats = Object.entries(perCat).filter(([, n]) => n === 0).map(([c]) => c);
check('R-C5 the sweep iterates EVERY category present in the frozen file (incl. attributeExpressions)',
  missedCategories.length === 0 && emptyCats.length === 0 && entries.length > 0,
  `categories=${JSON.stringify(perCat)} total=${entries.length}`
  + (missedCategories.length ? ` <-- UNITERATED ON DISK: ${missedCategories.join(',')}` : '')
  + (emptyCats.length ? ` <-- EMPTY (a missing key reads as zero entries): ${emptyCats.join(',')}` : '')
  + ' — note: the plan names a `katexClasses` category that DOES NOT EXIST on disk;'
  + ' `classes` is nested {ours,thirdParty} and `attributeExpressions` is absent from `counts`');

/* ---- R-C4: the frozen file is the pinned one, and it was not re-frozen smaller ---- */
// The pin is read OUT OF gate-r-self.mjs rather than retyped: two copies of one hash drift,
// and the drift is silent.
const selfSrc = fs.readFileSync(path.join(DIR, 'gate-r-self.mjs'), 'utf8');
const pinned = (selfSrc.match(/FROZEN_SHA\s*=\s*'([0-9a-f]{64})'/) || [])[1] || 'NO-PIN-FOUND';
const frozenSha = createHash('sha256').update(fs.readFileSync(FROZEN)).digest('hex');
check('R-C4 counts.selectors === 47 AND the frozen sha256 equals gate-r-self.mjs\'s pin',
  contract.counts?.selectors === 47 && frozenSha === pinned && pinned !== 'NO-PIN-FOUND',
  `counts.selectors=${contract.counts?.selectors} sha=${frozenSha} pin=${pinned} (pin READ FROM gate-r-self.mjs — never retyped)`);

/* ---- R-C2: knownAbsent, exactly, non-empty, no `?? []` ---- */
const knownAbsent = contract.knownAbsent;
check('R-C2 knownAbsent is EXACTLY ["#home-screen"] and NON-EMPTY (`?? []` is banned)',
  Array.isArray(knownAbsent) && knownAbsent.length === 1 && knownAbsent[0] === '#home-screen',
  `knownAbsent=${JSON.stringify(knownAbsent)} — an empty list makes R-C3 vacuously true`);

/* ═══════════════════════ the state sweep ═══════════════════════ */
const browser = await chromium.launch({ executablePath: process.env.GATE_CHROME || chromium.executablePath() });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await ctx.newPage();

// Resolution is evaluated IN THE PAGE. `attributes` are bare names -> `[name]`;
// `:scope` forms are relative and are resolved against #tutorial-article, which is how
// gate-a.mjs uses them; hashRoutes is a location.hash SHAPE, not a selector.
const RESOLVE_FN = `(items) => items.map(({ cat, key }) => {
  try {
    // ⚑ Phase 06a (ruling R25): the reader's ROUTE moved from #chapter=N&block=N to a path,
    //   /<book>/<unit>-N/<M>-<slug>. The frozen (sha-pinned) contract keeps its hashRoutes entry;
    //   it resolves through its successor, the path form. A route in NEITHER shape still misses.
    if (cat === 'hashRoutes') return (/^#chapter=\\d+&block=\\d+$/.test(location.hash)
      || /^\\/[a-z0-9-]+\\/[a-z]+-\\d+\\/\\d+(-[a-z0-9-]*)?(\\/quiz)?$/.test(location.pathname)) ? 1 : 0;
    if (cat === 'attributes') return document.querySelectorAll('[' + key + ']').length ? 1 : 0;
    if (key === ':scope' || key.startsWith(':scope')) {
      const host = document.getElementById('tutorial-article');
      if (!host) return 0;
      return host.querySelectorAll(key === ':scope' ? ':scope > *' : key).length ? 1 : 0;
    }
    // '[data-book="*"]' is a contract WILDCARD, not a literal attribute value.
    return document.querySelectorAll(key.replace(/="\\*"/g, '')).length ? 1 : 0;
  } catch { return -1; }
})`;

const firstSeenIn = new Map();
const invalid = new Set();
const statesVisited = [];
async function sample(state) {
  statesVisited.push(state);
  const res = await page.evaluate(
    ([fnSrc, items]) => eval('(' + fnSrc + ')')(items),
    [RESOLVE_FN, entries.map(({ cat, key }) => ({ cat, key }))],
  );
  entries.forEach((e, i) => {
    if (res[i] === -1) invalid.add(e.id);
    if (res[i] === 1 && !firstSeenIn.has(e.id)) firstSeenIn.set(e.id, state);
  });
}

const gotoBlock = async (chapterIdx, blockIdx) => {
  await page.evaluate(([c, b]) => {
    const d = document.querySelectorAll('#toc-nav details')[c];
    if (!d) return;
    d.open = true;
    const btns = d.querySelectorAll('ol li button');
    if (btns[b]) btns[b].click();
  }, [chapterIdx, blockIdx]);
  await page.waitForTimeout(1300);
};

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
await sample('library');

// The hamburger is md:hidden -> it has no box at 1440. `#menu-btn svg` is only reachable narrow.
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(450);
await sample('narrow-viewport');
await page.setViewportSize({ width: 1440, height: 1000 });
await page.waitForTimeout(450);

// ⛔⛔ THE CARD CLICK IS A **TOGGLE**, NOT AN "OPEN" — REPAIRED 22-09-26 (EVL fix cycle 1).
//
//     ⚠ THIS IS A NAVIGATION-STEP REPAIR. ⛔ NO ASSERTION CHANGED, no expected count changed
//       (R-C0..R-C6, still 7 result lines). Recorded in full because editing a gate is exactly
//       the move this program forbids when it is done to make something pass — so here is the
//       measurement instead of an argument.
//
//     WHAT WAS WRONG: this step used to click UNCONDITIONALLY, assuming the click OPENS the
//     book. The legacy is a toggle — `openBook(file)` at aws-quiz-app/js/app.js:605-608 reads
//         if (file === activeBookFile) { closeBook(); return; }
//     The step only ever looked correct because the React port had a DEFECT (G-EVL-1): it never
//     auto-opened a book, so the first click always opened one. The sweep was therefore
//     CALIBRATED TO THE DEFECT, and fixing the product inverted it. Measured on the built
//     bundle, 22-09-26, `#setup-tree input[data-block]` / `#tutorial-main-title`:
//         after page load        boxes=310  title="What Machine Learning Actually Is"   OPEN
//         after 1 card click     boxes=0    title="Theory block 1"  (the placeholder)   CLOSED
//         after 2 card clicks    boxes=310  title="What Machine Learning Actually Is"   OPEN
//     Left as-is, the four states named 'book-selected', 'reader', 'reader-equation' and
//     'reader-exercise-choose' would all have been sampled against a CLOSED book — i.e. the
//     sweep would measure an empty reader while claiming to measure a loaded one. That is
//     strictly LESS assertion power, which is why leaving it was not the safe option.
//
//     WHAT IT IS NOW: idempotent, and the precondition is CHECKED rather than assumed. The
//     throw is deliberate in preference to a new PASS/FAIL line: a thrown gate exits non-zero,
//     which run-gates-react.sh reports as `EXIT <n> <-- FAIL`, so the suite still goes red —
//     without moving the frozen R- vector count by adding an eighth result line.
const bookIsOpen = () =>
  page.evaluate(
    (m) =>
      document.querySelector(`#library-grid [data-book="${m}"]`)?.getAttribute('aria-current') === 'true',
    MODULE,
  );
if (!(await bookIsOpen())) {
  await page.locator(`#library-grid [data-book="${MODULE}"]`).click();
  await page.waitForTimeout(1500);
}
if (!(await bookIsOpen())) {
  throw new Error(
    `⛔ SWEEP PRECONDITION FAILED: ${MODULE} is not the open book after the card step.` +
      ' Every state from here on would be sampled against a CLOSED book, so the sweep would' +
      ' measure an empty reader while reporting on a loaded one. Refusing to continue.',
  );
}
await sample('book-selected');

await page.locator('#read-tutorial-btn').click();
await page.waitForTimeout(1500);
await sample('reader');

await gotoBlock(1, 2);            // ch.2 block 3 — the RMSE radical. `.katex .sqrt`, `.vlist-t`.
await sample('reader-equation');

await gotoBlock(0, 11);           // ch.1 "End-of-chapter exercises" — the ONLY source of .option-card
// ⛔ The panel opens in WRITE mode. Without this click there are zero option cards and the
//    four `.option-*` / `.explanation-*` class entries read as missing on a correct build.
await page.evaluate(() => {
  for (const b of document.querySelectorAll('button')) {
    if (b.textContent.trim() === 'Multiple choice' && !b.disabled) { b.click(); return; }
  }
});
await page.waitForTimeout(1000);
await sample('reader-exercise-choose');

await page.locator('#nav-quiz').click();
await page.waitForTimeout(1200);
await sample('quiz-setup');
await page.locator('#setup-all-btn').click();
await page.waitForTimeout(600);
await page.locator('#setup-start-btn').click();
await page.waitForTimeout(1800);
await sample('quiz');

// ⛔ .click() via the locator TIMES OUT here: the header nav has no box while the quiz screen
//    is up. The DOM click is deliberate — the sweep is about what RESOLVES, not about hit-testing.
await page.evaluate(() => document.getElementById('nav-settings')?.click());
await page.waitForTimeout(1000);
await sample('settings');

await page.evaluate(() => document.getElementById('ask-fab')?.click());
await page.waitForTimeout(1000);
await sample('ask');

/* ---- R-C0: the floor — the local preview is serving the DEPLOYED bytes ---- */
let localSha = 'UNREAD';
let remoteSha = 'UNREAD';
try {
  // ⚑ Phase 06a: `/` now needs a session (302 signed out); `/login` serves the SAME document to
  //   anyone, so both sides are read there — the comparison stays byte-for-byte on one document.
  //   `--no-gate-session` (lib/auth-preload.mjs) keeps this ONE call signed out: a signed-in /login
  //   redirects home and would hash an empty body.
  localSha = createHash('sha256').update(execFileSync('curl', ['--no-gate-session', '-s', '-m', '20', BASE + '/login'])).digest('hex');
} catch { /* leave UNREAD */ }
try {
  remoteSha = createHash('sha256').update(execFileSync('curl', ['-s', '-m', '25', REMOTE + '/login'])).digest('hex');
} catch { /* leave UNREAD */ }
check('R-C0 FLOOR: the LOCAL preview serves byte-identical index.html to the DEPLOYED study app (:8767 since P6b)',
  localSha === remoteSha && localSha !== 'UNREAD',
  `local(${BASE})=${localSha} remote(${REMOTE})=${remoteSha} — without this the sweep measures a build nobody runs`);

/* ---- R-C1: everything resolves except knownAbsent and the declared gaps ---- */
const allowed = new Set([
  ...knownAbsent.map((k) => `ids ${k}`),
  ...knownAbsent.map((k) => `selectors ${k}`),
  ...Object.keys(PHASE_03_DECLARED_GAPS),
]);
const unresolved = entries.filter((e) => !firstSeenIn.has(e.id)).map((e) => e.id);
const unexpected = unresolved.filter((id) => !allowed.has(id));
check('R-C1 every frozen-contract entry resolves >=1 time ACROSS the sweep (not per page)',
  unexpected.length === 0 && invalid.size === 0 && firstSeenIn.size > 0 && entries.length > 0,
  `resolved=${firstSeenIn.size}/${entries.length} states=${statesVisited.length}[${statesVisited.join(',')}]`
  + ` allowed-misses=${unresolved.length}`
  + (unexpected.length ? ` <-- UNEXPECTED MISSES: ${unexpected.join(' | ')}` : '')
  + (invalid.size ? ` <-- INVALID SELECTORS: ${[...invalid].join(' | ')}` : ''));

/* ---- R-C3: each knownAbsent entry genuinely does NOT resolve ---- */
const stillPresent = knownAbsent.filter((k) => firstSeenIn.has(`ids ${k}`) || firstSeenIn.has(`selectors ${k}`));
check('R-C3 each knownAbsent entry genuinely does NOT resolve anywhere in the sweep',
  Array.isArray(knownAbsent) && knownAbsent.length > 0 && stillPresent.length === 0,
  knownAbsent.length === 0
    ? '⛔ FLOOR FAILED: knownAbsent is empty, so this assertion proves nothing'
    : `checked=${knownAbsent.length} ${JSON.stringify(knownAbsent)} stillPresent=${JSON.stringify(stillPresent)}`
      + ' — a phantom that starts resolving must be DELETED from knownAbsent, not left to rot');

/* ---- R-C6: the declared-gap list is EXACT, in both directions ---- */
const gapIds = Object.keys(PHASE_03_DECLARED_GAPS);
const gapsThatResolve = gapIds.filter((id) => firstSeenIn.has(id));
const gapsNotInContract = gapIds.filter((id) => !entries.some((e) => e.id === id));
check(`R-C6 the ${gapIds.length} declared Phase-03 gaps are EXACT: each is a real contract entry and each is genuinely unresolved`,
  gapIds.length > 0 && gapsThatResolve.length === 0 && gapsNotInContract.length === 0,
  gapsThatResolve.length
    ? `⛔ NOW RESOLVING (delete it from PHASE_03_DECLARED_GAPS): ${gapsThatResolve.join(' | ')}`
    : gapsNotInContract.length
      ? `⛔ NOT A CONTRACT ENTRY (stale list): ${gapsNotInContract.join(' | ')}`
      : `${gapIds.length} gaps, all genuinely absent: ${gapIds.join(' | ')}`
        + ' — 1 is the Phase-04 rename input; 2 are the top-bar upload, removed by user ruling 23-09-26');

await browser.close();

console.log(`\n${results.filter((r) => r.pass).length}/${results.length} passed`);
const failed = results.filter((r) => !r.pass);
if (failed.length) console.log('FAILED: ' + failed.map((r) => r.id).join(', '));
if (failed.length) process.exit(1);
