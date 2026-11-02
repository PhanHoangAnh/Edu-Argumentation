// Seam 14 (reader/TheoryToc) — THE CHAPTER / BLOCK TABLE OF CONTENTS.
//
// Split out of renderTheoryToc (84 lines — one of the six spanning functions). It is its
// own seam because it is the only consumer of chapterProgress()/overallProgress() and
// because it owns four contract selectors on its own.
//
// Contract DOM this seam owns:
//   #toc-nav · `#toc-nav details` · `#toc-nav summary div` · `ol li button` ·
//   `[aria-current="true"]`
//
// ⛔⛔ aria-current — THE ASYMMETRY IS DELIBERATE AND MEASURED.
//     Here it is set ONLY on the current item and OMITTED otherwise (the legacy code
//     does `if (isCurrent) button.setAttribute('aria-current','true')`). In
//     library/BookCard it is set on EVERY card as "true" or "false". Both are reproduced
//     as-is.
//     ⛔ In React, `aria-current={false}` is OMITTED FROM THE DOM ENTIRELY, so the value
//        must be the STRING "true" or `undefined` — never a boolean. Getting this wrong
//        empties `[aria-current="true"]` and reads as a broken port (A3b, fails A-G10/G3).
//
// ⚠ `<details>` / `<summary>` are the real elements, not a div-and-a-click-handler:
//    `#toc-nav details` and `#toc-nav summary div` are both pinned selectors. The current
//    chapter's <details> is OPEN.
// ⚠ The per-chapter meter is a real role="progressbar" with valuenow/min/max and a label.
// ⚠ The page range lives beside the block count here — the reader used to carry
//   "N theory blocks · pages X-Y" above every lesson, repeating a count the sidebar
//   already showed (user, 21-09-26).
import { useBookContext } from '../state/BookProvider';
import { useProgressContext } from '../state/ProgressProvider';
import type { Chapter, TheoryCursor } from '../data/types';

export interface TheoryTocProps {
  cursor: TheoryCursor;
  onSelect: (next: TheoryCursor) => void;
  /** setTocOpen (app.js:263): the panel is hidden by class when closed, at every width. */
  open: boolean;
  onClose: () => void;
}

/** chapterPages (app.js:2170): "20 theory blocks · pages 70-155" -> "pages 70-155". */
function chapterPages(chapter: Chapter | undefined): string {
  const match = /pages?\s+[0-9]+\s*[-\u2013\u2014]\s*[0-9]+|pages?\s+[0-9]+/i.exec(String((chapter && chapter.note) || ''));
  return match ? match[0].toLowerCase() : '';
}

