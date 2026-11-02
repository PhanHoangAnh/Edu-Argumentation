#!/usr/bin/env node
/**
 * gate-c-theme.mjs — slice C's purge gate: the themed chapter-panel titles survived the
 * Tailwind CDN -> build swap. Tier 1/2, against the LEGACY app on :8791.
 *
 * edu-replatform Phase 03 slice C, checklist C6 / C7.
 *
 * ⛔ NOT part of the frozen 49 and NOT registered in run-gates.sh (which is untouched, R1/E1).
 *    It is also NOT an R- gate: the R- suite targets the NEW React stack on :8792, and this
 *    measures the LEGACY app. Run it directly.
 *
 * ⛔⛔ "ZERO [data-theme-fallback] ELEMENTS" IS VACUOUSLY TRUE IF THE STAMP CAN NEVER FIRE.
 *    That is the failure mode this whole program keeps finding, so C7 here carries an explicit
 *    VACUITY FLOOR: it injects a chapter carrying a themeColor the lookup does not know and
 *    asserts the stamp DOES appear. A browse that finds zero stamps only means something once
 *    a stamp has been shown to be producible.
 *
 * WHY A DATA-DRIVEN CHECK SITS BESIDE THE BROWSE: a browse can only prove the chapters it
 * reached. C-THEME-3 reads every chapter of every book straight from module.json, so a chapter
 * the browse skipped cannot hide an unknown themeColor.
 */
import { chromium } from 'playwright';

