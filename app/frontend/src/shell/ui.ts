// THE APP'S DESIGN VOCABULARY — one place, so a new screen cannot drift from the old ones.
//
// ⚑ 23-09-26 (user, verbatim): "the shade of the red filled button like continue reading on the home
//   page is the correct red shade, while Account page button is vastly different, both font, font
//   size, shade of red. Even the sign in screen is also off compare to the rest of the UI".
//   The Account page and the sign-in page had each invented their own button (bg-red-700,
//   rounded-[10px], normal-case), their own input (px-4, text-sm, a ring) and their own heading
//   scale. Every string below is COPIED VERBATIM from a screen that already shipped — nothing here
//   is new. gates/gate-r-style.mjs measures the result with getComputedStyle, pair by pair.
//
// ⛔ PURGE LANDMINE (ruling R8): every class is a COMPLETE LITERAL. Never assemble a class name.
// ⛔ Do not "improve" a string here without changing its source screen in the same edit — the
//    point of this file is that the home page and the new screens are the SAME string.

/** The home page's "Continue reading" button (#read-tutorial-btn), verbatim. THE primary button. */
export const PRIMARY_BTN =
  'min-h-[44px] px-6 rounded-lg bg-brand-600 hover:bg-brand-900 text-white font-bold uppercase tracking-wider text-sm transition-colors active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white disabled:opacity-50 disabled:cursor-not-allowed';

/** The home page's "Practice" / "Generate quiz" outline button, verbatim. THE secondary button. */
export const OUTLINE_BTN =
  'inline-flex items-center justify-center min-h-[44px] px-5 rounded-lg border border-gray-600 text-gray-200 hover:border-brand-600 hover:text-white font-semibold uppercase tracking-wider text-sm transition-colors active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 disabled:opacity-50 disabled:cursor-not-allowed';

/**
 * The Settings page's text input, verbatim, plus ONE focus addition: `focus:ring-1
 * focus:ring-brand-600`. The Settings original signalled focus by recolouring a 1px border only,
 * which is hard to see; the ring doubles it in the same brand red (#ef5b5b, already the focus
 * colour of OUTLINE_BTN). Resting state is unchanged, so every getComputedStyle pair still matches.
 * ⚠ No `text-sm`: the input inherits the body's 16px, which also stops iOS zooming on focus.
 */
export const FIELD =
  'w-full min-h-[44px] rounded-lg border border-gray-600 bg-gray-900 px-3 py-2 text-white placeholder-gray-500 focus:border-brand-600 focus:outline-none focus:ring-1 focus:ring-brand-600 transition-colors';

/** An input whose value was rejected: same box, the border in brand-400 (== Tailwind red-400). */
export const FIELD_INVALID =
  'w-full min-h-[44px] rounded-lg border border-brand-400 bg-gray-900 px-3 py-2 text-white placeholder-gray-500 focus:border-brand-600 focus:outline-none focus:ring-1 focus:ring-brand-600 transition-colors';

/** The Settings page's field label, verbatim. */
export const LABEL = 'block text-sm font-semibold text-gray-200 mb-2';

/** The home page's card (#welcome-screen) and every Settings card, verbatim. */
export const CARD = 'bg-gray-800 border border-gray-700 rounded-2xl p-6 sm:p-8';

/** The small red caps line above a title ("Current book" on the home page), verbatim. */
export const EYEBROW = 'text-xs font-semibold uppercase tracking-widest text-brand-600';

/** The home page's big title (#welcome-title), verbatim. A page's h1. */
export const PAGE_TITLE = 'mt-2 text-3xl sm:text-4xl font-light text-white leading-tight';

/** The home page's section headings (#home-kpis-heading, #library-heading), verbatim. */
export const SECTION_TITLE = 'text-2xl text-white font-light';

/** The home page's secondary line (#current-meta), verbatim. Body copy on a card. */
export const BODY_MUTED = 'mt-2 text-sm text-gray-400';

/** The KPI tile caption / table header scale on the home page, verbatim. */
export const CAPTION = 'text-xs uppercase tracking-wider text-gray-400';
