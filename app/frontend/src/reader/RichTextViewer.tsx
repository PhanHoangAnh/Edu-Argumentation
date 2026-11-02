// Seam 16 (reader/RichTextViewer) — THE CUSTOM ELEMENT, BYTE-IDENTICAL.
//
// ⛔⛔ `<rich-text-viewer>` STAYS A REAL CUSTOM ELEMENT WITH A REAL SHADOW ROOT.
//     Gate A-G6 reads the SHADOW ROOT (`v.shadowRoot.querySelectorAll('p')`, checking
//     line-height 1.8). A plain React component that renders the same markup passes a
//     class-name check and fails A-G6 on a non-obvious symptom.
//     `#tutorial-content rich-text-viewer` is a pinned contract selector.
//
// ⛔ The source file is IMPORTED UNCHANGED for its `customElements.define` side effect
//    and is sha256-PINNED (execute instruction E4):
//       1810c14a7ae16877df7fa93dd0b5770750e6f82d165b761e1f48e36d07331c70
//       (aws-quiz-app/js/rich-text-viewer.js, measured 21-09-26)
//    ⚠ Do NOT go looking for a "Phase-02 hash" — there is none; that reference named a
//      value that does not exist. Pin the measured baseline above.
//
// ⛔ SET THE ATTRIBUTE VIA A ref + AN EXPLICIT setAttribute — never a JSX prop.
//    JSX prop -> attribute mapping for custom elements is a React-version behaviour
//    this port must not depend on. The explicit path REMOVES the dependency instead of
//    probing it. The value is encodeURIComponent(markdown), exactly as formatText did.
//
// ⚠ ACCEPTED (A3c): every content change rebuilds the shadow root's innerHTML. That is
//   fine for static blocks and wrong for a per-keystroke surface. Phase 03 has none.
// ⚠ KaTeX CSS stays CDN-@import-ed inside the shadow style. ONLY the Tailwind CDN drops
//   in this phase; offline KaTeX is a Phase 05 item.
import { useEffect, useRef } from 'react';
import { CODE_COLOURS_CSS, highlightPython } from './codeColours';

// ── A3c — THE IMPORT, DECIDED AND WRITTEN ─────────────────────────────────────
// A PLAIN RELATIVE SIDE-EFFECT IMPORT. No alias, no copy, no shim.
//
// Chosen over the two alternatives on purpose:
//   ⛔ COPYING the file into src/ would be a PARALLEL COPY of an active file, which repo
//      law bans outright — and it would silently fork the moment :8767 is touched again.
//   ⚠ An ALIAS (resolve.alias) would hide the one path that leaves this root behind a
//      name, so a future reader would not see that the frozen tree is a dependency.
// The relative path is ugly and that is the feature: it is legible as a boundary crossing.
//
// `vite build` (rollup) resolves outside the root unaided; `vite dev` needs the
// server.fs.allow entry in vite.config.ts (EDU_ROOT). Both are in place.
//
// ⛔ THE FILE IS READ-ONLY AND sha256-PINNED. Baseline, measured 21-09-26 and re-measured
//    22-09-26 by this slice:
//        1810c14a7ae16877df7fa93dd0b5770750e6f82d165b761e1f48e36d07331c70
//    Bundling COPIES it into dist/; the SOURCE on disk is never rewritten, which is what
//    the gate hashes. ⚠ Do NOT go looking for a "Phase-02 hash" — there is none.
import '../../../../aws-quiz-app/js/rich-text-viewer.js';

// ⚠ THE ELEMENT NEEDS TWO CDN GLOBALS, AND THEY ARE NOT ITS JOB TO LOAD.
//   `marked`  (rich-text-viewer.js:64)  — no marked, no Markdown: the shadow root gets
//              escaped plain text, no <p> elements, and gate A-G6 fails on a symptom
//              that looks nothing like "a script tag is missing".
//   `renderMathInElement` (:119) + katex.min.css — no KaTeX, no `.katex .sqrt`, so the
//              contract selector `#tutorial-content .katex .sqrt` matches zero elements.
// Both are <script> tags in app/frontend/index.html, mirroring the legacy app's
// index.html:45/48-50. ⛔ KaTeX stays ON THE CDN this phase — only the TAILWIND CDN
// drops in Phase 03 (Step C, already shipped); offline KaTeX is a Phase 05 item.

// React 19 resolves intrinsic elements through `React.JSX`, not the old global `JSX`
// namespace. Augmenting the wrong one compiles and then fails at the use site.
declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      'rich-text-viewer': React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement>,
        HTMLElement
      > & { ref?: React.Ref<HTMLElement> };
    }
  }
}

export interface RichTextViewerProps {
  /** Markdown source. Passed through encodeURIComponent, exactly as formatText did. */
  content: string;
  className?: string;
}

export function RichTextViewer({ content, className }: RichTextViewerProps) {
  const ref = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    // ⛔ setAttribute, not a prop. See the header.
    element.setAttribute('content', encodeURIComponent(content ?? ''));
    // 16-10-26 (user): VS Code-style colours on ```python fences. The element above is sha-pinned and
    // rebuilds its shadow root on every `content` change, so the colours are applied here, AFTER the
    // setAttribute (its callback is synchronous), never inside the pinned file. Text is unchanged —
    // only <span class="tok-…"> wrappers are added — so gates that read the shadow root's text still hold.
    const root = element.shadowRoot;
    if (!root) return;
    const blocks = root.querySelectorAll('pre code.language-python');
    if (!blocks.length) return;
    const style = document.createElement('style');
    style.textContent = CODE_COLOURS_CSS;
    root.appendChild(style);
    blocks.forEach((block) => {
      block.innerHTML = highlightPython(block.textContent ?? '');
    });
  }, [content]);

  return <rich-text-viewer ref={ref} className={className} />;
}
