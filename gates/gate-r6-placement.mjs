#!/usr/bin/env node
/**
 * gate-r6-placement.mjs — RULING R6: every visual sits at its point of mention.
 *
 * edu-replatform Phase 03, Exit Gate row "R6 transform on nn still intact".
 *
 * ⛔⛔ WHY THIS FILE EXISTS. Until 2026-09-22 THE EXIT GATE NAMED A COMMAND THAT WAS NOT IN
 *     THE REPO. The final EVL looked for it — `ls gates/` had no R6 script, and
 *     `find ml -name '*r6*' -o -name '*placement*'` returned nothing — so the row had been
 *     UNVERIFIED for the whole phase while reading as though it were gated. The plan's own
 *     standard is "the finding is a command and not a paragraph"; this is that command.
 *
 * ⛔⛔ THE RULING'S **FIRST** WORDING IS VOID AND MUST NOT BE REINTRODUCED.
 *     It read: "assert the figure's index in blocks[] is greater than the text block that
 *     names it and less than the next text block." That passes TRIVIALLY on the batched
 *     shape it exists to reject — when one text block is followed by a RUN of figures there
 *     IS no "next text block", so the window is the whole lesson. Measured against the
 *     untransformed Géron file it reported `checked=326 failures=0 -> GREEN`. Two
 *     independent agents hit it; one's fault run printed "the gate is vacuous".
 *
 *     THE BINDING FORM IS THE **FOUR-CONDITION** TEST FROM
 *     RULING-R6-inline-visuals_21-09-26.md, and ALL FOUR MUST HOLD:
 *       C1  the visual appears AFTER the prose that names it;
 *       C2  NO paragraph break sits between the mention and the visual;
 *       C3  ONLY visual sub-blocks may sit between them;
 *       C4  NO other asset's mention sits between them.
 *     ⚠ C4 permits a genuine BACK-REFERENCE — prose re-naming a visual already shown in an
 *       earlier block (`eq-17-4` is a real case) — and a visual shown TOGETHER with this one
 *       in the same contiguous run. That carve-out does NOT reopen the vacuity, because C2
 *       still fails the batched shape.
 *     Two implementation details that proved load-bearing, not optional:
 *       · guard the number with (?!\d) so `2-6` never matches `2-60`;
 *       · when several visuals share one split point they are emitted in PROSE-MENTION
 *         order, not asset order (`fig-4-16` is named before `fig-4-14` in Chapter 4).
 *
 * ⛔ TWO SURFACES, TWO ASSERTIONS — the ruling binds BOTH and one does not imply the other.
 *     R-R6a asserts the DATA (surface 1: the transform on library/<id>/module.json).
 *     R-R6b asserts the RENDERED READER (surface 2: "the React block renderer must honour
 *     figure position in document order. It must not re-group, float, or collect visuals to
 *     the end of a block."). A correct file rendered by a re-grouping renderer still makes
 *     the learner scroll away, which is the failure the ruling names.
 *
 * ⛔ NO LITERALS. Every count, every expectation and the rendered sample itself are DERIVED
 *    from the live payload. The stale-literal class has bitten this program six times
 *    (`total === 21`, `-eq 49`, the B1 `=== 41` temptation, F-1's mtime, A-G17's fixture,
 *    R-B15b's pinned hash). The books that exist are read from /api/modules, not listed.
 *
 * ⛔ ANTI-VACUITY IS ASSERTED, NOT ASSUMED (R-R6c). A sweep that checked nothing, or a
 *    corpus with no interleaved pair at all, reports RED rather than an empty green.
 *
 * Run:  node gates/gate-r6-placement.mjs
 *       GATE_BASE=http://192.168.100.66:8792 node gates/gate-r6-placement.mjs
 */
import { chromium } from 'playwright';

const BASE = process.env.GATE_BASE || process.env.R_REMOTE || 'http://192.168.100.66:8767';  // P6b 24-09-26: was :8792 (retired)

