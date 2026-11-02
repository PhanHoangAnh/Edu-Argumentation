// Seam 15 (reader/BlockRenderer), leaf 2 — EVERY VISUAL ELEMENT.
//
// R6 scope is "figures, pictures, graphs, diagrams, charts, tables-as-images and
// displayed equations" — NOT just `type: figure`. They are one class here so the
// ordering rule cannot be applied to some of them and missed on the rest.
//
// PORTED FROM (by symbol, app.js): the figure/diagram branch of appendTheoryContent,
// assetPanel, bookImage, renderEquationInto, sanitizeSvg.
//
// ⛔⛔ BOTH RENDERERS MUST EMIT A <figure> INSIDE #tutorial-content (F1c).
//     `assetPanel` and the inline figure-with-svg branch are TWO renderers for the same
//     visual class. Gate A-G17 asserts, per equation:
//         el.closest('figure') !== null  AND  el.closest('#tutorial-content') !== null
//     If either renderer emits something other than a <figure>, A-G17 goes VACUOUS —
//     it passed 21/21 on the unfixed file until every test equation was wrapped in a
//     real <figure class="my-8">.
//
// ⛔ `.katex svg { height: inherit !important }` is REQUIRED by 21 of 124 equations (B2).
//    Without it `#tutorial-content figure svg { height:auto }` collapses KaTeX's radical
//    to 1.9 px over a 70.3 px radicand — wrong maths on screen. The fix stays
//    `.katex`-SCOPED: gate A-G18 exists because an unscoped `svg{}` rule relayouts the
//    logo, the upload icon and the hamburger.
//
// ⛔ Inline SVG is injected as markup, so it goes through sanitizeSvg first. "It is our
//    own data" is not a security model — a custom module can be uploaded from disk.
import { useMemo, useState } from 'react';
import { RichTextViewer } from '../RichTextViewer';
import { assetUrl } from '../../data/bookPaths';
import { sanitizeSvg } from './sanitizeSvg';
import { renderEquationHtml } from './renderEquation';
import type { SubBlock } from '../../data/types';

export interface VisualBlockProps {
  block: SubBlock;
  assetBase: string;
  /** assetPanel(block, compact) — the equation/asset panel has a compact variant. */
  compact?: boolean;
}

/**
 * bookImage(src, alt) — ported by symbol from app.js.
 *
 * The white card is not decoration: book figures are printed on white, so on the dark page
 * an un-carded figure floats as a bright rectangle with its own margins. The legacy's
 * comment says exactly this. Classes copied verbatim.
 */
function BookImage({ assetBase, src, alt, className }: { assetBase: string; src: string; alt?: string; className?: string }) {
  return (
    <div className={['rounded-lg bg-white p-3 flex justify-center', className].filter(Boolean).join(' ')}>
      <img src={assetUrl(assetBase, src)} alt={alt || ''} loading="lazy" className="max-w-full h-auto" />
    </div>
  );
}

