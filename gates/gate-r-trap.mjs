#!/usr/bin/env node
/**
 * gate-r-trap.mjs — THE SEVEN EXIT-GATE ASSERTIONS THAT HAD NO COMMAND ANYWHERE.
 *
 * edu-replatform Phase 03, EVL cycle 2 (gap G-EVL-4). Tier 1/2, browser-backed.
 * Target $R_BASE (the LOCAL preview; gate-r-contract.mjs's R-C0 is the floor that proves
 * the preview serves the DEPLOYED bytes, so a claim made here is a claim about :8792).
 *
 * ⛔⛔ WHY THIS FILE EXISTS. Slice A4BF SPECIFIED all seven of these WITH their anti-vacuity
 *    floors; slice E2 implemented none of them and declared none of them as gaps. They were
 *    therefore NEITHER PASSING NOR FAILING — ABSENT — and the R- vector of 45 was about to be
 *    frozen as Phase 04's fence in that state. Five agent reports, two vector runs and a full
 *    Exit Gate pass all read green over the hole. It surfaced only when a verifier ran the
 *    gate list from THE PLAN against THE SUITE. ⚠ No gate can do that for itself; this file
 *    is the repair, not the mechanism that found it.
 *
 * THE SEVEN (plan §Step B / §Step A / §Step F, and the Exit Gate's "reader's traps" block):
 *   R-B1   the 0fr->1fr reveal          band + ratio + the >= 35 floor (B1b)
 *   R-B3   the reader-mode height chain capped pane + a page that does not scroll
 *   R-B5b  DOM IDENTITY of the two OptionCard call sites (never a class-NAME check)
 *   R-B6b  the portal hazard            containment + a rect that really goes to zero
 *   R-B7   scroll reset on visibility   floored on scrollHeight > clientHeight + 200 (B7b)
 *   R-A2c  library order across a REFETCH, against a DELIBERATELY RESHUFFLED payload
 *   R-F1   R6 survival: DOM order == blocks[] order, + the four-condition placement gate
 *   R-F1c  both visual renderers emit <figure> INSIDE #tutorial-content
 *   (R-F1 and R-F1c are the two halves of the plan's single "R-F1/R-F1c" row.)
 *
 * ⛔ THREE THINGS THIS FILE REFUSES TO DO, each because the program has already been bitten:
 *   1. NO STALE LITERAL. R-B1 is a BAND AND A RATIO, never `=== 41`. That literal is
 *      `px-6 pb-6 pt-4` (16+24) plus a 1px `border-t`, so a legitimate padding change would
 *      turn a CORRECT build red — the class that bit F-1 and A-G17's `total === 21`.
 *   2. NO SYNTHETIC FIXTURE. Every measurement below is taken from the REAL rendered app
 *      driven through its REAL navigation. run-gates-react.sh refuses to start without the
 *      real books, so production is the fixture and its shape cannot drift.
 *   3. NO ASSERTION WITHOUT A FLOOR. Each check states, in its own detail line, the
 *      condition under which it would have proven nothing — and asserts that condition is
 *      NOT the one it is standing in.
 *
 * ⚠⚠ ONE SPECIFIED ASSERTION IS VACUOUS AS WRITTEN AND IS **KEPT PLUS FLOORED**, NOT SWAPPED.
 *    The plan's R-B6b says `offsetParent === null` after navigating away. MEASURED 22-09-26:
 *    `#action-container` is `position: fixed`, and `offsetParent` is null FOR A FIXED ELEMENT
 *    BY SPEC — true while the bar is on screen at 1440x49 px, true while it is hidden, true
 *    under `createPortal`. It can never go red, so alone it is exactly the vacuous gate this
 *    program has now found fourteen of. It is still ASSERTED and PRINTED (the plan's word is
 *    not quietly dropped), and the load-bearing half is the BOUNDING RECT, which is 49x1440
 *    when the bar is up and 0x0 once `#quiz-screen` goes `display:none` — and which stays
 *    non-zero under a portal, because a portalled bar is no longer inside the hidden screen.
 */
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
// R_REPO lets a COPY of this gate run from outside gates/ (the fault-injection harness).
const REPO = process.env.R_REPO || path.resolve(DIR, '..');
const BASE = process.env.R_BASE || 'http://127.0.0.1:8795';
const MODULE = process.env.R_MODULE || 'geron-homl3';
const REPORT_MODULE = process.env.R_REPORT_MODULE || 'demo-book';
const LIB_ROOT = process.env.R_LIB_ROOT || '/var/tmp/edu-smoke/lib';
const PY = process.env.R_SYS_PY || 'python3';

