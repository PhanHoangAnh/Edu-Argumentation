#!/usr/bin/env node
/**
 * gate-r-theme.mjs — ITEM A: the Tailwind CDN is GONE and the BUILD carries the theme.
 *
 * edu-replatform Phase 03, Exit Gate row "Theme purge landmine". Tier 1 + Tier 2 (browser).
 *
 * ⛔⛔ WHY THIS EXISTS — IT IS A USER RULING BEING ENFORCED, NOT A STYLE CHECK.
 *     Ruling R8 (21-09-26) moved :8767 OFF `https://cdn.tailwindcss.com?plugins=typography`
 *     and onto a real Tailwind build. :8792 REPLACES :8767 at the Phase 06 cutover, and
 *     until 22-09-26 it was STILL loading that CDN at runtime. Measured by the final EVL:
 *       · the built CSS contained **0 of the 10** theme class strings, and no Tailwind
 *         utility at all (3,454 bytes of hand-written component classes);
 *       · the app nevertheless LOOKED right, because a public CDN compiled the classes in
 *         the browser on every page load (`.px-6` -> `padding-left: 24px`, measured live).
 *     Cutting over as-is would have SILENTLY REVERSED R8. "It looks right" is exactly the
 *     evidence that cannot distinguish these two worlds, which is why this file exists.
 *
 * ⛔⛔ THE PURGE IS NOT INCREMENTAL. A real build keeps only classes whose COMPLETE NAME
 *     appears literally in a scanned source file, so one wrong `content` glob deletes CSS
 *     for EVERY screen at once. The landmine measured in slice C: the legacy assembled
 *     `text-${chapter.themeColor}` at runtime, so a build emitted NO themed title colour at
 *     all. Here that construction never existed — PanelBlock.tsx ships THEME_TITLE_CLASS, a
 *     lookup of COMPLETE strings — and R-THEME1 is what proves the build actually kept them.
 *
 * ⛔ THE LOOKUP IS **10** ENTRIES, NOT 9. Slice C measured a tenth against the DEPLOYED
 *    corpus: `blue-500`, carried by a live data/*.json. A naive glob would have purged a
 *    colour that WORKS. R-THEME1 derives the list FROM THE SOURCE FILE rather than hard-
 *    coding nine — a literal here would re-create the exact undercount it is checking for.
 *
 * ⛔ `?plugins=typography` WAS LOAD-BEARING. Dropping it removes every `prose` style and the
 *    damage reads as "the rewrite looks wrong" rather than as a missing dependency
 *    (R-THEME4).
 * ⛔ KaTeX STAYS ON ITS CDN this phase (a <link> and two <script>s, plus the @import in
 *    rich-text-viewer.js's shadow style). Offline KaTeX is a Phase 05 item. R-THEME2
 *    therefore bans ONE host by name; it is not a blanket "no CDN" rule.
 *
 * NO LITERALS: the class list comes from the source lookup, the stylesheet URL from the
 * served document, the book list from /api/modules, and the themeColors from each book's
 * own payload.
 *
 * Run:  node gates/gate-r-theme.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const BASE = process.env.GATE_BASE || process.env.R_REMOTE || 'http://192.168.100.66:8767';  // P6b 24-09-26: was :8792 (retired)
const HERE = fileURLToPath(new URL('.', import.meta.url));
const PANEL_SRC = process.env.GATE_PANEL_SRC || `${HERE}../app/frontend/src/reader/blocks/PanelBlock.tsx`;

/** The ONE host ruling R8 bans. KaTeX / marked CDNs are deliberately NOT in this list. */
const BANNED_HOST = 'cdn.tailwindcss.com';

