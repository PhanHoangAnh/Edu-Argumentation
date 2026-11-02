// Seam 15 (reader/BlockRenderer), leaf 2's helper — SVG SANITISATION.
//
// PORTED VERBATIM FROM (by symbol): aws-quiz-app/js/app.js `sanitizeSvg`. Rule for rule,
// in the same order, with the same selector list — not reinterpreted.
//
// ⛔ WHY THIS EXISTS AT ALL. Inline SVG reaches the DOM as MARKUP (`dangerouslySetInnerHTML`
//    here, `holder.innerHTML` in the legacy), so the framework's escaping is bypassed by
//    construction. "It is our own book data" is NOT a security model: the app ships a
//    `#custom-data-upload` file input, so a module can be loaded from disk by the reader.
//
// ⛔ THIS IS THE ONLY PLACE `dangerouslySetInnerHTML` IS FED IN THE READER, and its one
//    caller (VisualBlock) passes the output of this function. Do not add a second path.
//
// Three removals, all from the legacy:
//   1. `script, foreignObject, iframe, object, embed` elements — foreignObject is the
//      non-obvious one: it embeds arbitrary HTML (including <script>) inside an <svg>.
//   2. every `on*` attribute (onload, onclick, onmouseover, …), matched case-insensitively.
//   3. `href` / `xlink:href` whose value is a `javascript:` URL.
//
// ⚠ NO-DOM FALLBACK, and it FAILS CLOSED. `document` is absent under
//   `renderToStaticMarkup` in a bare node harness (the R6 behavioural probe supplies a DOM
//   shim, so it is unaffected). Returning '' there means a headless render shows an empty
//   holder; returning the raw markup would emit UNSANITISED SVG. An empty figure is a
//   visible, diagnosable gap. Silent injection is not.
export function sanitizeSvg(markup: string | undefined): string {
  if (typeof document === 'undefined') return '';
  const holder = document.createElement('div');
  holder.innerHTML = String(markup || '');
  holder.querySelectorAll('script, foreignObject, iframe, object, embed').forEach((el) => el.remove());
  holder.querySelectorAll('*').forEach((el) => {
    [...el.attributes].forEach((attr) => {
      const name = attr.name.toLowerCase();
      if (name.startsWith('on')) el.removeAttribute(attr.name);
      if ((name === 'href' || name === 'xlink:href') && /^\s*javascript:/i.test(attr.value)) {
        el.removeAttribute(attr.name);
      }
    });
  });
  return holder.innerHTML;
}
