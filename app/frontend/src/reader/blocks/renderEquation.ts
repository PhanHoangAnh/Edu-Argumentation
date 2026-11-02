// Seam 15 (reader/BlockRenderer), leaf 2's helper — LaTeX -> KaTeX HTML.
//
// PORTED FROM (by symbol): aws-quiz-app/js/app.js `renderEquationInto`.
//
// ⛔⛔ THE FALLBACK IS THE WHOLE POINT, AND IT IS THE LEGACY'S OWN COMMENT:
//     "LaTeX is rendered directly with KaTeX -- never through Markdown, which eats
//      '\\' line breaks and reads '^*' as emphasis. Anything that fails to parse
//      falls back to the book's own picture: a wrong formula is worse than a picture."
//     `throwOnError: true` is what MAKES the fallback reachable. KaTeX's default is to
//     render the failing expression in red and return normally — which would mean a
//     malformed formula renders as red gibberish and the book's own correct picture is
//     never shown. Do not "tidy" that option away.
//
// ⚑ WHY renderToString AND NOT render(). The legacy calls `katex.render(latex, el, opts)`,
//   which is defined as `el.innerHTML = katex.renderToString(latex, opts)` — identical
//   output. renderToString is the correct React shape because the result is known DURING
//   RENDER, not in an effect. That matters for more than tidiness: `assetPanel` shows the
//   "Show the book's version" toggle ONLY when the LaTeX rendered AND a picture exists, so
//   the success/failure answer has to be available at the same moment the toggle is decided.
//   Doing it in a useEffect means the first paint decides the toggle from a guess.
//
// ⚠ THE `typeof katex === 'undefined'` GUARD IS THE LEGACY'S, KEPT VERBATIM. katex.min.js
//   is a CDN <script defer> in app/frontend/index.html; classic `defer` and `type=module`
//   scripts both run in document order after parsing, and the KaTeX tag precedes the React
//   module tag — so katex IS defined before the first block renders. The guard is kept
//   because the CDN can simply fail to load, and the honest behaviour then is the book's
//   picture, not a crash.
//
// ⛔ B2 depends on this rendering REAL KaTeX markup: `.katex svg { height: inherit
//    !important }` (src/styles/app.css) corrects a collapsed radical in 21 of 124
//    equations. No `.katex` output, nothing for that rule to correct, and the contract
//    selector `#tutorial-content .katex .sqrt` matches zero elements.

/** The CDN global. Declared, never bundled — KaTeX stays on the CDN this phase (A3c). */
declare const katex:
  | { renderToString: (expression: string, options?: Record<string, unknown>) => string }
  | undefined;

export interface EquationHtml {
  /** KaTeX's HTML, or null when there is no usable LaTeX. */
  html: string | null;
  /** True only when LaTeX actually parsed. Gates the "book's version" toggle. */
  rendered: boolean;
}

/**
 * renderEquationInto's decision half: does this block render as LaTeX, and if so, as what?
 *
 * The CALLER owns the picture fallback, exactly as the legacy does — `renderEquationInto`
 * appends `bookImage(block.src, block.title)` itself, but in React the image is JSX and
 * belongs in the component. This function answers only the KaTeX question.
 */
export function renderEquationHtml(latex: string | undefined): EquationHtml {
  if (!latex || typeof katex === 'undefined') return { html: null, rendered: false };
  try {
    return {
      html: katex.renderToString(latex, { displayMode: true, throwOnError: true }),
      rendered: true,
    };
  } catch {
    // Fall through to the picture. The legacy swallows this identically.
    return { html: null, rendered: false };
  }
}
