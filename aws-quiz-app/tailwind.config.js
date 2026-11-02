/**
 * Tailwind build config for the Edu-Argumentation study app (:8767).
 *
 * edu-replatform Phase 03, slice C — file 3 of 3 in the authorised carve-out from the
 * aws-quiz-app/** freeze (user ruling R8, 21-09-26: "Do it to :8767 now, gated and
 * rollback-ready").
 *
 * WHY THIS FILE EXISTS
 *   The app used https://cdn.tailwindcss.com?plugins=typography, which generated CSS AT
 *   RUNTIME by watching the DOM. The brand palette lived in an inline <script> at
 *   index.html:21-31 and DIES with that CDN. ~40 sites use text-brand-400 / bg-brand-600 /
 *   border-brand-600, so without this config every one of them loses its colour.
 *
 * ⛔⛔ THE PURGE LANDMINE — READ BEFORE EDITING `content` BELOW.
 *   A real build PURGES BY SCANNING SOURCE. It can only keep a class whose COMPLETE NAME
 *   appears literally somewhere in the scanned files. The CDN could not care: it saw the
 *   class after the DOM was built.
 *   js/app.js:1664 used to assemble a class name from BOOK DATA:
 *       `text-lg font-semibold text-${theme} mb-3`     where theme = chapter.themeColor
 *   No literal "text-indigo-500" existed anywhere in source, so a build emitted none of them
 *   and every themed chapter-panel title rendered colourless. That construction has been
 *   replaced by a 9-entry lookup of COMPLETE class strings (app.js THEME_TITLE_CLASS).
 *
 * ⛔ THERE IS DELIBERATELY NO `safelist`. A safelist would make the build green while LEAVING
 *   THE RUNTIME CONSTRUCTION IN PLACE — it hides the bug instead of fixing it, and the next
 *   themeColor a book introduces silently loses its colour again. The lookup is the fix; the
 *   `data-theme-fallback` stamp is how an unknown value announces itself.
 *
 * ⛔ CONTENT GLOBS ARE THE WHOLE PURGE CONTRACT. Narrowing them silently deletes CSS. Widening
 *   them into node_modules makes the build crawl. Both files below are REQUIRED:
 *   index.html carries the page shell's classes, js/*.js carries everything rendered.
 */
module.exports = {
  darkMode: 'class',
  content: [
    './index.html',
    './js/**/*.js',
  ],
  theme: {
    extend: {
      // VERBATIM from the inline <script> that this file replaces (index.html:21-31).
      // Do not "tidy" these hexes — 600 (#ef5b5b) is the brand red used by the scrollbar
      // thumb and the mask-icon, and 900/950 are the page greys.
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
  // The CDN was loaded as ?plugins=typography; `prose` and `prose-invert` are both used.
  //
  // ⛔ RESOLVED BY EXPLICIT RELATIVE PATH, NOT A BARE PACKAGE NAME. The build toolchain
  // (package.json + node_modules) lives in ../tools/tailwind/ because deploy.sh rsyncs this
  // WHOLE directory to nn — a node_modules/ here would ship ~100 MB of build tooling to the
  // study host and land inside run-gates.sh's frozen APP_DIR. A bare require() would walk up
  // from here and find nothing.
  //
  // This file is INERT on nn: it is rsynced as a plain file and never executed there. The
  // require only has to resolve on the workstation that runs the build.
  plugins: [require('../tools/tailwind/node_modules/@tailwindcss/typography')],
};