const results = [];
const check = (id, pass, detail) => {
  results.push({ id, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${id}  ${detail}`);
};

/* ═════════ derivations, in NODE, from SOURCE — never from the DOM being measured ═════════ */

const VISUAL_TYPES = new Set(['figure', 'diagram', 'equation']);
const moduleJson = JSON.parse(fs.readFileSync(path.join(LIB_ROOT, MODULE, 'module.json'), 'utf8'));
const sections = moduleJson.tutorialData?.sections || [];
const blocksOf = (ci, bi) => (sections[ci]?.items?.[bi]?.blocks || []);

// Every block of chapter 1 that carries at least one visual. Chapter 1 is chosen because it
// carries BOTH renderer branches (block 2 alone has four asset-panel figures and one inline
// SVG), so R-F1c's "both branches" floor is reachable without a second book open.
const F1_BLOCKS = (sections[0]?.items || [])
  .map((item, bi) => ({ bi, blocks: item.blocks || [] }))
  .filter((x) => x.blocks.some((b) => VISUAL_TYPES.has(b.type)))
  .map((x) => x.bi);

// The SHAPE a correct render must produce, derived in node: for each block index, is it a
// visual, and if so which of the two renderers owns it. The predicate is the dispatcher's
// own, written as the SAME EXPRESSION (BlockRenderer.tsx / app.js appendTheoryContent) so
// the two cannot drift:  equation || (figure && src && !svg)  ->  assetPanel.
const rendererOf = (b) => {
  if (!VISUAL_TYPES.has(b.type)) return null;
  if (b.type === 'equation' || (b.type === 'figure' && b.src && !b.svg)) return 'assetPanel';
  if (b.svg) return 'inlineSvg';
  return 'inlineImg';
};
const expectedShape = (ci, bi) =>
  blocksOf(ci, bi).map((b) => ({
    visual: VISUAL_TYPES.has(b.type),
    renderer: rendererOf(b),
    src: typeof b.src === 'string' ? b.src.split('/').pop() : null,
  }));

/* ═════════ the browser ═════════ */
const browser = await chromium.launch({ executablePath: process.env.GATE_CHROME || chromium.executablePath() });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await ctx.newPage();

// ⛔ THE CARD CLICK IS A **TOGGLE**, NOT AN "OPEN". Same repair, same reasoning, as
//    gate-r-contract.mjs and gate-r-dom.mjs — read either file's note. The precondition is
//    CHECKED, not assumed: a throw exits non-zero, which run-gates-react.sh reports as
//    `EXIT <n> <-- FAIL`, so the suite goes red without moving this file's result count.
const bookIsOpen = (book) =>
  page.evaluate(
    (b) => document.querySelector(`#library-grid [data-book="${b}"]`)?.getAttribute('aria-current') === 'true',
    book,
  );
const openReader = async (book) => {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1100);
  if (!(await bookIsOpen(book))) {
    await page.locator(`#library-grid [data-book="${book}"]`).click();
    await page.waitForTimeout(1500);
  }
  if (!(await bookIsOpen(book))) {
    throw new Error(
      `⛔ OPEN-BOOK PRECONDITION FAILED: ${book} is not the open book after the card step.`
      + ' Every measurement from here would come from a CLOSED book — an empty article, zero'
      + ' figures, an unscrollable pane — while being reported as an open one. Refusing to continue.',
    );
  }
  await page.locator('#read-tutorial-btn').click();
  await page.waitForTimeout(1400);
};
const gotoBlock = async (ci, bi) => {
  await page.evaluate(([c, b]) => {
    const d = document.querySelectorAll('#toc-nav details')[c];
    if (!d) return;
    d.open = true;
    const btns = d.querySelectorAll('ol li button');
    if (btns[b]) btns[b].click();
  }, [ci, bi]);
  await page.waitForTimeout(1300);
};

/* ═══════════════════════════════════════════════════════════════════════════════════════
 * R-A2c — the library order survives a REFETCH.
 *
 * ⛔⛔ THE OBVIOUS IMPLEMENTATION IS VACUOUS AND IS NOT THE ONE BELOW. "Force a refetch,
 *    assert [data-book] order unchanged" proves NOTHING if the server answers in the same
 *    order both times: an order derived in a `select`/`useMemo` over query data — the exact
 *    defect A2c exists to reject — reproduces that order perfectly and reads GREEN.
 *    So the SECOND response is DELIBERATELY RESHUFFLED on the wire, and the reshuffle is
 *    itself asserted (the floor). Only a snapshot held OUTSIDE the query cache, behind
 *    LibraryProvider's `hasSeeded` ref, can keep the DOM order under that.
 *
 * ⚠ The app pins `refetchOnWindowFocus: false` (main.tsx), so a focus event does NOT
 *   refetch — measured. `refetchOnReconnect` is left at its default true, so the refetch is
 *   driven by the online/offline events TanStack's onlineManager subscribes to. The request
 *   COUNT is asserted, so a future config change that kills the refetch turns this red
 *   rather than silently making it vacuous again.
 * ═══════════════════════════════════════════════════════════════════════════════════════ */
{
  const payloads = [];
  let calls = 0;
  await page.route('**/api/modules*', async (route) => {
    calls += 1;
    const res = await route.fetch();
    const body = await res.json();
    const books = Array.isArray(body?.books) ? body.books : [];
    // First response: untouched. Every later one: REVERSED on the wire.
    const out = calls === 1 ? books : [...books].reverse();
    payloads.push(out.map((b) => b.file));
    await route.fulfill({ response: res, json: { ...body, books: out } });
  });

  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1300);
  const domBefore = await page.evaluate(() =>
    [...document.querySelectorAll('#library-grid [data-book]')].map((e) => e.getAttribute('data-book')));

  await page.evaluate(() => {
    window.dispatchEvent(new Event('offline'));
    window.dispatchEvent(new Event('online'));
  });
  await page.waitForTimeout(2000);
  const domAfter = await page.evaluate(() =>
    [...document.querySelectorAll('#library-grid [data-book]')].map((e) => e.getAttribute('data-book')));

  const enoughCards = domBefore.length >= 2;
  const refetched = calls >= 2;
  const payloadReshuffled = payloads.length >= 2
    && JSON.stringify(payloads[0]) !== JSON.stringify(payloads[payloads.length - 1]);
  const orderHeld = JSON.stringify(domBefore) === JSON.stringify(domAfter);

  check('R-A2c library order survives a refetch whose payload was DELIBERATELY RESHUFFLED on the wire',
    enoughCards && refetched && payloadReshuffled && orderHeld,
    `cards=${domBefore.length} moduleRequests=${calls} wirePayloads=${JSON.stringify(payloads)}`
    + ` domBefore=${JSON.stringify(domBefore)} domAfter=${JSON.stringify(domAfter)}`
    + (!enoughCards ? ' <-- ⛔ FLOOR FAILED: fewer than 2 cards, so "order unchanged" is trivially true' : '')
    + (!refetched ? ' <-- ⛔ FLOOR FAILED: no second /api/modules request, so nothing was refetched' : '')
    + (!payloadReshuffled ? ' <-- ⛔ FLOOR FAILED: the second payload was NOT reshuffled, so a select/useMemo-derived order would also read green' : '')
    + (!orderHeld ? ' <-- ⛔ A CARD MOVED: libraryOrder is following the query cache instead of LibraryProvider\'s hasSeeded snapshot' : ''));
  await page.unroute('**/api/modules*');
}

