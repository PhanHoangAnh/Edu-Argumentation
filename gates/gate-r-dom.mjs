#!/usr/bin/env node
/**
 * gate-r-dom.mjs — R-suite: THE PRINT CONTRACT, THE EQUATIONS, AND THE THEME PURGE, all
 * measured against the MOUNTED REACT DOM.
 *
 * edu-replatform Phase 03, checklist E1b + E1d (+ the Exit Gate's theme-purge row).
 * Tier 1/2, browser-backed. Target $R_BASE (the LOCAL preview; gate-r-contract.mjs's R-C0
 * is the floor proving that preview serves the DEPLOYED bytes).
 *
 * ═══ E1b — THE PRINT CONTRACT ═══════════════════════════════════════════════════════
 * ⛔ THE PLAN'S ORIGINAL A-G12 INSTRUCTION IS DELETED AND MUST NOT BE REVIVED. It said to
 *    rewrite gate-a.mjs:269-287 to use emulateMedia + getComputedStyle. Measured on disk:
 *    IT ALREADY DOES. Rewriting it would have broken a correct gate.
 * ⛔ "ALL 14 #ids RESOLVE" IS VACUOUS AS A PRINT CHECK. The ids survive whether or not the
 *    @media print block made it out of the legacy inline <style> and into the built CSS.
 *    So it is SUPPLEMENTARY (R-P3), never the primary. R-P1 is A-G12's own shape against
 *    the React DOM; R-P2 reads the RULE TEXT, scoped to inside the @media print block —
 *    a file-wide grep is partly vacuous because 11 of the 14 ids also appear in screen rules.
 *
 * ═══ E1d — A-G17 ANTI-VACUITY ═══════════════════════════════════════════════════════
 * ⛔ NO SYNTHETIC FIXTURE. A-G17 passed 21/21 against the UNFIXED file until each test
 *    equation was wrapped in a real <figure class="my-8">, because the defect lives in
 *    `#tutorial-content figure svg { height: auto }` and an equation rendered outside a
 *    <figure> never reproduces it. Here the REAL rendered reader is the fixture:
 *    run-gates-react.sh refuses to start without the real geron-homl3, so production is the
 *    fixture and its shape cannot drift.
 * ⛔ THE `total === 21` LITERAL IS DEAD. The expectation is DERIVED, in NODE, from the
 *    source module.json — independently of the browser that measures it. That independence
 *    is the whole point: a derivation computed from the same DOM it checks is a tautology.
 * ⛔ THE `> 0` FLOOR IS LOAD-BEARING. Without it, rendering NOTHING is green — and the
 *    defect this program just fixed was equations rendering the book's PICTURE instead of
 *    KaTeX, which is exactly a "nothing rendered" shape.
 * ⚠ 88 of 90 equations carry BOTH `latex` and `src`. There are ZERO latex-only equations.
 *   Until 22-09-26 they all took a bare <img> branch.
 * ⛔ THE FIX STAYS .katex-SCOPED (R-G17c). A-G18 exists because an unscoped `svg { }` rule
 *   relayouts the brand logo, the upload icon and the hamburger.
 *
 * ═══ THE THEME PURGE ════════════════════════════════════════════════════════════════
 * ⚠ THE EXIT GATE SAYS "9 literal theme class strings". MEASURED: THERE ARE **10**
 *   (THEME_TITLE_CLASS, PanelBlock.tsx:28-39). The count is DERIVED from the source, never
 *   typed in — a literal 9 would go green while missing an entry.
 * ⛔ THE "BUILT CSS" HALF OF THAT ROW DOES NOT APPLY TO :8792. The React app is still on the
 *   TAILWIND CDN (index.html pins cdn.tailwindcss.com?plugins=typography); the CDN->build
 *   swap shipped on :8767 only (ruling R8). So the literals are asserted in the BUILT JS
 *   BUNDLE, which is what the CDN's JIT scanner reads. gate-c-theme.mjs covers the legacy
 *   app's built CSS. Recorded rather than quietly re-scoped.
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
// R_REPO lets a COPY of this gate run from outside gates/ (fault-injection harness).
// Default is the real tree, so a normal run needs no environment at all.
const REPO = process.env.R_REPO || path.resolve(DIR, '..');
const BASE = process.env.R_BASE || 'http://127.0.0.1:8795';
const MODULE = process.env.R_MODULE || 'geron-homl3';
const REPORT_MODULE = process.env.R_REPORT_MODULE || 'demo-book';
const LIB_ROOT = process.env.R_LIB_ROOT || '/var/tmp/edu-smoke/lib';
const DIST = process.env.R_DIST || path.join(REPO, 'app/frontend/dist');

const results = [];
const check = (id, pass, detail) => {
  results.push({ id, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${id}  ${detail}`);
};

/* ═════════ derivations, in NODE, from SOURCE — never from the DOM being measured ═════════ */