const results = [];
const check = (id, pass, detail) => {
  results.push({ id, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${id}  ${detail}`);
};

// ── the four-condition test, ported from tools/check_inline_figures.py:gate_placement ──
const VISUAL_TYPES = new Set(['figure', 'equation']);

// ⛔⛔ THESE FOUR CONSTANTS ARE PORTED **VERBATIM** FROM tools/inline_figures.py:26-32,
//     which is the transform that produced the corpus. A gate whose notion of "a numbered
//     visual" differs from the transform's measures a DIFFERENT corpus and reports a number
//     nobody can act on.
//     ⚠ MEASURED DIVERGENCE, 22-09-26 — recorded because it read as a clean green:
//       an earlier draft here accepted only the HYPHEN form (`fig-2-6`, Géron) and only the
//       bare words "figure"/"equation". OpenIntro numbers its assets with a DOT (`fig-1.3`),
//       so that draft reported `openintro: checked=0 failures=0` — a whole book silently
//       unexamined, inside an assertion that said PASS. R-R6c's per-book floor now makes
//       that state RED too, but the real fix is these constants matching the transform.
const SEP = '[-.‐‑‒–—―−]';
const LABEL = { fig: '(?:figures?|figs?\\.?)', eq: '(?:equations?|eqs?\\.?)' };
const ASSET_ID = /^(fig|eq)-(\d{1,3})[-.](\d{1,3})$/;
const ASSET_FILE = /^(?:.*\/)?(fig|eq)-(\d{1,3})[-.](\d{1,3})\.png$/;

/** (kind, chapter, num) for a numbered visual, else null. `asset` then `src`, both forms. */
function visualNumber(b) {
  for (const [key, rx] of [['asset', ASSET_ID], ['src', ASSET_FILE], ['asset', ASSET_FILE]]) {
    const val = b?.[key];
    if (typeof val !== 'string') continue;
    const m = rx.exec(val);
    if (m) return `${m[1]}|${Number(m[2])}|${Number(m[3])}`;
  }
  return null;
}

/** The (?![\d\w]) guard is load-bearing: without it `2-6` matches inside `2-60`. */
function refRegex(key) {
  const [kind, ch, n] = key.split('|');
  return new RegExp(
    `(?<![\\w-])${LABEL[kind]}\\s*0*${ch}\\s*${SEP}\\s*0*${n}(?![\\d\\w])`,
    'gi',
  );
}

/** Human form for a message: fig|2|6 -> fig-2-6. */
const showNum = (k) => k.split('|').join('-');


/** Blank-line-delimited paragraph spans, fence- and display-math-aware. */
function paragraphSpans(content) {
  const spans = [];
  let pos = 0, start = 0, inFence = false, inMath = false;
  for (const line of content.split(/(?<=\n)/)) {
    const s = line.trim();
    if (s.startsWith('```')) inFence = !inFence;
    else if (!inFence && s === '$$') inMath = !inMath;
    else if (!inFence && !inMath && s === '') {
      if (content.slice(start, pos).trim()) spans.push([start, pos]);
      start = pos + line.length;
    }
    pos += line.length;
  }
  if (content.slice(start).trim()) spans.push([start, content.length]);
  return spans;
}

/** Run the four conditions over one lesson's blocks[]. */
function placementOfItem(blocks) {
  const textIdx = [];
  const numbered = new Map();
  blocks.forEach((b, i) => {
    if (b?.type === 'text') textIdx.push(i);
    if (VISUAL_TYPES.has(b?.type)) {
      const n = visualNumber(b);
      if (n) numbered.set(i, n);
    }
  });
  const out = [];
  for (const [j, num] of numbered) {
    const rx = refRegex(num);
    const naming = [];
    for (const t of textIdx) {
      rx.lastIndex = 0;
      const m = rx.exec(blocks[t].content || '');
      if (m) naming.push([t, m]);
    }
    if (!naming.length) { out.push({ vi: j, num, status: 'skipped-unnamed' }); continue; }

    let ok = false, why = null, namedBy = null;
    for (const [t, m] of naming) {
      if (t >= j) { why = why || 'C1 the naming prose comes AFTER the visual'; continue; }
      if (textIdx.some((k) => k > t && k < j)) {
        why = why || 'C3 another TEXT block sits between the prose and the visual'; continue;
      }
      let nonVisual = false;
      for (let k = t + 1; k < j; k += 1) if (!VISUAL_TYPES.has(blocks[k]?.type)) nonVisual = true;
      if (nonVisual) { why = why || 'C3 a non-visual block sits between the prose and the visual'; continue; }

      const content = blocks[t].content || '';
      const spans = paragraphSpans(content);
      const last = spans.length ? spans[spans.length - 1] : [0, content.length];
      if (!(last[0] <= m.index && m.index < last[1])) {
        const below = spans.filter((s) => s[0] > m.index).length;
        why = why || `C2 ${below} paragraph break(s) sit below the sentence that names it — the reader still scrolls away`;
        continue;
      }
      // C4 — benign mentions: (a) a visual shown TOGETHER with this one in the same
      // contiguous run AFTER it; (b) a BACK-reference to a visual already shown above
      // this text block (the reader has seen it — no scroll-away).
      const runAfter = [];
      for (let k = t + 1; k < blocks.length; k += 1) {
        if (!VISUAL_TYPES.has(blocks[k]?.type)) break;
        runAfter.push(k);
      }
      const allowed = new Set();
      for (const k of runAfter) if (k > j && numbered.has(k)) allowed.add(numbered.get(k));
      for (const [k, v] of numbered) if (k < t) allowed.add(v);

      let intruder = null;
      for (const [, other] of numbered) {
        if (other === num || allowed.has(other)) continue;
        const orx = refRegex(other);
        orx.lastIndex = m.index + m[0].length;
        const om = orx.exec(content);
        if (om) { intruder = other; break; }
      }
      if (intruder) { why = why || `C4 the prose also names ${showNum(intruder)} before the visual — the block was not split`; continue; }
      ok = true; namedBy = t; break;
    }
    out.push({ vi: j, num, status: ok ? 'ok' : 'fail', why, namedBy });
  }
  return out;
}

// ── read the live corpus ──────────────────────────────────────────────────────
const jsonAt = async (p) => {
  const r = await fetch(`${BASE}${p}`);
  if (!r.ok) throw new Error(`read failed: GET ${p} -> ${r.status}`);
  return r.json();
};

// ⛔ The book list is READ, never written down here.
const modules = (await jsonAt('/api/modules')).books ?? [];
if (!modules.length) throw new Error('gate refused: /api/modules returned no books');
const seen = new Set();
const books = [];
// ⚑ PACKAGED BOOKS ONLY (23-09-26, Phase 04). Since P4 the library also lists the three
//   legacy-shape books (data/*.json — SageMaker/MLOps), which live at /data/<file>, not under
//   /book/, and carry no book figures for R6 to place. The gate crashed on the first of them
//   (GET /book/t-domain-4-…/module.json -> 404) after 0 result lines. Filtered by the listing's own
//   `book` marker — never by name — so a new packaged book is still swept automatically.
for (const m of [...modules].filter((b) => b.book).sort((a, b) => a.moduleId.localeCompare(b.moduleId))) {
  if (seen.has(m.moduleId)) continue;
  seen.add(m.moduleId);
  const doc = await jsonAt(`/book/${m.moduleId}/module.json`);
  const sections = doc?.tutorialData?.sections;
  if (!Array.isArray(sections)) throw new Error(`gate refused: ${m.moduleId} has no tutorialData.sections[]`);
  // `file` is the key BookProvider.initialBookFile() reads out of localStorage; see the
  // seeding note in the R-R6b block below.
  books.push({ id: m.moduleId, file: m.file, sections });
}

// ── R-R6a — the DATA, four conditions ─────────────────────────────────────────
let checked = 0, failures = 0, skipped = 0, totalNumbered = 0;
const firstFailures = [];
const perBook = [];
for (const { id, sections } of books) {
  let bChecked = 0, bFail = 0, bSkip = 0;
  sections.forEach((sec, ci) => {
    (sec.items || []).forEach((item, bi) => {
      const blocks = Array.isArray(item?.blocks) ? item.blocks : [];
      for (const r of placementOfItem(blocks)) {
        totalNumbered += 1;
        if (r.status === 'skipped-unnamed') { bSkip += 1; continue; }
        bChecked += 1;
        if (r.status === 'fail') {
          bFail += 1;
          if (firstFailures.length < 8) {
            firstFailures.push(`${id} ch${ci + 1}-b${bi + 1} ${showNum(r.num)}: ${r.why}`);
          }
        }
      }
    });
  });
  perBook.push(`${id}: checked=${bChecked} failures=${bFail} unnamed-skipped=${bSkip}`);
  checked += bChecked; failures += bFail; skipped += bSkip;
}

check('R-R6a DATA: every numbered visual named by its own prose satisfies ALL FOUR conditions',
  failures === 0,
  `checked=${checked} failures=${failures} unnamed-skipped=${skipped} numberedTotal=${totalNumbered}`
  + ` | ${perBook.join(' | ')}`
  + (failures ? ` | first failures: ${firstFailures.join(' ;; ')}` : '')
  + ' — C1 after the prose · C2 no paragraph break between · C3 only visual sub-blocks'
  + ' between · C4 no other asset named between (back-references and same-run companions'
  + ' are the declared carve-out).');

// ── R-R6b — the RENDERED reader honours document order ────────────────────────
// ⛔ THE SAMPLE IS DERIVED, NOT A LITERAL: per book, every lesson carrying the MAXIMUM
//    number of numbered visuals in that book — i.e. the hardest cases, chosen by the data.
const sample = [];
for (const { id, file, sections } of books) {
  let max = 0;
  const counts = [];
  sections.forEach((sec, ci) => {
    (sec.items || []).forEach((item, bi) => {
      const blocks = Array.isArray(item?.blocks) ? item.blocks : [];
      const n = placementOfItem(blocks).filter((r) => r.status === 'ok').length;
      counts.push({ ci, bi, n, blocks });
      if (n > max) max = n;
    });
  });
  for (const c of counts) if (c.n === max && max > 0) sample.push({ id, file, ...c, max });
}
if (!sample.length) throw new Error('gate refused: no lesson in the live corpus carries a placed numbered visual — nothing to render-check');

const browser = await chromium.launch({ executablePath: process.env.GATE_CHROME || chromium.executablePath() });

/*
  ⛔⛔ ONE BROWSER CONTEXT PER BOOK, WITH `eduActiveBook` SEEDED. READ BEFORE SIMPLIFYING.
      A deep link alone does NOT select a book. BookProvider chooses it ONCE at mount from
      `localStorage['eduActiveBook']`, falling back to DEFAULT_BOOK
      (state/BookProvider.tsx:117-124) — so every hash in this sample rendered Géron.
      MEASURED on the run before this fix: openintro ch3-b12 came back
      `dom=[text,visual,text,visual,other,other,other,other]` against a 10-block expectation,
      which reads as "the renderer re-grouped" and is in fact "the probe opened the wrong
      book". A gate that can silently measure a different book than it names is worse than
      no gate.
  ⚠ SEEDING IS A READ-PATH USE, NOT A PRODUCT CHANGE. BookProvider's own header records
      that the READ is live and only the WRITE half is unported, so the key is exactly the
      supported way to nominate a book. It touches BROWSER storage only — nothing here
      writes progress.json, and the read-only guarantee (R-RO1/R-RO2) is untouched.
  ⛔ Do not fold this back into one shared context: `addInitScript` is per-context, and a
      shared one would seed whichever book ran last.
*/
const pageForBook = async (file) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await ctx.addInitScript((f) => {
    try { window.localStorage.setItem('eduActiveBook', f); } catch { /* storage blocked */ }
  }, file);
  return { ctx, page: await ctx.newPage() };
};

