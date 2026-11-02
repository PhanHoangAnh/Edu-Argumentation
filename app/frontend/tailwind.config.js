/**
 * Tailwind BUILD config for the edu-study stack (:8792).
 *
 * edu-replatform Phase 03, item A of the "r8-and-gate-gaps" supplement (22-09-26).
 *
 * ⛔⛔ WHY THIS FILE EXISTS — IT IS A USER RULING, NOT A TIDY-UP.
 *   Ruling R8 (21-09-26) moved :8767 OFF https://cdn.tailwindcss.com?plugins=typography and
 *   onto a real build. :8792 REPLACES :8767 at the Phase 06 cutover, and it was still loading
 *   that same CDN at runtime — so shipping it as-is would have SILENTLY REVERSED R8.
 *   Measured before this file existed: the built CSS contained 0 of the 10 theme class
 *   strings and no Tailwind utility at all; the app only looked right because a public CDN
 *   compiled the classes in the browser on every page load.
 *
 * ⛔⛔ THE PURGE LANDMINE — READ BEFORE EDITING `content`.
 *   A real build PURGES BY SCANNING SOURCE. It can only keep a class whose COMPLETE NAME
 *   appears literally in a scanned file. The CDN could not care: it saw the class after the
 *   DOM was built. In the legacy app `text-${chapter.themeColor}` therefore worked under the
 *   CDN and emitted NOTHING under a build — every themed chapter-panel title went colourless.
 *   In THIS tree that construction never existed: reader/blocks/PanelBlock.tsx ships
 *   THEME_TITLE_CLASS, a lookup of COMPLETE class strings. The globs below are what make that
 *   lookup visible to the purge. Narrowing them silently deletes CSS.
 *
 * ⛔ THE LOOKUP IS **10** ENTRIES, NOT 9. Slice C measured a tenth against the DEPLOYED
 *   corpus: `blue-500`, carried by a live data/*.json. It is a real Tailwind colour, so a
 *   naive content glob would have purged a colour that WORKS. All ten are literal in
 *   PanelBlock.tsx, so `./src/**\/*.{ts,tsx}` keeps them. gates/gate-r-theme.mjs asserts it.
 *
 * ⛔ THERE IS DELIBERATELY NO `safelist`. A safelist makes the build green while leaving a
 *   runtime construction in place — it hides the bug instead of fixing it. The lookup is the
 *   fix; the `data-theme-fallback` stamp is how an unknown value announces itself.
 */
module.exports = {
  darkMode: 'class',
  content: [
    './index.html',
    './src/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      // ⛔ VERBATIM from the inline `tailwind.config` <script> this file replaces
      // (index.html, removed in the same change), which was itself verbatim from
      // aws-quiz-app/tailwind.config.js. Do not "tidy" these hexes — 600 (#ef5b5b) is the
      // brand red used by the logo's middle bar and the mask-icon.
      fontFamily: { sans: ['"Plus Jakarta Sans"', 'sans-serif'] },
      colors: {
        brand: {
          50: '#fef2f2',
          100: '#fee2e2',
          400: '#f87171',
          500: '#ef4444',
          600: '#ef5b5b',
          900: '#222222',
          950: '#111111',
        },
      },
    },
  },
  // ⛔ THE `?plugins=typography` QUERY ON THE OLD CDN URL WAS LOAD-BEARING. `prose` and
  //    `prose-invert` are both used (reader/ReaderScreen.tsx:140) and `not-prose` once
  //    (reader/codecells/CodeCellsBlock.tsx:44). Dropping this plugin removes every prose
  //    style, and the damage reads as "the rewrite looks wrong" rather than as a missing
  //    dependency. It is a real devDependency here (pinned ^0.5.19, matching
  //    tools/tailwind's pin) — NOT resolved through a relative node_modules path, because
  //    app/frontend has its own install and is never rsynced to nn.
  plugins: [require('@tailwindcss/typography')],
};