// The 14 print ids, read out of the LEGACY inline <style>'s @media print block. Derived,
// so a 15th rule added upstream is picked up instead of silently ignored. Colour hexes
// (#fff, #bbb, #f6f6f6) are excluded: they are values, not selectors.
const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
// ⛔ `indexOf('@media print')` IS WRONG AND READS ZERO IDS. The legacy index.html mentions
//    "@media print" inside a COMMENT 489 characters before the real at-rule, so a plain
//    indexOf brace-matches the wrong block and the derivation silently returns an EMPTY
//    list — which would make R-P2 and R-P3 vacuously true. Match the AT-RULE shape
//    (`@media print {`), take every occurrence, and union them.
function idsInPrintBlock(text) {
  const re = /@media\s+print\s*\{/g;
  const found = new Set();
  let blocks = 0;
  let m = re.exec(text);
  while (m) {
    const j = m.index + m[0].length - 1;
    let depth = 0;
    let end = -1;
    for (let k = j; k < text.length; k += 1) {
      if (text[k] === '{') depth += 1;
      else if (text[k] === '}') { depth -= 1; if (depth === 0) { end = k; break; } }
    }
    if (end > 0) {
      blocks += 1;
      (text.slice(j, end + 1).match(/#[a-zA-Z][\w-]*/g) || []).forEach((s2) => { if (!HEX.test(s2)) found.add(s2); });
    }
    m = re.exec(text);
  }
  return blocks === 0 ? null : [...found].sort();
}
const legacyIndex = fs.readFileSync(path.join(REPO, 'aws-quiz-app/index.html'), 'utf8');
const PRINT_IDS = idsInPrintBlock(legacyIndex) || [];

// ⛔ DECLARED PARITY GAP, exact and non-empty — the same discipline as the contract's
//    knownAbsent. These two legacy affordances have NO React equivalent: the port uses
//    #toc-summary for the ToC toggle and #block-ai-quiz-btn for the block quiz. Their print
//    rules are therefore inert (they hide elements that do not exist) — harmless, but the
//    claim "all 14 resolve" is FALSE and is not going to be papered over.
// ⛔ DO NOT CREATE ELEMENTS TO SATISFY THIS LIST.
// ⛑ CLOSED 23-09-26 (Phase 04): both are REAL legacy affordances — the contents toggle and
//    Begin Assessment (the main way a block is completed) — that the port had dropped. They were
//    restored FOR PARITY, not to satisfy this list, and this gate itself reported "NOW PRESENT".
//    The list is now EMPTY and R-P3 asserts all 14 print ids resolve. Re-add an id here only for
//    a legacy affordance that genuinely has no React equivalent, with the reason.
const PRINT_ID_DECLARED_ABSENT = [];

// Radical-bearing equations, derived from the READER-VISIBLE half of module.json
// (tutorialData). ⚠ A whole-file walk returns 21 — that count includes quiz questions and
// assets the reader never renders, and gate-a.mjs's fixture uses it. The reader sweep can
// only see what the reader renders, so the derivation is scoped to match.
const modulePath = path.join(LIB_ROOT, MODULE, 'module.json');
const moduleJson = JSON.parse(fs.readFileSync(modulePath, 'utf8'));
const RADICAL = (s) => s.includes('\\sqrt') || s.includes('\\overline');
function latexIn(node, acc = []) {
  if (Array.isArray(node)) { node.forEach((n) => latexIn(n, acc)); return acc; }
  if (node && typeof node === 'object') {
    if (typeof node.latex === 'string') acc.push(node.latex);
    Object.values(node).forEach((v) => latexIn(v, acc));
  }
  return acc;
}
const sections = moduleJson.tutorialData?.sections || [];
const radicalBlocks = [];
let derivedEquations = 0;
let derivedSqrtNodes = 0;
sections.forEach((sec, ci) => {
  (sec.items || []).forEach((item, bi) => {
    const rad = latexIn(item).filter(RADICAL);
    if (!rad.length) return;
    radicalBlocks.push({ ci, bi, eq: rad.length });
    derivedEquations += rad.length;
    derivedSqrtNodes += rad.reduce((n, l) => n + (l.match(/\\sqrt/g) || []).length, 0);
  });
});

// The theme lookup, derived from source. ⚠ TEN entries, not the nine the plan names.
const panelSrc = fs.readFileSync(path.join(REPO, 'app/frontend/src/reader/blocks/PanelBlock.tsx'), 'utf8');
const lookupBody = (panelSrc.match(/THEME_TITLE_CLASS[^=]*=\s*\{([\s\S]*?)\n\};/) || [])[1] || '';
const THEME_CLASS_STRINGS = [...lookupBody.matchAll(/:\s*'([^']+)'/g)].map((m) => m[1]);

const distJs = fs.readdirSync(path.join(DIST, 'assets')).filter((f) => f.endsWith('.js'));
const distCss = fs.readdirSync(path.join(DIST, 'assets')).filter((f) => f.endsWith('.css'));
const bundleJs = distJs.map((f) => fs.readFileSync(path.join(DIST, 'assets', f), 'utf8')).join('\n');
const bundleCss = distCss.map((f) => fs.readFileSync(path.join(DIST, 'assets', f), 'utf8')).join('\n');

/* ═════════ R-P2: the @media print RULE TEXT survived the port into the BUILT CSS ═════════ */
const builtPrintIds = idsInPrintBlock(bundleCss);
const missingFromBuilt = builtPrintIds ? PRINT_IDS.filter((i) => !builtPrintIds.includes(i)) : PRINT_IDS;
check(`R-P2 all ${PRINT_IDS.length} print ids appear INSIDE the built CSS's @media print block (scoped, not a file-wide grep)`,
  PRINT_IDS.length > 0 && builtPrintIds !== null && missingFromBuilt.length === 0,
  builtPrintIds === null
    ? '⛔ NO @media print BLOCK IN THE BUILT CSS — the block did not make it out of the legacy inline <style>'
    : `derived ${PRINT_IDS.length} from aws-quiz-app/index.html, found ${builtPrintIds.length} in ${distCss.join(',')}`
      + (missingFromBuilt.length ? ` <-- MISSING: ${missingFromBuilt.join(' ')}` : '')
      + ' (a file-wide grep is partly vacuous: 11 of the 14 also appear in screen rules)');

/* ═════════ R-T1: the theme class strings are COMPLETE LITERALS in the bundle ═════════ */
const themeMissing = THEME_CLASS_STRINGS.filter((s) => !bundleJs.includes(s));
check(`R-T1 all ${THEME_CLASS_STRINGS.length} theme title class strings are COMPLETE LITERALS in the built JS (never interpolated)`,
  THEME_CLASS_STRINGS.length > 0 && themeMissing.length === 0,
  `derived=${THEME_CLASS_STRINGS.length} from PanelBlock.tsx (⚠ the plan says 9; there are ${THEME_CLASS_STRINGS.length})`
  + (themeMissing.length ? ` <-- MISSING: ${themeMissing.join(' | ')}` : ' — all present')
  + ` — the app is on the TAILWIND CDN, so the JIT scanner reads the JS; the built-CSS half of this row belongs to :8767 (gate-c-theme.mjs)`);

/* ═══════════════════════════ the browser half ═══════════════════════════ */
const browser = await chromium.launch({ executablePath: process.env.GATE_CHROME || chromium.executablePath() });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await ctx.newPage();

const gotoBlock = async (ci, bi) => {
  await page.evaluate(([c, b]) => {
    const d = document.querySelectorAll('#toc-nav details')[c];
    if (!d) return;
    d.open = true;
    const btns = d.querySelectorAll('ol li button');
    if (btns[b]) btns[b].click();
  }, [ci, bi]);
  await page.waitForTimeout(1200);
};

// ⛔⛔ THE CARD CLICK IS A **TOGGLE**, NOT AN "OPEN" — REPAIRED 22-09-26 (EVL fix cycle 1).
//     Identical defect, identical repair, to gate-r-contract.mjs's 'book-selected' step; read
//     that file's note for the full reasoning. ⚠ NAVIGATION ONLY — ⛔ no assertion changed, no
//     expected count changed (this file stays 8 result lines — 9 since R-LAB, 24-09-26).
//
//     WHAT WAS WRONG: the unconditional click assumed it OPENS. The legacy toggles —
//     aws-quiz-app/js/app.js:605-608, `if (file === activeBookFile) { closeBook(); return; }`.
//     The step only looked right while the React port carried defect G-EVL-1 (it never
//     auto-opened a book, so the first click always opened one).
//
//     THE NATURAL CONTROL THAT PROVES IT IS THE TOGGLE AND NOT A RENDER REGRESSION: this gate
//     sweeps TWO books. `geron-homl3` is the auto-opened default, so the click CLOSED it;
//     `demo-book` is not, so the click still OPENED it. Measured in the same run, 22-09-26:
//         geron-homl3   measured=0   mismatch = all 19 chapters   <- closed by the click
//         demo-book     measured=4   noPanel=5   fallback=0       <- unchanged, still green
//     And measured directly against the DEPLOYED :8792, block ch2/b3 (the RMSE radical):
//         LEARN only, no card click : sqrt=1  figuresWithSqrt=1  scrollHeight=6184  <- CORRECT
//         card click first          : sqrt=0  figuresWithSqrt=0  scrollHeight=0     <- closed
//     So R-G17a/b, R-T2 and R-P1 were all measuring a CLOSED book while reporting on an open
//     one — strictly LESS assertion power, which is why leaving it was not the safe option.
//
//     NOW: idempotent, and the precondition is CHECKED rather than assumed. The throw is
//     deliberate in preference to a new PASS/FAIL line — a thrown gate exits non-zero, which
//     run-gates-react.sh reports as `EXIT <n> <-- FAIL`, so the suite still goes red without
//     moving the frozen R- vector count.
const bookIsOpen = (book) =>
  page.evaluate(
    (b) =>
      document.querySelector(`#library-grid [data-book="${b}"]`)?.getAttribute('aria-current') === 'true',
    book,
  );

const openBook = async (book) => {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1100);
  if (!(await bookIsOpen(book))) {
    await page.locator(`#library-grid [data-book="${book}"]`).click();
    await page.waitForTimeout(1500);
  }
  if (!(await bookIsOpen(book))) {
    throw new Error(
      `⛔ OPEN-BOOK PRECONDITION FAILED: ${book} is not the open book after the card step.` +
        ' Everything measured from here would come from a CLOSED book — zero radicals, zero' +
        ' panels, an empty article — while being reported as an open one. Refusing to continue.',
    );
  }
  await page.locator('#read-tutorial-btn').click();
  await page.waitForTimeout(1400);
};

await openBook(MODULE);

/* ---- R-G17: sweep the REAL reader, block by block ---- */
const MEASURE_FN = `() => {
  const root = document.getElementById('tutorial-content');
  if (!root) return { root: false, sqrt: [], figuresWithSqrt: 0, katex: 0 };
  const sqrts = [...root.querySelectorAll('.katex .sqrt')];
  const figs = new Set();
  const rows = sqrts.map((s) => {
    const svg = s.querySelector('svg');
    const vl = s.querySelector('.vlist-t');
    const fig = s.closest('figure');
    if (fig) figs.add(fig);
    const sh = svg ? svg.getBoundingClientRect().height : 0;
    const rh = vl ? vl.getBoundingClientRect().height : 0;
    return {
      inFigure: fig !== null,
      inTutorialContent: s.closest('#tutorial-content') !== null,
      svgH: +sh.toFixed(1),
      radicandH: +rh.toFixed(1),
      covers: sh > 0 && rh > 0 && sh >= 0.9 * rh,
    };
  });
  return { root: true, sqrt: rows, figuresWithSqrt: figs.size, katex: root.querySelectorAll('.katex').length };
}`;

let measuredSqrt = 0;
let measuredFigures = 0;
const bad = [];
const escaped = [];
for (const blk of radicalBlocks) {
  await gotoBlock(blk.ci, blk.bi);
  const m = await page.evaluate((src) => eval('(' + src + ')')(), MEASURE_FN);
  if (!m.root) { bad.push(`ch${blk.ci + 1}/b${blk.bi + 1}: NO #tutorial-content`); continue; }
  measuredSqrt += m.sqrt.length;
  measuredFigures += m.figuresWithSqrt;
  m.sqrt.forEach((r, i) => {
    if (!r.covers) bad.push(`ch${blk.ci + 1}/b${blk.bi + 1}#${i}: svg ${r.svgH} vs radicand ${r.radicandH}`);
    if (!r.inFigure || !r.inTutorialContent) {
      escaped.push(`ch${blk.ci + 1}/b${blk.bi + 1}#${i}: figure=${r.inFigure} tutorialContent=${r.inTutorialContent}`);
    }
  });
}

check('R-G17a radical equations: DERIVED from module.json in node === MEASURED in the React DOM (the `=== 21` literal is dead)',
  derivedEquations > 0 && derivedSqrtNodes > 0 && measuredSqrt > 0
  && measuredSqrt === derivedSqrtNodes && measuredFigures === derivedEquations && bad.length === 0,
  `blocks=${radicalBlocks.length} derivedEquations=${derivedEquations} derivedSqrtNodes=${derivedSqrtNodes}`
  + ` measuredSqrtNodes=${measuredSqrt} measuredFiguresWithSqrt=${measuredFigures} bad=${bad.length}`
  + (bad.length ? ` ${JSON.stringify(bad.slice(0, 4))}` : '')
  + ' — ⛔ the `> 0` floors are what stop "nothing rendered" reading green');

check('R-G17b every rendered radical is contained: closest("figure") !== null AND closest("#tutorial-content") !== null',
  measuredSqrt > 0 && escaped.length === 0,
  measuredSqrt === 0
    ? '⛔ FLOOR FAILED: zero radicals rendered, so containment proves nothing'
    : `checked=${measuredSqrt} escaped=${escaped.length}${escaped.length ? ' ' + JSON.stringify(escaped.slice(0, 4)) : ''}`
      + ' — a radical outside its <figure> never reproduces `#tutorial-content figure svg{height:auto}`, which is how A-G17 went vacuous');

/* ---- R-G17c: the height fix is .katex-SCOPED, and nothing else relayouted ---- */
// ⛔ SCAN ONLY RULES WHOSE SELECTOR TARGETS <svg>. A naive `height: inherit` text scan also
//    matches `line-height: inherit` on three prose rules and reports them as "unscoped svg
//    rules" — a false red on correct CSS. Measured 22-09-26.
const svgHeightRules = [...bundleCss.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .map((m) => ({ sel: m[1].trim(), body: m[2] }))
  .filter((r) => /(^|[\s>+~,])svg$/.test(r.sel) && /(^|[;{\s])height\s*:/.test(r.body));
const katexRules = svgHeightRules.filter((r) => /\.katex/.test(r.sel)).map((r) => `${r.sel}{${r.body}}`);
// Allowed scopes: `.katex …` (the fix) and `#tutorial-content figure …` (the legacy rule the
// fix corrects). ANY OTHER svg-height rule can reach the brand logo / upload icon / hamburger.
const unscoped = svgHeightRules
  .filter((r) => !/\.katex/.test(r.sel) && !/#tutorial-content\s+figure/.test(r.sel))
  .map((r) => `${r.sel}{${r.body}}`);
// ⚠ Chrome is sampled on the LIBRARY screen, NOT in the reader: the upload label lives on
//   the landing page and measures 0x0 once the reader is open — a hidden element measures
//   0x0 and `0 >= 0.9*0` is true, which is exactly the vacuity A-G18's E5 note warns about.
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
const chrome = await page.evaluate(() => {
  const pick = (sel) => {
    const e = document.querySelector(sel);
    if (!e) return { found: false };
    const r = e.getBoundingClientRect();
    return { found: true, w: +r.width.toFixed(1), h: +r.height.toFixed(1) };
  };
  // ⚑ 23-09-26 (user ruling): the top-bar upload icon is GONE (replaced by the text entry LOG OUT),
  //   so the chrome SVGs are now the logo and the hamburger. `upload` is recorded as ABSENT and
  //   asserted absent, so the icon cannot silently come back either.
  return { logo: pick('#brand-home svg'), uploadGone: !document.querySelector('label[for="custom-data-upload"]') };
});
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(400);
chrome.burger = await page.evaluate(() => {
  const e = document.querySelector('#menu-btn svg');
  if (!e) return { found: false };
  const r = e.getBoundingClientRect();
  return { found: true, w: +r.width.toFixed(1), h: +r.height.toFixed(1) };
});
await page.setViewportSize({ width: 1440, height: 1000 });
await page.waitForTimeout(400);
const chromeOk = ['logo', 'burger'].every((k) => chrome[k].found && chrome[k].w > 0 && chrome[k].h > 0) && chrome.uploadGone === true;
check('R-G17c the height:inherit fix is .katex-SCOPED and the chrome SVGs still have non-zero boxes (A-G18 analogue)',
  katexRules.length > 0 && unscoped.length === 0 && chromeOk,
  `svg-height rules=${svgHeightRules.length} katex-scoped=${JSON.stringify(katexRules)} unscoped=${JSON.stringify(unscoped)} chrome=${JSON.stringify(chrome)}`
  + ' — an unscoped `svg{}` rule relayouts the brand logo and the hamburger (the upload icon was removed by user ruling 23-09-26)');

/* ---- R-T2: zero [data-theme-fallback] over BOTH books ----------------------------------
 * ⛔⛔ TWO VACUITIES WERE MEASURED OUT OF THIS GATE ON 22-09-26. Both read GREEN on a book
 *    that really did carry an unknown theme (ch.4 forced to `fuchsia-500`):
 *      1. VISITING ONE BLOCK PER CHAPTER. The [data-theme-fallback] stamp only appears on a
 *         block that renders a NON-CALLOUT titled panel. Chapter 4's block 0 has none, so it
 *         stamped 0; blocks 1, 3 and 4 stamped 2 each.
 *      2. A LOOSE PANEL DETECTOR. `/text-[a-z]+-\\d00/` also matches `text-brand-400` on the
 *         block's own chrome, so every chapter "found a panel" immediately and the search
 *         never moved. The detector now matches the EXACT class strings from the lookup.
 * ⛔ THE TARGET BLOCK IS **DERIVED FROM module.json IN NODE**, never found by scanning. A
 *    scan needs a cap, and a cap is silently wrong: demo-book chapter 9's first themed panel
 *    is at block index 11, so a 10-block cap declared that chapter unmeasurable.
 * ⚠ 5 of demo-book's 9 chapters contain NO themed panel AT ALL. They are recorded as
 *    `noPanel` and are not a failure — there is nothing there to stamp.
 */
const PANEL_SKIP = new Set(['callout', 'text', 'figure', 'diagram', 'equation', 'code_cells']);
function firstPanelBlockPerChapter(mod) {
  return (mod.tutorialData?.sections || []).map((sec) => {
    const items = sec.items || [];
    for (let bi = 0; bi < items.length; bi += 1) {
      if ((items[bi].blocks || []).some((b) => !PANEL_SKIP.has(b.type) && b.title)) return bi;
    }
    return null;
  });
}
const THEMED_PANEL_FN = `(known) => {
  const root = document.getElementById('tutorial-content');
  if (!root) return { panels: 0, fallback: 0 };
  const set = new Set(known);
  // ⛔ getAttribute('class'), NOT e.className: on an <svg> className is an SVGAnimatedString, so
  //    .trim() THROWS. Phase 04 put the legacy's own SVGs (the "Go deeper" chevron, the code-cell
  //    icons) inside #tutorial-content and the gate crashed after 5 of its 8 lines (23-09-26).
  const titles = [...root.querySelectorAll('[class]')].filter((e) => set.has((e.getAttribute('class') || '').trim())).length;
  const fb = root.querySelectorAll('[data-theme-fallback]').length;
  return { panels: titles + fb, fallback: fb };
}`;

const themeSweep = [];
for (const book of [MODULE, REPORT_MODULE]) {
  const mod = JSON.parse(fs.readFileSync(path.join(LIB_ROOT, book, 'module.json'), 'utf8'));
  const targets = firstPanelBlockPerChapter(mod);
  await openBook(book);
  let fallback = 0;
  let measured = 0;
  const mismatch = [];
  const noPanel = [];
  for (let c = 0; c < targets.length; c += 1) {
    if (targets[c] === null) { noPanel.push(c + 1); continue; }
    await gotoBlock(c, targets[c]);
    const r = await page.evaluate(([src, known]) => eval('(' + src + ')')(known), [THEMED_PANEL_FN, THEME_CLASS_STRINGS]);
    fallback += r.fallback;
    if (r.panels > 0) measured += 1; else mismatch.push(`ch${c + 1}/b${targets[c] + 1}`);
  }
  themeSweep.push({ book, chapters: targets.length, measured, noPanel: noPanel.length, fallback, mismatch });
}
const anyFallback = themeSweep.reduce((n, s) => n + s.fallback, 0);
const anyMismatch = themeSweep.reduce((n, s) => n + s.mismatch.length, 0);
const anyMeasured = themeSweep.reduce((n, s) => n + s.measured, 0);
check('R-T2 ZERO [data-theme-fallback] across BOTH books — floor: every DERIVED panel block really rendered a panel',
  themeSweep.length === 2 && anyMeasured > 0 && anyMismatch === 0 && anyFallback === 0,
  `${JSON.stringify(themeSweep)}`
  + ' — ⛔ one-block-per-chapter, or a loose `text-*-N00` detector, reads GREEN on a book that'
  + ' really carries an unknown theme (both proven 22-09-26 with ch.4 forced to fuchsia-500)');

/* ---- R-LAB (G-reader, 24-09-26, plan D8/D9): numbered title + the Lab link ONLY on a code lesson ----
   ch02-b07 has a Full-script card (code) and ch01-b01 has none — both measured on this fixture with
   lab/backend/library.py's D5 rule. The href names the book by MODULE id, opens a new tab, noopener. */
await openBook(MODULE);
const readerFacts = () => page.evaluate(() => {
  const a = document.getElementById('lab-open-btn');
  return { title: document.getElementById('tutorial-main-title')?.textContent?.trim() || '',
    lab: a ? { href: a.getAttribute('href'), target: a.getAttribute('target'), rel: a.getAttribute('rel') || '', text: a.getAttribute('aria-label') } : null };
});
await gotoBlock(1, 6);
const codeLesson = await readerFacts();
await gotoBlock(0, 0);
const plainLesson = await readerFacts();
check('R-LAB reader title is "<n>. <term>"; a code lesson carries #lab-open-btn -> /lab/<moduleId>/<chNN-bMM> (new tab, noopener); a no-code lesson carries none',
  /^7\. \S/.test(codeLesson.title) && /^1\. \S/.test(plainLesson.title)
  && codeLesson.lab !== null && codeLesson.lab.href === `/lab/${MODULE}/ch02-b07` && codeLesson.lab.target === '_blank'
  && codeLesson.lab.rel.split(/\s+/).includes('noopener') && codeLesson.lab.text === 'Lab'
  && plainLesson.lab === null,
  JSON.stringify({ codeLesson, plainLesson }));

/* ---- R-P1 PRIMARY: A-G12's own shape, against the React DOM ---- */
await openBook(MODULE);
await gotoBlock(1, 2);
const domIds = await page.evaluate((ids) => Object.fromEntries(ids.map((i) => [i, document.querySelectorAll(i).length])), PRINT_IDS);
await page.emulateMedia({ media: 'print' });
await page.waitForTimeout(500);
const p1 = await page.evaluate(() => {
  const art = document.getElementById('tutorial-article');
  const sec = document.getElementById('content-section');
  if (!art || !sec) return { found: false };
  return {
    found: true,
    bodyOverflow: getComputedStyle(document.body).overflow,
    artOverflowY: getComputedStyle(art).overflowY,
    artScrollHeight: art.scrollHeight,
    vh: window.innerHeight,
    secPaddingTop: getComputedStyle(sec).paddingTop,
  };
});
await page.emulateMedia({ media: 'screen' });
check('R-P1 PRIMARY print contract (emulateMedia + getComputedStyle) — body/article overflow visible, article taller than the viewport, section padding 0',
  p1.found === true
  && p1.bodyOverflow === 'visible'
  && p1.artOverflowY === 'visible'
  && p1.artScrollHeight > p1.vh
  && parseFloat(p1.secPaddingTop) === 0,
  `${JSON.stringify(p1)} — RED WHEN the @media print block did not reach the built CSS, which the id list alone CANNOT see`);

/* ---- R-P3 SUPPLEMENTARY: the print ids in the React DOM, with the parity gap named ---- */
const resolved = PRINT_IDS.filter((i) => domIds[i] > 0);
const absent = PRINT_IDS.filter((i) => !domIds[i]);
const unexpectedAbsent = absent.filter((i) => !PRINT_ID_DECLARED_ABSENT.includes(i));
const declaredButPresent = PRINT_ID_DECLARED_ABSENT.filter((i) => domIds[i] > 0);
check(`R-P3 SUPPLEMENTARY (never the primary): ${PRINT_IDS.length} print ids in the React DOM — ${PRINT_ID_DECLARED_ABSENT.length} declared absent, exactly`,
  PRINT_IDS.length > 0 && unexpectedAbsent.length === 0 && declaredButPresent.length === 0
  && resolved.length === PRINT_IDS.length - PRINT_ID_DECLARED_ABSENT.length,
  `resolved=${resolved.length}/${PRINT_IDS.length} declaredAbsent=${JSON.stringify(PRINT_ID_DECLARED_ABSENT)}`
  + (unexpectedAbsent.length ? ` <-- UNEXPECTED ABSENT: ${unexpectedAbsent.join(' ')}` : '')
  + (declaredButPresent.length ? ` <-- NOW PRESENT, delete it from the list: ${declaredButPresent.join(' ')}` : '')
  + ' — the Phase-03 gap (#toc-toggle-btn, #tutorial-to-quiz-btn) is closed by the Phase-04 parity port.');

await browser.close();

console.log(`\n${results.filter((r) => r.pass).length}/${results.length} passed`);
const failed = results.filter((r) => !r.pass);
if (failed.length) console.log('FAILED: ' + failed.map((r) => r.id).join(', '));
if (failed.length) process.exit(1);