/* ═══════════════════════════════════════════════════════════════════════════════════════
 * R-B3 / R-B7 / R-F1 / R-F1c — the reader.
 * ═══════════════════════════════════════════════════════════════════════════════════════ */
await openReader(MODULE);

/* ---- R-F1: DOM order IS blocks[] order, and the shipped R6 placement still holds ---- */
// ⛔ "the figures are all present" is NOT this assertion. R6 is about POSITION: the failure
//    it names is read -> scroll down -> scroll up -> resume. So the comparison is POSITIONAL,
//    child-index by child-index, against blocks[] — which goes red on filtering, CSS `order:`,
//    float, a figure footer, or an asset-id sort (⚠ fig-4-16 is deliberately emitted BEFORE
//    fig-4-14: the order is PROSE-MENTION order, not numeric order).
const orderRows = [];
for (const bi of F1_BLOCKS) {
  await gotoBlock(0, bi);
  const measured = await page.evaluate(() => {
    const root = document.getElementById('tutorial-content');
    if (!root) return null;
    return [...root.children].map((el) => {
      const img = el.tagName === 'FIGURE' ? el.querySelector('img') : null;
      return {
        figure: el.tagName === 'FIGURE',
        inTutorialContent: el.closest('#tutorial-content') !== null,
        inlineSvg: !!el.querySelector(':scope > div > svg'),
        assetPanel: !!el.querySelector('.katex') || !!el.querySelector('div.bg-white'),
        src: img ? (img.getAttribute('src') || '').split('/').pop() : null,
      };
    });
  });
  orderRows.push({ bi, expected: expectedShape(0, bi), measured });
}
const orderProblems = [];
let visualsMeasured = 0;
let inlineSvgSeen = 0;
let assetPanelSeen = 0;
let figuresOutside = 0;
for (const row of orderRows) {
  if (!row.measured) { orderProblems.push(`ch1/b${row.bi + 1}: NO #tutorial-content`); continue; }
  if (row.measured.length !== row.expected.length) {
    orderProblems.push(`ch1/b${row.bi + 1}: ${row.measured.length} rendered children vs ${row.expected.length} blocks[]`);
    continue;
  }
  row.expected.forEach((exp, i) => {
    const got = row.measured[i];
    if (exp.visual !== got.figure) {
      orderProblems.push(`ch1/b${row.bi + 1}#${i}: blocks[] says visual=${exp.visual}, DOM says <figure>=${got.figure}`);
      return;
    }
    if (!exp.visual) return;
    visualsMeasured += 1;
    if (!got.inTutorialContent) figuresOutside += 1;
    if (got.inlineSvg) inlineSvgSeen += 1;
    if (got.assetPanel) assetPanelSeen += 1;
    if (exp.src && got.src && exp.src !== got.src) {
      orderProblems.push(`ch1/b${row.bi + 1}#${i}: expected ${exp.src}, rendered ${got.src}`);
    }
  });
}