const BASE = process.env.GATE_BASE || 'http://127.0.0.1:8791';
const results = [];
const check = (id, pass, detail) => {
  results.push({ id, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${id}  ${detail}`);
};

const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForTimeout(800);

// The library carries BOTH shapes. `base`/`book` marks a PACKAGED library/<id>/ book; the
// rest are legacy data/*.json. C7's "both books" means the two PACKAGED PRODUCTION books —
// that is the corpus the plan measured. The legacy books are a separate, older corpus and are
// asserted separately, because conflating them hides which one a failure belongs to.
const PACKAGED = ['geron-homl3', 'demo-book', 'openintro-statistics-2019-1045f2f5'];
const books = await page.evaluate(() =>
  [...document.querySelectorAll('[data-book]')].map((e) => e.dataset.book));

/* ---- C-THEME-1: a FULL browse of BOTH books yields zero fallback stamps ---- */
const perBook = [];
for (const file of books) {
  // ⛔ OPENING A BOOK IS NOT ENTERING THE READER, AND THE FIRST CLICK CAN RACE THE APP'S OWN
  // BOOT. Clicking a library card fetches module.json (200, no console error) but leaves the
  // app on #welcome-screen with theoryChapters() === 0; the reader is entered by
  // #read-tutorial-btn ("Continue reading" / LEARN), the same control b15probe.mjs clicks.
  // Measured against the LIVE :8767 on 21-09-26: the FIRST book in the loop returned 0 chapters
  // while the gate still claimed it had browsed both. Bounded retry, then give up loudly — the
  // per-book floor below turns "gave up" into a RED result rather than a silent short browse.
  // ⛔ Wait for CONTENT, never a fixed timeout: geron's module.json is 5.5 MB.
  let opened = 0;
  for (let attempt = 1; attempt <= 3 && opened === 0; attempt += 1) {
    await page.evaluate((f) => {
      const card = document.querySelector(`[data-book="${f}"]`);
      if (card) card.click();
    }, file);
    await page.waitForTimeout(600);
    const enter = page.locator('#read-tutorial-btn');
    if (await enter.count() && await enter.isVisible() && await enter.isEnabled()) {
      await enter.click().catch(() => {});
    }
    await page.waitForFunction(() => {
      try { return theoryChapters().length > 0; } catch { return false; }
    }, null, { timeout: 45000 }).catch(() => {});
    opened = await page.evaluate(() => { try { return theoryChapters().length; } catch { return 0; } });
    if (opened === 0) {
      // back to the library and try again from a settled state
      await page.evaluate(() => { const b = document.querySelector('#brand-home'); if (b) b.click(); });
      await page.waitForTimeout(1000);
    }
  }
  await page.waitForTimeout(300);

  // Walk EVERY chapter and EVERY block through the app's own render path. currentTheory +
  // renderTheoryBlock() are exactly what the next/prev buttons drive (app.js:1414 / 2221);
  // app.js is a classic <script>, so both are reachable in global lexical scope. Clicking
  // 414 next-buttons renders the identical DOM at many times the cost.
  const r = await page.evaluate(async () => {
    const out = { chapters: 0, blocks: 0, fallbacks: [], themes: {}, titlesSeen: 0 };
    const chapters = theoryChapters();
    out.chapters = chapters.length;
    for (let c = 0; c < chapters.length; c += 1) {
      const t = chapters[c].themeColor || 'brand-600';
      out.themes[t] = (out.themes[t] || 0) + 1;
      const blocks = theoryBlocks(c);
      for (let b = 0; b < blocks.length; b += 1) {
        currentTheory = { chapterIndex: c, blockIndex: b };
        renderTheoryBlock();
        out.blocks += 1;
        out.titlesSeen += document.querySelectorAll('#tutorial-content h3').length;
        for (const el of document.querySelectorAll('[data-theme-fallback]')) {
          out.fallbacks.push(`ch${c + 1}b${b + 1}:${el.dataset.themeFallback}`);
        }
      }
    }
    return out;
  });
  perBook.push({ file, ...r });

  // back to the library for the next book
  await page.evaluate(() => { const b = document.querySelector('#brand-home'); if (b) b.click(); });
  await page.waitForTimeout(700);
}

// ⛔ REOPEN A BOOK BEFORE THE VACUITY INJECTION. The loop above ends at the LIBRARY, where
// theoryChapters() is empty and renderTheoryBlock() returns at its own `if (!chapter || !block)`
// guard — so the injection rendered nothing and the floor read "no stamp" for the wrong reason.
// That is the same vacuity this gate exists to catch, and it caught itself first.
await page.evaluate((f) => document.querySelector(`[data-book="${f}"]`).click(), books[0]);
await page.waitForTimeout(1200);

const packagedBooks = perBook.filter((b) => PACKAGED.includes(b.file));
const legacyBooks = perBook.filter((b) => !PACKAGED.includes(b.file));
const totalBlocks = packagedBooks.reduce((n, b) => n + b.blocks, 0);
const totalTitles = packagedBooks.reduce((n, b) => n + b.titlesSeen, 0);
const allFallbacks = packagedBooks.flatMap((b) => b.fallbacks.map((f) => `${b.file}/${f}`));
const legacyFallbacks = legacyBooks.flatMap((b) => b.fallbacks.map((f) => `${b.file}/${f}`));
// ⛔ PER-BOOK FLOOR. A whole-corpus "blocks > 0" is satisfied by ONE book, which is exactly how
// the live run reported "both books" while geron-homl3 contributed 0 chapters.
const emptyPackaged = packagedBooks.filter((b) => b.blocks === 0 || b.titlesSeen === 0).map((b) => b.file);
check(
  'C-THEME-1 a full browse of BOTH PACKAGED PRODUCTION books yields ZERO [data-theme-fallback]',
  packagedBooks.length >= 2 && emptyPackaged.length === 0 && totalBlocks > 0 && totalTitles > 0 && allFallbacks.length === 0,
  `books=${books.length} blocks=${totalBlocks} h3-titles-rendered=${totalTitles} fallbacks=${allFallbacks.length}` +
  (allFallbacks.length ? ` -> ${allFallbacks.slice(0, 8).join(' ')}` : '') +
  ` | ${packagedBooks.map((b) => `${b.file}:${b.chapters}ch/${b.blocks}blk`).join(' ')}` +
  ` | EMPTY-PACKAGED=${JSON.stringify(emptyPackaged)}` +
  ' (floors: 2+ packaged books, EVERY packaged book renders blocks AND titles — a corpus-wide' +
  ' blocks>0 is satisfied by one book, which is how a live run once reported "both" while the' +
  ' 5.5 MB book contributed nothing)',
);

// The legacy corpus is asserted SEPARATELY and its one known stamp is named, so a NEW unknown
// value cannot hide behind an expected one.
const LEGACY_EXPECTED = ['aws-indigo'];
const legacyUnexpected = [...new Set(legacyFallbacks.map((f) => f.split(':').pop()))]
  .filter((v) => !LEGACY_EXPECTED.includes(v));
check(
  'C-THEME-1b the legacy data/*.json books stamp ONLY the known-unstyleable aws-indigo',
  legacyUnexpected.length === 0,
  `legacy books=${legacyBooks.length} stamps=${legacyFallbacks.length} ` +
  `values=${JSON.stringify([...new Set(legacyFallbacks.map((f) => f.split(':').pop()))])} ` +
  `unexpected=${JSON.stringify(legacyUnexpected)} | aws-indigo is NOT a Tailwind colour and was ` +
  'never in the brand palette, so it produced no rule under the CDN either — the stamp makes a ' +
  'pre-existing silent defect visible; it is not a regression',
);

/* ---- C-THEME-2: THE VACUITY FLOOR — the stamp can actually fire ---- */
const injected = await page.evaluate(async () => {
  // ⛔ FIND A BLOCK THAT ACTUALLY RENDERS A THEMED <h3> FIRST.
  // The title element only exists when `block.title` is truthy AND the sub-block is NOT a
  // callout (a callout takes the fixed text-brand-400 branch and is never themed). Injecting
  // at chapter 0 / block 0 blindly rendered no <h3> at all, so the floor reported "no stamp"
  // for the wrong reason — the very vacuity this assertion exists to prevent, which it first
  // demonstrated on itself.
  const chapters = theoryChapters();
  let target = null;
  outer: for (let c = 0; c < chapters.length; c += 1) {
    const blocks = theoryBlocks(c);
    for (let b = 0; b < blocks.length; b += 1) {
      currentTheory = { chapterIndex: c, blockIndex: b };
      renderTheoryBlock();
      // ⛔ MATCH THE BLOCK-TITLE SIGNATURE, not just "an h3". Markdown content renders its own
      // <h3> elements (from `###`) which carry no theme class at all; picking one of those found
      // a block with no titled panel, so the injection had nothing to re-theme. Measured.
      const themed = [...document.querySelectorAll('#tutorial-content h3')]
        .filter((h) => /^text-lg font-semibold text-/.test(h.className) && !/text-brand-400/.test(h.className));
      if (themed.length) { target = { c, b, titles: themed.length }; break outer; }
    }
  }
  if (!target) return { error: 'no themed <h3> found anywhere — the floor cannot be evaluated' };

  const original = chapters[target.c].themeColor;
  chapters[target.c].themeColor = 'not-a-real-theme-999';
  currentTheory = { chapterIndex: target.c, blockIndex: target.b };
  renderTheoryBlock();
  const els = [...document.querySelectorAll('[data-theme-fallback]')];
  const stamped = els.map((e) => e.dataset.themeFallback);
  const cls = els.length ? els[0].className : null;
  const colour = els.length ? getComputedStyle(els[0]).color : null;

  chapters[target.c].themeColor = original;           // restore
  renderTheoryBlock();
  const after = document.querySelectorAll('[data-theme-fallback]').length;
  return { target, stamped, cls, colour, afterRestore: after };
});
check(
  'C-THEME-2 VACUITY FLOOR: an unknown themeColor DOES stamp data-theme-fallback and falls back to brand-600',
  !injected.error
    && injected.stamped.includes('not-a-real-theme-999')
    && /text-brand-600/.test(injected.cls || '')
    && injected.colour === 'rgb(239, 91, 91)'
    && injected.afterRestore === 0,
  injected.error
    ? injected.error
    : `injected at ch${injected.target.c + 1}b${injected.target.b + 1} -> stamped=${JSON.stringify(injected.stamped)} ` +
      `colour=${injected.colour} afterRestore=${injected.afterRestore} ` +
      '(without this, "zero fallbacks" proves nothing)',
);