/*
  ⚑ PHASE 04 PARITY (23-09-26): every class string below is renderTheoryToc's (app.js:2175-2257)
    and index.html:319-331's, verbatim. Before this, the summary, the meter, the count line and
    every block button carried NO class — the before-shots show centred, unstyled rows with no
    progress bars and no highlight on the lesson being read — and the page range was read from
    pageStart/pageEnd, which the modules do not carry, so "· pages 21-69" never rendered.
  ⛔ THE PANEL IS STILL ITS OWN SCROLL CONTAINER: `flex flex-col min-h-0 lg:h-full` on the panel
     (so it does not grow), `flex-1 overflow-y-auto` on the nav (the thing that scrolls). D-1.
*/
export function TheoryToc({ cursor, onSelect, open, onClose }: TheoryTocProps) {
  const { chapters, blocksOf } = useBookContext();
  const { chapterProgress, isBlockComplete, overall } = useProgressContext();
  const summary = overall();
  const totalBlocks = chapters.reduce((sum, _chapter, index) => sum + blocksOf(index).length, 0);

  return (
    <div
      id="toc-panel"
      className={`fixed lg:static inset-y-0 left-0 z-50 w-80 max-w-[85vw] lg:w-72 xl:w-80 lg:max-w-none shrink-0 flex flex-col min-h-0 bg-gray-800 border border-gray-700 rounded-xl lg:h-full${open ? '' : ' hidden-view'}`}
      aria-label="Table of contents"
    >
      <div className="px-5 py-4 border-b border-gray-700 flex items-start justify-between gap-3 shrink-0">
        <div>
          <p className="text-white font-semibold text-sm uppercase tracking-widest">Contents</p>
          <p id="toc-summary" className="text-xs text-gray-400 mt-1">
            {`${chapters.length} chapters · ${totalBlocks} blocks · ${summary.done}/${summary.total} done (${summary.percent}%)`}
          </p>
        </div>
        <button
          id="toc-close-btn"
          type="button"
          onClick={onClose}
          className="min-h-[44px] min-w-[44px] -mr-2 rounded-lg text-gray-400 hover:text-white hover:bg-gray-700 transition-colors active:scale-95"
          aria-label="Hide contents"
        >
          <svg className="w-5 h-5 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
      <nav id="toc-nav" className="p-2 flex-1 overflow-y-auto">
        {chapters.map((chapter, chapterIndex) => {
          const blocks = blocksOf(chapterIndex);
          const done = chapterProgress(chapterIndex);
          const pages = chapterPages(chapter);
          return (
            // ⚠ The key carries the CURSOR: renderTheoryToc rebuilds the whole nav on every
            //   selection, so every chapter a reader toggled open snaps back to "only the current
            //   chapter open". A cursor-keyed remount reproduces that; a stable key would keep
            //   the toggles, which is a different behaviour.
            <details
              key={`${chapterIndex}@${cursor.chapterIndex}.${cursor.blockIndex}`}
              open={chapterIndex === cursor.chapterIndex}
              className="rounded-lg"
            >
              <summary className="cursor-pointer select-none rounded-lg px-3 py-3 text-sm font-semibold text-gray-200 hover:bg-gray-700 transition-colors">
                {/* `#toc-nav summary div` — a pinned selector. Keep the wrapper. */}
                <div className="flex items-baseline justify-between gap-2">
                  <span className="min-w-0">{chapter.title}</span>
                  <span
                    className={`shrink-0 text-xs font-bold tabular-nums ${
                      done.percent === 100 ? 'text-green-400' : done.percent > 0 ? 'text-brand-400' : 'text-gray-500'
                    }`}
                  >{`${done.percent}%`}</span>
                </div>
                <div
                  className="mt-2 h-1 w-full rounded-full bg-gray-700 overflow-hidden"
                  role="progressbar"
                  aria-valuenow={done.percent}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label={`${chapter.title} progress`}
                >
                  <div
                    className={`h-full rounded-full transition-all ${done.percent === 100 ? 'bg-green-500' : 'bg-brand-600'}`}
                    style={{ width: `${done.percent}%` }}
                  />
                </div>
                <div className="mt-1 text-[0.7rem] font-normal text-gray-500 tabular-nums">
                  {`${done.done} of ${done.total} blocks${pages ? ` · ${pages}` : ''}`}
                </div>
              </summary>
              <ol className="mb-2 px-2 space-y-1">
                {blocks.map((block, blockIndex) => {
                  const isCurrent = chapterIndex === cursor.chapterIndex && blockIndex === cursor.blockIndex;
                  const complete = isBlockComplete(chapterIndex, blockIndex);
                  // The legacy builds the class from two literals and then SWAPS text-gray-400
                  // for text-green-400 on a completed block (classList.add/remove) — reproduced
                  // as the resulting literal strings, never an interpolated colour.
                  const base = 'w-full text-left rounded-md px-3 py-2 text-sm leading-5 min-h-[44px] transition-colors ';
                  const cls = isCurrent
                    ? `${base}bg-brand-600/15 text-white font-semibold border-l-2 border-brand-600${complete ? ' text-green-400' : ''}`
                    : complete
                      ? `${base}hover:bg-gray-700 hover:text-white border-l-2 border-transparent text-green-400`
                      : `${base}text-gray-400 hover:bg-gray-700 hover:text-white border-l-2 border-transparent`;
                  return (
                    <li key={blockIndex}>
                      <button
                        type="button"
                        className={cls}
                        // ⛔ String or undefined. NEVER a boolean. See the header.
                        aria-current={isCurrent ? 'true' : undefined}
                        title={complete ? 'Completed — 100% on this block’s assessment' : undefined}
                        onClick={() => onSelect({ chapterIndex, blockIndex })}
                      >
                        {`${complete ? '✓ ' : ''}${blockIndex + 1}. ${block.term || 'Theory block'}`}
                      </button>
                    </li>
                  );
                })}
              </ol>
            </details>
          );
        })}
      </nav>
    </div>
  );
}