// The four-condition placement gate — the SHIPPED, FAULT-PROVED implementation
// (tools/check_inline_figures.py gate_placement), re-run against the book library rather
// than re-written here. ⛔ The ruling's FIRST wording is VOID: it reported
// `checked=326 failures=0` GREEN against the UNFIXED file.
const placement = [];
for (const book of [MODULE, REPORT_MODULE]) {
  try {
    const out = execFileSync(PY, ['-c', [
      'import json,sys',
      `sys.path.insert(0, ${JSON.stringify(path.join(REPO, 'tools'))})`,
      'from check_inline_figures import gate_placement',
      `d=json.load(open(${JSON.stringify(path.join(LIB_ROOT, book, 'module.json'))},encoding="utf-8"))`,
      'c,f,s,det,r=gate_placement(d)',
      'print("%d %d %d" % (c,f,s))',
    ].join('\n')], { encoding: 'utf8', timeout: 240000 }).trim().split(/\s+/).map(Number);
    placement.push({ book, checked: out[0], failures: out[1], notApplicable: out[2] });
  } catch (e) {
    placement.push({ book, checked: -1, failures: -1, error: String(e.message || e).slice(0, 120) });
  }
}
const placementChecked = placement.reduce((n, p) => n + Math.max(p.checked, 0), 0);
const placementFailures = placement.reduce((n, p) => n + (p.failures === 0 ? 0 : 1), 0);

check('R-F1 R6 SURVIVAL: #tutorial-content child order IS blocks[] order, and the four-condition placement gate is still green',
  orderRows.length > 0 && visualsMeasured > 0 && orderProblems.length === 0
  && placementChecked > 0 && placementFailures === 0,
  `blocksSwept=${orderRows.length} visualsMeasured=${visualsMeasured} orderProblems=${orderProblems.length}`
  + (orderProblems.length ? ` ${JSON.stringify(orderProblems.slice(0, 4))}` : '')
  + ` placement=${JSON.stringify(placement)}`
  + ' — ⛔ FLOORS: zero blocks swept or zero visuals measured proves nothing (a closed book renders'
  + ' both as 0), and `checked>0` is what stops the placement half passing on an empty walk;'
  + ' ⛔ the ruling\'s FIRST placement wording is VOID — it read GREEN on the unfixed file');

check('R-F1c BOTH visual renderers (assetPanel AND the inline figure-with-svg branch) emit <figure> INSIDE #tutorial-content',
  visualsMeasured > 0 && inlineSvgSeen > 0 && assetPanelSeen > 0 && figuresOutside === 0,
  `visuals=${visualsMeasured} assetPanelBranch=${assetPanelSeen} inlineSvgBranch=${inlineSvgSeen} outsideTutorialContent=${figuresOutside}`
  + (inlineSvgSeen === 0 ? ' <-- ⛔ FLOOR FAILED: the inline-SVG branch never rendered, so "both renderers" was never tested' : '')
  + (assetPanelSeen === 0 ? ' <-- ⛔ FLOOR FAILED: the asset-panel branch never rendered, so "both renderers" was never tested' : '')
  + ' — if either renderer emits something other than a <figure>, A-G17 goes VACUOUS: it passed'
  + ' 21/21 on the unfixed file until every test equation sat in a real <figure>');

/* ---- R-B3: the body.reader-mode 100dvh / min-h-0 chain, gated on the pane's HEIGHT ---- */
// The chain's whole job: the PANE scrolls and the PAGE does not. So the assertion is
// (a) the pane is capped at the viewport and (b) the document itself does not scroll.
// ⛔ FLOOR: the block must be TALLER than the viewport. On a short block a capped pane and an
//    uncapped one measure the same, and this would pass on a build with no chain at all.
const longest = F1_BLOCKS.length
  ? F1_BLOCKS.reduce((best, bi) => (blocksOf(0, bi).length > blocksOf(0, best).length ? bi : best), F1_BLOCKS[0])
  : 0;
