// Seam 15 (reader/BlockRenderer), leaf 3 — CALLOUT / DEFAULT PANEL / DEEPER.
//
// PORTED FROM (by symbol, app.js): the tail of appendTheoryContent (the callout and
// default `section` panel, including the themed title and the bullet list), renderDeeper.
//
// ⛔⛔ THE THEME TITLE IS A **LOOKUP OF COMPLETE CLASS STRINGS**, NEVER AN INTERPOLATION.
//     This is the Tailwind purge landmine that slice C fixed in the legacy app, and it
//     is just as live here: the CDN generated CSS at RUNTIME by watching the DOM, so an
//     assembled class name worked. A REAL BUILD PURGES BY SCANNING SOURCE and keeps only
//     classes whose COMPLETE NAME appears literally in a scanned file.
//     ⛔ Never `text-${theme}`. ⛔ Never a tailwind.config `safelist` — a safelist makes
//        the build green while LEAVING THE CONSTRUCTION IN PLACE, so the next themeColor
//        a book introduces loses its colour silently all over again.
//     An unknown value takes the brand-600 fallback AND stamps data-theme-fallback, so a
//     data defect becomes visible instead of silent. The gate is: a full browse of both
//     books yields ZERO [data-theme-fallback] elements.
//
// ⚠ THE LOOKUP IS **10** ENTRIES, NOT 9. Slice C measured a tenth against the DEPLOYED
//   corpus: `blue-500`, carried by data/Deployment-MLOps.json, which is live on nn. It
//   is a real Tailwind colour, so a build would have purged a colour that worked.
//   `aws-indigo` is deliberately ABSENT — it is not a Tailwind colour and never was in
//   the brand palette, so it produced no rule under the CDN either. It takes the
//   fallback and stamps itself. Inventing a hex would be guessing at a designer's intent.
import { RichTextViewer } from '../RichTextViewer';
import type { SubBlock } from '../../data/types';

/** ⛔ COMPLETE CLASS STRINGS. Never concatenated, never interpolated. */
export const THEME_TITLE_CLASS: Record<string, string> = {
  'indigo-500': 'text-lg font-semibold text-indigo-500 mb-3',
  'emerald-500': 'text-lg font-semibold text-emerald-500 mb-3',
  'purple-500': 'text-lg font-semibold text-purple-500 mb-3',
  'teal-500': 'text-lg font-semibold text-teal-500 mb-3',
  'amber-500': 'text-lg font-semibold text-amber-500 mb-3',
  'sky-500': 'text-lg font-semibold text-sky-500 mb-3',
  'rose-500': 'text-lg font-semibold text-rose-500 mb-3',
  'violet-500': 'text-lg font-semibold text-violet-500 mb-3',
  'blue-500': 'text-lg font-semibold text-blue-500 mb-3',
  'brand-600': 'text-lg font-semibold text-brand-600 mb-3',
};

export const THEME_TITLE_CLASS_FALLBACK = THEME_TITLE_CLASS['brand-600'];

export interface PanelBlockProps {
  block: SubBlock;
  /** chapter.themeColor, already defaulted to 'brand-600' by the caller. */
  theme: string;
}

/** Title prefix of a lesson's runnable-script card. Same prefix the Lab keys on
 *  (lab/backend/library.py FULL_SCRIPT_PREFIX) — the Lab sources a lesson's code from it. */
const FULL_SCRIPT_PREFIX = 'Full script';

export function PanelBlock({ block, theme }: PanelBlockProps) {
  // 29-09-26 (user, ch02 v3): the reader is explanation only; runnable code lives in the Lab.
  // A "Full script" card is a copiable code listing, so the READER renders nothing for it.
  // ⛔ The card STAYS in module.json — the Lab reads it first (D5 rule). This is a render-null
  //    for one block, like CodeCellsBlock with no code; BlockRenderer's order is untouched (R6).
  if (block.type === 'card' && typeof block.title === 'string' && block.title.startsWith(FULL_SCRIPT_PREFIX)) {
    return null;
  }
  const isCallout = block.type === 'callout';
  const known = Object.prototype.hasOwnProperty.call(THEME_TITLE_CLASS, theme);
  const bullets = Array.isArray(block.items)
    ? block.items
    : Array.isArray(block.bullets)
      ? block.bullets
      : null;

  return (
    <section
      className={
        isCallout
          ? 'my-6 rounded-xl border border-brand-600/40 bg-brand-600/5 p-5'
          : 'my-6 rounded-xl border border-gray-700 bg-gray-900/60 p-5'
      }
    >
      {block.title && (
        <h3
          className={
            isCallout
              ? 'text-lg font-semibold text-brand-400 mb-3'
              : THEME_TITLE_CLASS[theme] ?? THEME_TITLE_CLASS_FALLBACK
          }
          data-theme-fallback={!isCallout && !known ? String(theme) : undefined}
        >
          {block.title}
        </h3>
      )}

      {(block.content || block.intro) && (
        <div className="leading-relaxed">
          <RichTextViewer content={block.content ?? block.intro ?? ''} />
        </div>
      )}

      {bullets && (
        <ul className="mt-3 space-y-3">
          {bullets.map((entry, index) => (
            <TutorialListItem key={index} content={String(entry)} />
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * tmpl-tutorial-list-item (index.html:463-468), element for element: a flex row, a brand dot,
 * and a `leading-relaxed` span holding the rich text. ⚑ Phase 04 parity: the port rendered a
 * bare <li><span> and the browser's own disc bullets appeared instead of the brand dot.
 */
export function TutorialListItem({ content }: { content: string }) {
  return (
    <li className="flex items-start gap-4">
      <div className="w-1.5 h-1.5 rounded-full bg-brand-600 mt-2.5 shrink-0" />
      <span className="leading-relaxed">
        <RichTextViewer content={content} />
      </span>
    </li>
  );
}