/* ---- C-THEME-3: every themeColor in the DATA is a key of the lookup ---- */
const tally = (list) => { const o = {}; for (const b of list) for (const [t, n] of Object.entries(b.themes)) o[t] = (o[t] || 0) + n; return o; };
const packagedThemes = tally(packagedBooks);
const legacyThemes = tally(legacyBooks);
const known = await page.evaluate(() => Object.keys(THEME_TITLE_CLASS));
const unknownPackaged = Object.keys(packagedThemes).filter((t) => !known.includes(t));
const unknownLegacy = Object.keys(legacyThemes).filter((t) => !known.includes(t));
check(
  'C-THEME-3 every themeColor in the PACKAGED books is a key of THEME_TITLE_CLASS',
  unknownPackaged.length === 0 && Object.keys(packagedThemes).length > 0,
  `packaged themes=${JSON.stringify(packagedThemes)} lookup keys=${known.length} unknown=${JSON.stringify(unknownPackaged)}`,
);
check(
  'C-THEME-3b the LEGACY books carry only known values plus the named aws-indigo exception',
  unknownLegacy.filter((t) => !LEGACY_EXPECTED.includes(t)).length === 0,
  `legacy themes=${JSON.stringify(legacyThemes)} unknown=${JSON.stringify(unknownLegacy)} ` +
  '(blue-500 lives ONLY here and IS deployed — deploy.sh excludes only geron_hands_on_ml_ch01_ch09.json — ' +
  'so it was added to the lookup; a build would otherwise have purged a colour that worked)',
);

/* ---- C-THEME-4: the 9 classes are really in the served stylesheet, and coloured ---- */
const styled = await page.evaluate((keys) => {
  const out = {};
  for (const k of keys) {
    const p = document.createElement('p');
    p.className = `text-${k}`;
    document.body.appendChild(p);
    out[k] = getComputedStyle(p).color;
    p.remove();
  }
  return out;
}, ['indigo-500', 'emerald-500', 'purple-500', 'teal-500', 'amber-500', 'sky-500', 'rose-500', 'violet-500', 'blue-500', 'brand-600']);
// The page's default text colour is #cbd5e1 = rgb(203, 213, 225). A class that produced no rule
// would inherit exactly that, so "9 distinct non-default colours" is the real assertion.
const DEFAULT = 'rgb(203, 213, 225)';
const values = Object.values(styled);
const inherited = Object.entries(styled).filter(([, v]) => v === DEFAULT).map(([k]) => k);
check(
  'C-THEME-4 all 10 theme classes RESOLVE TO A COLOUR in the built stylesheet (not the inherited default)',
  inherited.length === 0 && new Set(values).size === 10,
  `${Object.entries(styled).map(([k, v]) => `${k}=${v}`).join(' ')} | distinct=${new Set(values).size}/10 inherited-default=${JSON.stringify(inherited)}`,
);

await browser.close();
console.log(`\n${results.filter((r) => r.pass).length}/${results.length} passed`);
const failed = results.filter((r) => !r.pass);
if (failed.length) console.log('FAILED: ' + failed.map((r) => r.id).join(', '));
if (failed.length) process.exit(1);