await gotoBlock(0, longest);
const b3 = await page.evaluate(() => {
  const a = document.getElementById('tutorial-article');
  const sec = document.getElementById('content-section');
  if (!a || !sec) return { found: false };
  return {
    found: true,
    readerMode: document.body.classList.contains('reader-mode'),
    bodyOverflow: getComputedStyle(document.body).overflow,
    artOverflowY: getComputedStyle(a).overflowY,
    artMinHeight: getComputedStyle(a).minHeight,
    secMinHeight: getComputedStyle(sec).minHeight,
    clientH: a.clientHeight,
    scrollH: a.scrollHeight,
    innerH: window.innerHeight,
    docScrollH: document.scrollingElement.scrollHeight,
  };
});
const b3ContentTaller = b3.found && b3.scrollH > b3.innerH;           // the floor
const b3PaneCapped = b3.found && b3.clientH > 200 && b3.clientH <= b3.innerH;
// ⚠ `document.scrollingElement.scrollHeight` is REPORTED, NOT ASSERTED, and that is a
//    deliberate narrowing: `body.reader-mode` sets `overflow: hidden`, so the document CANNOT
//    scroll whatever its scrollHeight says — asserting the number would be asserting something
//    other than the property, and it is exactly the kind of borrowed condition that reds a
//    correct build. The page-does-not-scroll half is carried by `bodyOverflow === 'hidden'`,
//    which is a real condition and goes red the moment reader-mode's CSS is dropped.
check('R-B3 the body.reader-mode 100dvh / min-h-0 chain resolves: the scroll container is CAPPED AT THE VIEWPORT and the body does not scroll',
  b3.found && b3.readerMode === true && b3.artOverflowY === 'auto' && b3.bodyOverflow === 'hidden'
  && b3ContentTaller && b3PaneCapped,
  `${JSON.stringify(b3)} block=ch1/b${longest + 1}`
  + (!b3ContentTaller ? ' <-- ⛔ FLOOR FAILED: this block is shorter than the viewport, so a capped pane and an uncapped one measure the same' : '')
  + (!b3PaneCapped ? ` <-- ⛔ PANE NOT CAPPED: clientHeight ${b3.clientH} vs viewport ${b3.innerH} — the pane grew to its content, so the chain is broken` : '')
  + (b3.found && b3.bodyOverflow !== 'hidden' ? ` <-- ⛔ body.reader-mode's overflow:hidden is GONE (${b3.bodyOverflow}), so the page scrolls behind the pane` : '')
  + ' — ⚠ `min-h-0` reads like noise and IS the mechanism: a flex child defaults to min-height:auto'
  + ' ("never shrink below my content"), so one missing min-h-0 anywhere in the chain makes the pane'
  + ' grow while the layout still LOOKS correct');

/* ---- R-B7: scroll reset on a cursor change, FLOORED on the pane actually scrolling ---- */
// ⛔ B7b. On a short block scrollHeight <= clientHeight, "scrollTop === 0" is true of a pane
//    that never scrolled, and the gate proves nothing. The floor is asserted FIRST.
const b7Floor = await page.evaluate(() => {
  const a = document.getElementById('tutorial-article');
  return a ? { scrollH: a.scrollHeight, clientH: a.clientHeight } : null;
});
const b7Scrollable = !!b7Floor && b7Floor.scrollH > b7Floor.clientH + 200;
let b7Scrolled = -1;
let b7AfterCursor = -1;
if (b7Scrollable) {
  await page.evaluate(() => { document.getElementById('tutorial-article').scrollTop = 400; });
  await page.waitForTimeout(400);
  b7Scrolled = await page.evaluate(() => document.getElementById('tutorial-article').scrollTop);
  await gotoBlock(0, longest === 0 ? 1 : 0);
  b7AfterCursor = await page.evaluate(() => document.getElementById('tutorial-article').scrollTop);
}
// Screens stay MOUNTED under .hidden-view — that is the premise of "reset only when visible".
// Unmounting them breaks [id$="-screen"], b15probe.mjs and B6 (which needs display:none to
// reach the action bar), so a ref callback would never re-fire.
await page.evaluate(() => document.getElementById('nav-quiz')?.click());
await page.waitForTimeout(1000);
const b7Mounted = await page.evaluate(() => {
  const r = document.getElementById('tutorial-screen');
  return { present: !!r, display: r ? getComputedStyle(r).display : null };
});
check('R-B7 scrollTop === 0 after a cursor change — asserted ONLY after scrollHeight > clientHeight + 200 (B7b), screens stay MOUNTED while hidden',
  b7Scrollable && b7Scrolled > 300 && b7AfterCursor === 0
  && b7Mounted.present === true && b7Mounted.display === 'none',
  `floor=${JSON.stringify(b7Floor)} scrollableBy=${b7Floor ? b7Floor.scrollH - b7Floor.clientH : 'n/a'}`
  + ` scrolledTo=${b7Scrolled} afterCursorChange=${b7AfterCursor} readerWhileHidden=${JSON.stringify(b7Mounted)}`
  + (!b7Scrollable ? ' <-- ⛔ FLOOR FAILED: the fixture CANNOT SCROLL AT ALL, so "scrollTop === 0" is true of a pane that never moved.'
    + ' ⚠ scrollHeight === clientHeight is the SIGNATURE OF R-B3\'s failure, not an independent one: an uncapped pane is exactly as tall as its content and therefore never scrolls. Fix R-B3 first and re-read this line.' : '')
  + (b7Scrollable && b7Scrolled <= 300 ? ' <-- ⛔ the write to scrollTop did not take, so the reset was never actually tested' : '')
  + (b7Scrollable && b7AfterCursor !== 0 ? ' <-- ⛔ THE RESET DID NOT FIRE on a cursor change' : '')
  + (!b7Mounted.present ? ' <-- ⛔ the reader UNMOUNTED when hidden: a ref callback can never re-fire, and [id$="-screen"] / b15probe / B6 all break' : ''));