const results = [];
const check = (id, pass, detail) => {
  results.push({ id, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${id}  ${detail}`);
};

// ── derive the required class list FROM THE SOURCE LOOKUP ─────────────────────
const panel = readFileSync(PANEL_SRC, 'utf8');
const lookupBlock = panel.match(/THEME_TITLE_CLASS[^=]*=\s*\{([\s\S]*?)\n\};/);
if (!lookupBlock) throw new Error(`gate refused: THEME_TITLE_CLASS not found in ${PANEL_SRC}`);
const themeKeys = [...lookupBlock[1].matchAll(/'([^']+)'\s*:\s*'([^']*)'/g)].map((m) => ({ key: m[1], cls: m[2] }));
if (!themeKeys.length) throw new Error('gate refused: THEME_TITLE_CLASS parsed to zero entries');
// The colour utility is the part the purge can delete; the layout classes are shared.
const colourClasses = themeKeys.map((t) => (t.cls.match(/text-[a-z]+-\d{3}/) || [])[0]).filter(Boolean);
if (colourClasses.length !== themeKeys.length) {
  throw new Error('gate refused: a THEME_TITLE_CLASS entry has no text-<colour>-<n> utility');
}

// ── read the served document and its stylesheet ───────────────────────────────
const text = async (p) => {
  const r = await fetch(p.startsWith('http') ? p : `${BASE}${p}`);
  if (!r.ok) throw new Error(`read failed: GET ${p} -> ${r.status}`);
  return r.text();
};
const indexHtml = await text('/');
const cssRefs = [...new Set([...indexHtml.matchAll(/href="(\/assets\/[^"]+\.css)"/g)].map((m) => m[1]))];
if (!cssRefs.length) throw new Error('gate refused: the served index.html references no /assets/*.css');
let css = '';
for (const ref of cssRefs) css += await text(ref);

// R-THEME1 — every theme colour utility survived the purge, IN THE BUILT CSS.
const missing = colourClasses.filter((c) => !css.includes(`.${c}{`) && !css.includes(`.${c} {`));
check('R-THEME1 BUILT CSS carries every THEME_TITLE_CLASS colour utility (the purge kept them)',
  missing.length === 0 && colourClasses.length >= themeKeys.length,
  `lookupEntries=${themeKeys.length} (DERIVED from PanelBlock.tsx, not a literal — it is 10, not 9)`
  + ` cssFiles=${cssRefs.length} cssBytes=${css.length} present=${colourClasses.length - missing.length}`
  + ` missing=${missing.length}${missing.length ? ` [${missing.join(', ')}]` : ''}`
  + ' — MEASURED 0 of 10 present before item A, while the app still looked right because the'
  + ' Tailwind CDN compiled them in the browser.');

// R-THEME2 — the served document does not reference the banned host.
check(`R-THEME2 the served index.html makes NO reference to ${BANNED_HOST}`,
  !indexHtml.includes(BANNED_HOST),
  `indexBytes=${indexHtml.length} hostOccurrences=${indexHtml.split(BANNED_HOST).length - 1}`
  + ' — ruling R8 moved :8767 off this host; :8792 replaces :8767 at the Phase 06 cutover.'
  + ' KaTeX and marked CDNs are deliberately NOT banned here (Phase 05 item).');

// R-THEME5 — utilities are genuinely in the BUILD, not merely "some CSS exists".
// A build that emitted only the hand-written component classes would pass a byte-size
// check and fail this one. Sampled from classes the source actually uses.
const utilitySamples = ['.px-6', '.flex', '.rounded-lg', '.text-white', '.hidden'];
const utilitiesFound = utilitySamples.filter((u) => css.includes(`${u}{`) || css.includes(`${u} {`));
check('R-THEME5 the built CSS contains real Tailwind UTILITIES, not just hand-written component classes',
  utilitiesFound.length === utilitySamples.length,
  `found ${utilitiesFound.length}/${utilitySamples.length}: ${utilitiesFound.join(' ')}`
  + ` | missing: ${utilitySamples.filter((u) => !utilitiesFound.includes(u)).join(' ') || 'none'}`
  + ' — before item A the built sheet was 3,454 bytes and contained ZERO utilities.');

// R-THEME4 — the typography plugin survived (`?plugins=typography` was load-bearing).
//
// ⛔⛔ VACUITY #17, FOUND BY THIS GATE'S OWN FAULT PROOF AND FIXED BEFORE IT SHIPPED.
//     The first form counted every `.prose` occurrence and floored it at `> 0`. Fault A3
//     removed @tailwindcss/typography from tailwind.config.js and rebuilt — and the gate
//     still reported **PASS at proseRuleOccurrences=1**, because src/styles/app.css ships
//     its OWN hand-written `#tutorial-content.prose :where(p, ul, ol, li, blockquote)` rule.
//     A `> 0` floor that the app satisfies by itself cannot detect a missing dependency,
//     which is the ONLY thing this assertion exists to detect. Measured 22-09-26:
//       with plugin -> 96 occurrences ; without plugin -> 1 (the app's own rule).
//
//     THE FIX IS A **PLUGIN-ONLY MARKER**, not a bigger number. `.prose-invert` is emitted
//     by @tailwindcss/typography and by nothing else in this tree — reader/ReaderScreen.tsx
//     asks for it but no hand-written rule defines it. A count floor would have needed a
//     literal (96), which is the stale-literal class; a name is stable across plugin
//     versions in a way a rule count is not.
// ⚠ The hand-written override is asserted too, in the same breath: it is what makes the
//   reader's font-size inherit, and losing it is a different failure with the same symptom.
const proseRules = (css.match(/\.prose[\s,.:>{[]/g) || []).length;
const hasInvert = /\.prose-invert[\s,.:>{[]/.test(css);
const hasAppOverride = css.includes('#tutorial-content.prose');
check('R-THEME4 the typography PLUGIN is in the build — `.prose-invert` exists (a plugin-only '
  + 'marker), and the app\'s own `#tutorial-content.prose` override survives alongside it',
  hasInvert && hasAppOverride,
  `proseInvertPresent=${hasInvert} appOverridePresent=${hasAppOverride}`
  + ` proseRuleOccurrences=${proseRules} (REPORTED, NOT ASSERTED — see the vacuity note above:`
  + ' a `> 0` floor on this number reads PASS at 1 with the plugin removed)'
  + ' — reader/ReaderScreen.tsx renders `#tutorial-content` with `prose prose-invert'
  + ' max-w-none`; with no plugin those classes resolve to nothing and the reader loses every'
  + ' paragraph, list and blockquote style.');

// ── browse BOTH books: no fallback stamps, no request to the banned host ──────
const modules = (await (await fetch(`${BASE}/api/modules`)).json()).books ?? [];
const bookFiles = [...new Map(modules.map((b) => [b.moduleId, b.file])).entries()];
if (!bookFiles.length) throw new Error('gate refused: /api/modules returned no books');

const browser = await chromium.launch({ executablePath: process.env.GATE_CHROME || chromium.executablePath() });
let fallbackTotal = 0, bannedRequests = 0, panelsSeen = 0, themedSeen = 0, lessonsVisited = 0;
const perBook = [];
const uncoveredThemes = [];

for (const [moduleId, file] of bookFiles) {
  const doc = await (await fetch(`${BASE}/book/${moduleId}/module.json`)).json();
  const sections = doc?.tutorialData?.sections ?? [];
  // Every DISTINCT themeColor this book actually carries, and whether the lookup covers it.
  const themes = [...new Set(sections.map((s) => s.themeColor).filter(Boolean))];
  for (const t of themes) if (!themeKeys.some((k) => k.key === t)) uncoveredThemes.push(`${moduleId}:${t}`);

  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await ctx.addInitScript((f) => { try { window.localStorage.setItem('eduActiveBook', f); } catch { /* blocked */ } }, file);
  const page = await ctx.newPage();
  // ⛔ THE REQUEST LOG IS THE PROOF. A document grep shows the tag is gone; only the network
  //    log shows nothing FETCHES it (an injected script tag would not appear in the HTML).
  page.on('request', (r) => { if (r.url().includes(BANNED_HOST)) bannedRequests += 1; });

  // ⛔ DERIVED SAMPLE: one lesson per chapter that HAS a themed panel, so every distinct
  //    themeColor in the book is actually rendered. Visiting one lesson would make a zero
  //    fallback count meaningless.
  let bookFallback = 0, bookPanels = 0, bookThemed = 0;
  for (let ci = 0; ci < sections.length; ci += 1) {
    const items = sections[ci].items || [];
    const bi = items.findIndex((it) => (it?.blocks || []).some((b) => b && b.type !== 'text' && b.title));
    if (bi < 0) continue;
    await page.goto('about:blank');
    await page.goto(`${BASE}/#chapter=${ci + 1}&block=${bi + 1}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1200);
    lessonsVisited += 1;
    const m = await page.evaluate(() => {
      const c = document.getElementById('tutorial-content');
      if (!c) return { fb: 0, panels: 0, themed: 0 };
      return {
        fb: c.querySelectorAll('[data-theme-fallback]').length,
        panels: c.querySelectorAll('section h3').length,
        themed: [...c.querySelectorAll('section h3')]
          .filter((h) => /(^|\s)text-(indigo|emerald|purple|teal|amber|sky|rose|violet|blue|brand)-\d{3}(\s|$)/.test(h.className)).length,
      };
    });
    bookFallback += m.fb; bookPanels += m.panels; bookThemed += m.themed;
  }
  await ctx.close();
  fallbackTotal += bookFallback; panelsSeen += bookPanels; themedSeen += bookThemed;
  perBook.push(`${moduleId}: themes=${themes.length} fallbackStamps=${bookFallback} panelTitles=${bookPanels} themedTitles=${bookThemed}`);
}
await browser.close();

// R-THEME3 — the fallback stamp is how an unknown themeColor announces itself.
check('R-THEME3 a browse of BOTH books yields ZERO [data-theme-fallback] elements, and every '
  + 'live themeColor is covered by the lookup',
  fallbackTotal === 0 && uncoveredThemes.length === 0 && lessonsVisited > 0 && panelsSeen > 0,
  `books=${bookFiles.length} lessonsVisited=${lessonsVisited} fallbackStamps=${fallbackTotal}`
  + ` uncoveredThemeColors=${uncoveredThemes.length}${uncoveredThemes.length ? ` [${uncoveredThemes.join(', ')}]` : ''}`
  + ` | ${perBook.join(' | ')}`
  + ' — ANTI-VACUITY: lessonsVisited and panelTitles must both be > 0, or "zero fallbacks"'
  + ' just means nothing was rendered. ⛔ No `safelist` may ever be added to make this green:'
  + ' a safelist hides a runtime construction instead of removing it.');

// R-THEME6 — nothing on the wire goes to the banned host.
check(`R-THEME6 a full browse makes ZERO network requests to ${BANNED_HOST}`,
  bannedRequests === 0 && lessonsVisited > 0,
  `requestsToBannedHost=${bannedRequests} over ${lessonsVisited} lesson loads across`
  + ` ${bookFiles.length} book(s) — the document grep (R-THEME2) cannot see a script injected`
  + ' at runtime; the request log can.');

console.log(`\n${results.filter((r) => r.pass).length}/${results.length} passed`);
const failed = results.filter((r) => !r.pass);
if (failed.length) console.log('FAILED: ' + failed.map((r) => r.id).join(', '));
if (failed.length) process.exit(1);