export function VisualBlock({ block, assetBase, compact = false }: VisualBlockProps) {
  const isEquation = block.type === 'equation';

  // ⛔⛔ WHICH LEGACY RENDERER IS THIS? IT DECIDES WHETHER THE PICTURE GETS THE WHITE CARD.
  //     One React component serves BOTH of appendTheoryContent's visual branches, so it has
  //     to know which one routed here. This is the dispatcher's own predicate
  //     (BlockRenderer.tsx / app.js `appendTheoryContent`), written as the SAME EXPRESSION so
  //     the two cannot drift:
  //         block.type === 'equation' || (block.type === 'figure' && block.src && !block.svg)
  //     TRUE  -> assetPanel()            -> bookImage(), i.e. the WHITE CARD
  //     FALSE -> the inline figure branch -> a bare <img>
  //
  // ⚠ MEASURED 22-09-26 on geron-homl3, which is why this is not a cosmetic distinction:
  //   293 of 379 figures are `src`-with-no-`svg`, so they ALL take the asset-panel path and
  //   the white card is their correct, legacy-faithful background. Book figures are printed
  //   on white; without the card they float as bright rectangles on the dark page.
  const isAssetPanel = isEquation || (block.type === 'figure' && !!block.src && !block.svg);

  // sanitizeSvg is a DOM round-trip; do it once per markup string, not per paint.
  const svgHtml = useMemo(() => (block.svg ? sanitizeSvg(block.svg) : null), [block.svg]);

  // ⛔ Computed during RENDER, not in an effect — `rendered` decides whether the toggle
  //    below exists at all, and an effect would decide that one paint too late.
  const equation = useMemo(() => renderEquationHtml(block.latex), [block.latex]);

  // assetPanel's "Show the book's version" toggle. The legacy creates the image lazily on
  // first click and thereafter toggles `hidden-view` on it; mounting it conditionally is
  // the same observable behaviour with no DOM handle to keep.
  const [showOriginal, setShowOriginal] = useState(false);

  return (
    <figure
      className={compact ? 'mb-6 rounded-xl border border-gray-700 bg-gray-900/60 p-4' : 'my-8 rounded-xl border border-gray-700 bg-gray-900/60 p-5'}
      data-visual={String(block.type)}
    >
      {block.title && (
        <h3 className="text-sm font-semibold uppercase tracking-widest text-gray-400 mb-4">
          {block.title}
        </h3>
      )}

      {/*
        THE THREE BODIES — all ported 22-09-26 (slice E). Branch order is the legacy's:
        · svg       -> sanitizeSvg(block.svg) into a centred holder.
        · src, inline branch     -> bare <img> via assetUrl(), loading="lazy".
        · asset-panel branch     -> renderEquationInto(): KaTeX from `latex`, falling back
                       to the book's own picture, with the "Show the book's version" toggle
                       when BOTH a rendered formula and a picture exist.
        Whatever they emit stays INSIDE this <figure>. See the A-G17 note above.
      */}
      {block.svg ? (
        /*
          The inline-SVG holder, ported verbatim from the figure/diagram branch of
          appendTheoryContent. `justify-center` is the "centred holder".

          ⛔⛔ THE TWO ARBITRARY-VARIANT UTILITIES THAT USED TO BE ON THIS DIV — the
              `[ & > svg ] :` child-variant forms of `max-w-full` and `h-auto`, written here
              WITH SPACES so this comment cannot re-create them — WERE REMOVED 22-09-26
              (item A), and this note is why they must not come back.
              ⚠ The spaces are load-bearing. Tailwind's purge scans RAW SOURCE TEXT, comments
                included: the first draft of this note spelled the class names out and the
                build emitted the rule again, byte-identical CSS hash and all. A comment that
                can re-create the thing it documents is worse than no comment.
              They were the mobile scaling rule — a diagram SVG carries explicit width/height
              attributes, so something has to let it shrink. That job is ALREADY done, at
              higher specificity, by src/styles/app.css:154:
                  #tutorial-content figure svg { max-width: 100%; height: auto; display: block; }
              (1,0,2) beats (0,1,1), so the ID rule won even while the utilities existed:
              removing them is provably a no-op on rendering, not a trade.

              WHY IT MATTERED. Under the Tailwind CDN these classes were compiled into a
              RUNTIME-injected stylesheet, invisible to any gate that reads the served CSS
              file. Item A's real build emits them into that file as
                  a class-scoped `... > svg { height: auto }` rule
              and R-G17c (gate-r-dom.mjs) scans EVERY rule whose selector targets <svg> and
              sets a height, allowing only `.katex …` and `#tutorial-content figure …`. A
              selector ending `>svg` that is scoped by a CLASS can travel anywhere that class
              is used, which is exactly the A-G18 hazard: an svg-height rule reaching the
              brand logo, the upload icon or the hamburger.
              ⚠ MEASURED: the rule caused no live damage (chrome 32x32 / 24x24 / 24x24, and
                15 of 15 KaTeX radicals contained and correctly sized — `!important` on
                `.katex svg` outranks it). The red was a REAL finding the gate could only see
                once the CDN was gone, not a regression. It is fixed by DELETING the redundant
                utilities, NOT by widening R-G17c's allow-list — weakening that assertion
                would give back the A-G18 protection to buy a green.
          ⛔ `dangerouslySetInnerHTML` is fed ONLY from sanitizeSvg — see that file's header
             for why "it is our own data" is not a security model here.
        */
        <div
          className="w-full flex justify-center"
          dangerouslySetInnerHTML={{ __html: svgHtml ?? '' }}
        />
      ) : !isAssetPanel && block.src ? (
        /*
          The INLINE branch's bare <img> — reachable only for a figure/diagram that has a
          `src` AND an `svg` (no svg and it would have gone to the asset panel above).
          ⚠ MEASURED 22-09-26 on geron-homl3: ZERO blocks are in that state (86 carry svg,
            293 carry src, disjoint). Kept because it is the legacy's shape and a future
            book may populate both — not because it renders anything today.
        */
        <img src={assetUrl(assetBase, block.src)} alt={block.alt ?? block.caption ?? ''} loading="lazy" />
      ) : (
        /*
          renderEquationInto. Three outcomes, and the ORDER of the checks is the legacy's:
            1. LaTeX parses            -> KaTeX, plus the toggle when a picture also exists
            2. LaTeX missing or throws -> the book's own picture (a wrong formula is worse
                                          than a picture — the legacy's own reasoning)
            3. neither                 -> nothing; the <figure>, caption and explain remain
          ⛔ Whatever this emits stays INSIDE the <figure> above. A-G17 asserts, per
             equation, el.closest('figure') !== null AND el.closest('#tutorial-content')
             !== null; it passed 21/21 on the unfixed file until the wrapper was real.
        */
        <div>
          {equation.rendered && equation.html !== null ? (
            <div
              className="overflow-x-auto text-white text-[1.15em] py-2"
              dangerouslySetInnerHTML={{ __html: equation.html }}
            />
          ) : block.src ? (
            /* assetPanel's own fallback. `block.alt || block.title` is the legacy's alt
               precedence for the NON-equation asset; an equation passes block.title. */
            <BookImage
              assetBase={assetBase}
              src={block.src}
              alt={isEquation ? block.title : block.alt || block.title}
            />
          ) : null}

          {/*
            assetPanel's toggle: only when the formula rendered AND the book also shipped a
            picture of it. Both conditions matter — with no picture there is nothing to
            show, and with no rendered formula the picture is already the main body.
            ⚠ The label is the legacy's, both ways round, and it is the state announcement
              for a control with no other affordance.
          */}
          {equation.rendered && block.src && (
            <>
              {showOriginal && (
                <BookImage assetBase={assetBase} src={block.src} alt={block.title} className="mt-2" />
              )}
              <button
                type="button"
                className="mt-2 min-h-[44px] text-xs font-semibold uppercase tracking-wider text-gray-400 hover:text-white"
                aria-expanded={showOriginal ? 'true' : 'false'}
                onClick={() => setShowOriginal((open) => !open)}
              >
                {showOriginal ? "Hide the book's version" : "Show the book's version"}
              </button>
            </>
          )}
        </div>
      )}

      {block.caption && (
        <figcaption className="mt-4 text-sm text-gray-400 italic text-center mx-auto">
          <RichTextViewer content={block.caption} />
        </figcaption>
      )}

      {/*
        Every symbol explained right under the formula, not in a legend elsewhere
        (user, 17-09-26: going back and forth to decode a formula is distracting).
      */}
      {isEquation && block.explain && (
        <div className="mt-4 pt-4 border-t border-gray-700 text-left text-sm leading-relaxed text-gray-300 mx-auto overflow-x-auto">
          <RichTextViewer content={block.explain} />
        </div>
      )}
    </figure>
  );
}