/* ═══════════════════════════════════════════════════════════════════════════════════════
 * R-B1 / R-B5b / R-B6b — the two OptionCard call sites and the action bar.
 * ═══════════════════════════════════════════════════════════════════════════════════════ */

// The card signature. ⛔ B5b IS A DOM-IDENTITY CHECK, NOT A CLASS-NAME CHECK: two look-alike
// components pass a name check and fail this one, which is the point. So the signature is the
// SORTED CLASS SET of all five contract elements PLUS the computed geometry the plan names.
// ⚠ WIDTH IS DELIBERATELY EXCLUDED — the quiz card is full-bleed and the exercise card sits in
//   a panel, so their widths differ on a CORRECT build (1404 vs 720, measured). Comparing
//   width would red a correct app; comparing radius/padding/letter geometry is the identity.
const CARD_SIG = `(sel) => {
  const c = document.querySelector(sel);
  if (!c) return { found: false };
  const set = (e) => (e ? [...e.classList].sort().join(' ') : null);
  const box = (e) => (e ? { w: +e.getBoundingClientRect().width.toFixed(1), h: +e.getBoundingClientRect().height.toFixed(1) } : null);
  const letter = c.querySelector('.option-letter');
  const ls = letter ? getComputedStyle(letter) : null;
  const cs = getComputedStyle(c);
  return {
    found: true,
    classes: {
      card: set(c),
      letter: set(letter),
      text: set(c.querySelector('.option-text')),
      explanationInner: set(c.querySelector('.explanation-inner')),
      explanationText: set(c.querySelector('.explanation-text')),
    },
    borderRadius: cs.borderRadius,
    padding: cs.padding,
    letter: ls ? { box: box(letter), borderRadius: ls.borderRadius, fontWeight: ls.fontWeight } : null,
  };
}`;

// The reveal. Measured on `.explanation-text` — the element the 0fr->1fr switch sizes and the
// one Q2c measures, so the band is comparable to the legacy number it was taken from.
const REVEAL = `(sel) => {
  const cards = [...document.querySelectorAll(sel)];
  const rows = cards.map((c) => {
    const t = c.querySelector('.explanation-text');
    const i = c.querySelector('.explanation-inner');
    return {
      wrap: t ? +t.getBoundingClientRect().height.toFixed(1) : -1,
      inner: i ? +i.getBoundingClientRect().height.toFixed(1) : -1,
      chars: i ? (i.textContent || '').trim().length : -1,
      expanded: t ? t.classList.contains('expanded') : null,
      rows: t ? getComputedStyle(t).gridTemplateRows : null,
      display: t ? getComputedStyle(t).display : null,
    };
  });
  return { n: cards.length, rows };
}`;

// --- the EXERCISE call site (reader, multiple-choice mode) ---
await openReader(MODULE);
await gotoBlock(0, 11);            // ch.1 "End-of-chapter exercises" — the only source of .option-card in the reader
await page.evaluate(() => {
  for (const b of document.querySelectorAll('button')) {
    if (b.textContent.trim() === 'Multiple choice' && !b.disabled) { b.click(); return; }
  }
});
await page.waitForTimeout(1200);
const exSig = await page.evaluate((s) => eval('(' + s + ')')('.option-card'), CARD_SIG);
const exClosed = await page.evaluate((s) => eval('(' + s + ')')('.option-card'), REVEAL);
await page.evaluate(() => document.querySelectorAll('.option-card')[0]?.click());
await page.waitForTimeout(1600);
const exOpen = await page.evaluate((s) => eval('(' + s + ')')('.option-card'), REVEAL);

