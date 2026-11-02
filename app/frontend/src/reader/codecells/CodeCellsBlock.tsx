// Seam 17 (reader/codecells) — POINTER TO LAB. 29-09-26 (user, ch02 v2 format lock):
//   The reading flow no longer shows a copiable/runnable code block — the Lab owns runnable code.
//   This sub-block renders a compact "open in Lab" pointer instead of the CodeCell copy cards.
//
// ⛔ code_cells STAYS in module.json. The Lab (lab/backend/library.py, D5 rule) sources a lesson's
//    runnable code from the "Full script" card first, else from code_cells — so removing code_cells
//    would break the Lab. This component only changes how the READER renders the block; the Lab
//    reads module.json directly and is untouched.
// ⛔ The visible SYNTAX the reader shows now lives in the lesson TEXT as a display-only ```python
//    fence ("### Where — the syntax"), rendered by <rich-text-viewer> with no copy/run.
// ⛔ labCode.ts (lessonHasCode — the header flask-button's D5 mirror) is UNCHANGED, so the
//    lesson-level Lab button still appears exactly when the lesson has code. This pointer and that
//    button open the same /lab/<module>/<lesson> target.
// ⛔ Honours R6 ordering: renders where BlockRenderer puts it, in document order, no grouping.
//
// Ruling R24 (static listings, no Edit/Reset/Run) is preserved and strengthened — nothing runs in
// the reader at all now; a plain link, not a run button.
//
// 29-09-26 (user, ch02 v3): the reader must NOT narrate the Lab. The old instructional label
//   ("Open this lesson's code in the Lab — edit & run it there") over-explained something the
//   user already knows. Reduced to a BARE Lab icon link (aria-label only, no visible sentence).
import type { SubBlock } from '../../data/types';
import { useBookContext } from '../../state/BookProvider';

export function CodeCellsBlock({ block }: { block: SubBlock }) {
  const lesson = block.lesson ?? '';
  const { moduleId } = useBookContext();
  const hasCode =
    Array.isArray(block.cells) &&
    block.cells.some((cell) => cell && typeof cell.source === 'string' && cell.source.trim());
  if (!hasCode || !lesson || !moduleId) return null;
  return (
    <div className="not-prose my-6">
      <a
        href={`/lab/${encodeURIComponent(moduleId)}/${lesson}`}
        target="_blank"
        rel="noopener"
        aria-label="Lab"
        title="Lab"
        className="inline-flex items-center justify-center rounded-lg border border-gray-700 bg-gray-900/60 p-2 text-gray-300 transition-colors hover:border-brand-600 hover:text-white"
      >
        <svg
          className="h-5 w-5 shrink-0"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M9 3h6" />
          <path d="M10 3v6.2L4.6 18.4A1.7 1.7 0 0 0 6.1 21h11.8a1.7 1.7 0 0 0 1.5-2.6L14 9.2V3" />
          <path d="M7.2 14.5h9.6" />
        </svg>
      </a>
    </div>
  );
}