/** The data's own type sequence, collapsed to what the DOM can distinguish. */
const dataKind = (b) => (VISUAL_TYPES.has(b?.type) && !(b?.type === 'figure' && b?.svg && !b?.src) ? 'visual'
  : b?.type === 'text' ? 'text' : VISUAL_TYPES.has(b?.type) ? 'visual' : 'other');

let renderedLessons = 0, orderOk = 0, interleavedPairs = 0;
const renderFailures = [];
for (const s of sample) {
  const { ctx, page } = await pageForBook(s.file);
  // ⛔⛔ EACH LESSON IS A **FRESH DOCUMENT LOAD**, and `about:blank` between is the reason.
  //     `page.goto(BASE + '#chapter=..')` from a page already on BASE is a SAME-DOCUMENT
  //     navigation: the browser fires hashchange and returns, the SPA never re-runs its
  //     book-load path, and `#tutorial-content` stays EMPTY. MEASURED on the first run of
  //     this gate: `rendered=0` on BOTH sampled lessons, which reads exactly like a broken
  //     reader and was in fact a broken probe. Going via about:blank forces a real load, so
  //     the deep-link path (loadBundledModule + the hash cursor) actually runs.
  await page.goto('about:blank');
  await page.goto(`${BASE}/#chapter=${s.ci + 1}&block=${s.bi + 1}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  const dom = await page.evaluate(() => {
    const c = document.getElementById('tutorial-content');
    if (!c) return null;
    return [...c.children].map((e) => (e.hasAttribute('data-visual') ? 'visual'
      : (e.getAttribute('style') || '').includes('--reading-leading') ? 'text' : 'other'));
  });
  const activeId = await page.evaluate(() => {
    const el = document.querySelector('#library-grid [data-book][aria-current="true"]');
    return el ? el.getAttribute('data-book') : null;
  }).catch(() => null);
  await ctx.close();
  if (!dom || !dom.length) { renderFailures.push(`${s.id} ch${s.ci + 1}-b${s.bi + 1}: #tutorial-content empty`); continue; }
  // ⛔ ANTI-MISATTRIBUTION: prove we measured the book we NAMED. Without this the wrong
  //    book's DOM is compared against this book's data and the verdict is meaningless.
  if (activeId && activeId !== s.file) {
    renderFailures.push(`${s.id} ch${s.ci + 1}-b${s.bi + 1}: WRONG BOOK OPEN (active=${activeId}) — probe defect, not a renderer defect`);
    continue;
  }
  renderedLessons += 1;

  const want = s.blocks.map(dataKind);
  const same = want.length === dom.length && want.every((v, i) => v === dom[i]);
  if (same) orderOk += 1;
  else renderFailures.push(`${s.id} ch${s.ci + 1}-b${s.bi + 1}: data=[${want.join(',')}] dom=[${dom.join(',')}]`);
  for (let i = 1; i < dom.length; i += 1) if (dom[i] === 'visual' && dom[i - 1] === 'text') interleavedPairs += 1;
}
await browser.close();

check('R-R6b RENDERED: the reader emits sub-blocks in document order — no re-grouping, no '
  + 'floating, no collecting visuals to the end of the block',
  renderedLessons > 0 && orderOk === renderedLessons,
  `sample=${sample.length} (DERIVED: per book, every lesson carrying that book's MAXIMUM`
  + ` placed-visual count) rendered=${renderedLessons} orderMatchesData=${orderOk}`
  + ` interleavedTextThenVisualPairs=${interleavedPairs}`
  + (renderFailures.length ? ` | failures: ${renderFailures.slice(0, 5).join(' ;; ')}` : ''));

// ── R-R6c — anti-vacuity ──────────────────────────────────────────────────────
check('R-R6c the sweep was NOT vacuous: it checked real visuals and observed real '
  + 'interleaving (the first R6 wording reported checked=326 failures=0 GREEN on the UNFIXED file)',
  checked > 0 && renderedLessons > 0 && interleavedPairs > 0 && books.length > 0,
  `books=${books.length} dataChecked=${checked} renderedLessons=${renderedLessons}`
  + ` interleavedPairs=${interleavedPairs} — all four must be > 0 or this gate proves nothing.`);

console.log(`\n${results.filter((r) => r.pass).length}/${results.length} passed`);
const failed = results.filter((r) => !r.pass);
if (failed.length) console.log('FAILED: ' + failed.map((r) => r.id).join(', '));
if (failed.length) process.exit(1);