// --- the QUIZ call site ---
await page.locator('#nav-quiz').click();
await page.waitForTimeout(1200);
await page.locator('#setup-all-btn').click();
await page.waitForTimeout(600);
await page.locator('#setup-start-btn').click();
await page.waitForTimeout(1800);
const qzSig = await page.evaluate((s) => eval('(' + s + ')')('#options-container .option-card'), CARD_SIG);
const qzClosed = await page.evaluate((s) => eval('(' + s + ')')('#options-container .option-card'), REVEAL);
const barBefore = await page.evaluate(() => {
  const q = document.querySelector('#quiz-screen');
  const a = document.querySelector('#action-container');
  if (!q || !a) return { found: false, q: !!q, a: !!a };
  const r = a.getBoundingClientRect();
  return { found: true, contains: q.contains(a), offsetParentNull: a.offsetParent === null, h: +r.height.toFixed(1), w: +r.width.toFixed(1) };
});
await page.evaluate(() => document.querySelector('#options-container .option-card')?.click());
await page.waitForTimeout(1600);
const qzOpen = await page.evaluate((s) => eval('(' + s + ')')('#options-container .option-card'), REVEAL);
const barAnswered = await page.evaluate(() => {
  const q = document.querySelector('#quiz-screen');
  const a = document.querySelector('#action-container');
  if (!q || !a) return { found: false };
  const r = a.getBoundingClientRect();
  return { found: true, contains: q.contains(a), offsetParentNull: a.offsetParent === null, h: +r.height.toFixed(1), w: +r.width.toFixed(1) };
});
await page.evaluate(() => document.getElementById('nav-settings')?.click());
await page.waitForTimeout(1200);
const barAway = await page.evaluate(() => {
  const q = document.querySelector('#quiz-screen');
  const a = document.querySelector('#action-container');
  if (!q || !a) return { found: false, qExists: !!q, aExists: !!a };
  const r = a.getBoundingClientRect();
  return {
    found: true,
    contains: q.contains(a),
    offsetParentNull: a.offsetParent === null,
    h: +r.height.toFixed(1),
    w: +r.width.toFixed(1),
    quizScreenDisplay: getComputedStyle(q).display,
  };
});

/* ---- R-B1: the band, the ratio, and B1b's floor — on BOTH call sites of the shared card ---- */
// ⛔ THE BAND AND THE RATIO, NEVER `=== 41`. And ⛔ `<= 45` ALONE IS NOT ENOUGH: it passes at
//    0px, so dropping .explanation-inner's padding entirely would read GREEN. Hence `>= 35`.
// ⚠⚠ WHICH CALL SITE CARRIES THE `> 100` THRESHOLD, AND WHY IT IS NOT BOTH.
//    The band+ratio is Q2c's, and Q2c measures the QUIZ card (`#options-container
//    .option-card`) at 1440x1000 in the legacy app. So the QUIZ card carries it here, exactly
//    as specified. The EXERCISE card is the SECOND call site of the same component and the
//    plan sets no threshold for it — it sits in a panel (720px, measured) instead of
//    full-bleed (1404px), so the SAME explanation text wraps to fewer lines and a borrowed
//    `> 100` would red a CORRECT build. That is the stale-literal class B1 itself bans.
//    ⛔ It is NOT therefore unasserted: the exercise card must show the band AND a reveal
//       that really opens ON REAL CONTENT (chars > 0 and open > closed). A silent no-op
//       reveal on the second call site still goes red.
const revealOf = (closed, open, { ratio }) => {
  if (!closed || !open || closed.n === 0) return { ok: false, n: 0 };
  const closedMax = Math.max(...closed.rows.map((r) => r.wrap));
  const openMax = Math.max(...open.rows.map((r) => r.wrap));
  const maxChars = Math.max(...open.rows.map((r) => r.chars));
  const anyExpanded = open.rows.some((r) => r.expanded === true);
  const noneExpandedClosed = closed.rows.every((r) => r.expanded === false);
  const band = closedMax >= 35 && closedMax <= 45;          // B1b's floor is the >= 35 half
  const opens = ratio
    ? openMax > 100 && openMax > closedMax * 2.5            // Q2c's band+ratio, on Q2c's fixture
    : maxChars > 0 && openMax > closedMax;                  // the second call site: it must really open, on real text
  return { ok: noneExpandedClosed && anyExpanded && band && opens,
    n: closed.n, closedMax, openMax, maxChars, anyExpanded, noneExpandedClosed, band, opens, ratioApplied: !!ratio };
};
const exReveal = revealOf(exClosed, exOpen, { ratio: false });
const qzReveal = revealOf(qzClosed, qzOpen, { ratio: true });
check('R-B1 the 0fr->1fr reveal: 35 <= closed <= 45 (B1b floor) AND open > 100 AND open > 2.5 x closed — on BOTH OptionCard call sites',
  exReveal.n > 0 && qzReveal.n > 0 && exReveal.ok && qzReveal.ok,
  `exercise=${JSON.stringify(exReveal)} quiz=${JSON.stringify(qzReveal)}`
  + (exReveal.n === 0 || qzReveal.n === 0 ? ' <-- ⛔ FLOOR FAILED: a call site rendered ZERO option cards, so the reveal was never tested' : '')
  + ((exReveal.n > 0 && !exReveal.floorOk) || (qzReveal.n > 0 && !qzReveal.floorOk)
    ? ' <-- ⛔ THE >= 35 FLOOR FAILED: `closed <= 45` alone passes at 0px, so .explanation-inner\'s padding is gone' : '')
  + (qzReveal.n > 0 && qzReveal.maxChars === 0 ? ' <-- ⛔ THE QUIZ REVEAL HAS NOTHING TO REVEAL: zero characters of explanation reached the card, so it opens to its padding and no further — a WIRING defect, not a CSS one' : '')
  + ' — ⛔ NEVER `=== 41`: that literal is px-6 pb-6 pt-4 (16+24) plus a 1px border-t, so a legitimate'
  + ' padding change would red a CORRECT build (the F-1 / `total===21` stale-literal class).'
  + ' ⚠ `chars` is the revealed text length: a reveal with nothing to reveal opens to its padding'
  + ' and no further, which is a DATA/wiring defect, not a CSS one — read the chars before the px');

/* ---- R-B5b: DOM IDENTITY between the two call sites ---- */
const sigDiffs = [];
if (exSig.found && qzSig.found) {
  for (const k of Object.keys(exSig.classes)) {
    if (exSig.classes[k] !== qzSig.classes[k]) sigDiffs.push(`classes.${k}: exercise[${exSig.classes[k]}] vs quiz[${qzSig.classes[k]}]`);
  }
  if (exSig.borderRadius !== qzSig.borderRadius) sigDiffs.push(`borderRadius: ${exSig.borderRadius} vs ${qzSig.borderRadius}`);
  if (exSig.padding !== qzSig.padding) sigDiffs.push(`padding: ${exSig.padding} vs ${qzSig.padding}`);
  if (JSON.stringify(exSig.letter) !== JSON.stringify(qzSig.letter)) sigDiffs.push(`letter: ${JSON.stringify(exSig.letter)} vs ${JSON.stringify(qzSig.letter)}`);
}
const sigFloor = exSig.found && qzSig.found
  && (exSig.classes.card || '').split(' ').length >= 4
  && !!exSig.classes.explanationInner && !!qzSig.classes.explanationInner
  && !!exSig.letter && exSig.letter.box.w > 0 && exSig.letter.box.h > 0;
check('R-B5b DOM IDENTITY: the quiz OptionCard and the exercise OptionCard emit the SAME class SET and identical computed borderRadius / padding / .option-letter geometry',
  sigFloor && sigDiffs.length === 0,
  `exercise=${JSON.stringify(exSig)} quiz=${JSON.stringify(qzSig)}`
  + (sigDiffs.length ? ` <-- ⛔ DIFFERENCES: ${sigDiffs.join(' | ')}` : '')
  + (!sigFloor ? ' <-- ⛔ FLOOR FAILED: a call site rendered no card, or the signature is empty/zero-sized, so "identical" compares nothing' : '')
  + ' — ⛔ NOT a class-NAME check: two components that merely LOOK alike pass a name check and fail'
  + ' this one. The user objected TWICE to tmpl-quiz-option reuse being broken.'
  + ' ⚠ WIDTH is deliberately excluded: full-bleed quiz vs in-panel exercise differ on a CORRECT build');

/* ---- R-B6b: the portal hazard ---- */
// See the file header: `offsetParent === null` is TRUE FOR A FIXED ELEMENT BY SPEC and can
// never go red, so it is asserted AND PRINTED but the load-bearing half is the RECT.
const b6Contains = barBefore.found && barAnswered.found && barAway.found
  && barBefore.contains === true && barAnswered.contains === true && barAway.contains === true;
const b6VisibleWhenUp = barAnswered.found && barAnswered.h > 0 && barAnswered.w > 0;
const b6GoneWhenAway = barAway.found && barAway.h === 0 && barAway.w === 0;
const b6OffsetParent = barAway.found && barAway.offsetParentNull === true;
check('R-B6b #quiz-screen.contains(#action-container) === true, the bar has a real box when the quiz is up, and NO box once the screen is hidden',
  b6Contains && b6VisibleWhenUp && b6GoneWhenAway && b6OffsetParent,
  `unanswered=${JSON.stringify(barBefore)} answered=${JSON.stringify(barAnswered)} navigatedAway=${JSON.stringify(barAway)}`
  + (!b6Contains ? ' <-- ⛔ NOT CONTAINED: the bar escaped #quiz-screen — this is what createPortal(bar, document.body) does' : '')
  + (!b6VisibleWhenUp ? ' <-- ⛔ FLOOR FAILED: the bar has NO box even with the quiz up and answered, so "it disappears" proves nothing' : '')
  + (!b6GoneWhenAway ? ' <-- ⛔ THE BAR SURVIVED THE NAVIGATION: position:fixed escapes LAYOUT but not display:none — unless it was portalled out' : '')
  + ' — ⚠ `offsetParent === null` is asserted (the plan says so) but is VACUOUS ALONE: it is true'
  + ' for ANY position:fixed element, measured true at 1440x49 with the bar fully on screen.'
  + ' The RECT is the half that can go red.');

await browser.close();

console.log(`\n${results.filter((r) => r.pass).length}/${results.length} passed`);
const failed = results.filter((r) => !r.pass);
if (failed.length) console.log('FAILED: ' + failed.map((r) => r.id).join(', '));
if (failed.length) process.exit(1);
