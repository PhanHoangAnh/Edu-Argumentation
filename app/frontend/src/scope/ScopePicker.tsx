// THE SHARED SCOPE PICKER — book + chapter + block (study-rooms-qna P2, 29-09-26).
//
// Extracted VERBATIM from quiz/QuizSetupScreen.tsx (its #setup-tree fieldset). The quiz-setup
// dialog renders it with allowBookPick={false}, bound to the active book, and its DOM and class
// strings are unchanged — every element, attribute and class below is the dialog's own.
//
// ⛔ `data-block` on each checkbox is a CONTRACT ATTRIBUTE: the gates select
//    `#setup-tree input[data-block="*"]`. Losing it empties that selector.
// ⛔ Ids come from `idBase` ('setup' -> #setup-tree / #setup-blocks-N, the dialog's pinned ids).
//    A second picker on another screen MUST pass its own base, or two #setup-tree would exist
//    (every screen stays mounted).
// ⛔ Class strings are complete literals (Tailwind purge).
import { useEffect, useRef, useState } from 'react';
import { useBook } from '../data/queries';
import { bookLocationFor } from '../data/bookPaths';
import { blocksOfChapter } from '../state/BookProvider';
import { theoryBlockId } from '../state/ProgressProvider';
import type { Chapter, LibraryBook } from '../data/types';
import { FIELD, LABEL } from '../shell/ui';

export interface ScopeValue {
  /** The book FILE (LibraryBook.file) — what the server's load_module takes. */
  bookId: string;
  /** theoryBlockId strings (`ch01-b03`), any order. */
  blocks: string[];
}

export interface ScopePickerProps {
  books: LibraryBook[];
  value: ScopeValue;
  onChange: (next: ScopeValue) => void;
  /** The book <select> renders only when true. */
  allowBookPick: boolean;
  /** Id base for the tree ('setup' is the quiz-setup dialog's pinned set). */
  idBase?: string;
  /** Chapters already in hand (the quiz-setup dialog passes the ACTIVE book's, incl. an uploaded
   *  one). Absent -> the picker loads value.bookId itself (react-query, same cache key). */
  chapters?: Chapter[];
  /** Controlled expansion (the dialog re-expands on every open). Absent -> internal. */
  expanded?: Set<number>;
  onExpandedChange?: (next: Set<number>) => void;
}

/** chapterName (app.js:3115): titles already read "Chapter 3: X"; numbering them again gave "3. Chapter 3: X". */
function chapterName(title: string | undefined, chapterIndex: number): string {
  return String(title || '').replace(/^chapter\s+\d+\s*[:.\-–—]\s*/i, '') || `Chapter ${chapterIndex + 1}`;
}

const CHECKBOX_CLASS = 'h-5 w-5 shrink-0 cursor-pointer rounded accent-brand-600';

/** A checkbox whose `indeterminate` is a DOM property, not an attribute (syncSetupTree). */
function ChapterBox(props: { checked: boolean; indeterminate: boolean; chapterIndex: number; onChange: (on: boolean) => void }) {
  const ref = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = props.indeterminate;
  }, [props.indeterminate]);
  return (
    <input
      ref={ref}
      type="checkbox"
      className={CHECKBOX_CLASS}
      data-chapter={String(props.chapterIndex)}
      checked={props.checked}
      onChange={(event) => props.onChange(event.target.checked)}
    />
  );
}

/** Every block id of a chapter list, in reading order. */
export function scopeBlockIds(chapters: Chapter[]): string[] {
  return chapters.flatMap((chapter, ci) => blocksOfChapter(chapter).map((_b, bi) => theoryBlockId(ci, bi)));
}

export function ScopePicker({ books, value, onChange, allowBookPick, idBase = 'setup', chapters: given, expanded: controlled, onExpandedChange }: ScopePickerProps) {
  const location = !given && value.bookId ? bookLocationFor(value.bookId) : null;
  const { data: fetched, isLoading } = useBook(location?.url ?? null);
  const chapters: Chapter[] = given ?? (Array.isArray(fetched?.tutorialData?.sections) ? (fetched.tutorialData.sections as Chapter[]) : []);
  const [ownExpanded, setOwnExpanded] = useState<Set<number>>(new Set());
  const expanded = controlled ?? ownExpanded;
  const setExpanded = (update: (current: Set<number>) => Set<number>) => {
    const next = update(expanded);
    if (onExpandedChange) onExpandedChange(next);
    else setOwnExpanded(next);
  };
  const selected = new Set(value.blocks);

  const setMany = (list: string[], on: boolean) => {
    const next = new Set(selected);
    list.forEach((id) => (on ? next.add(id) : next.delete(id)));
    onChange({ bookId: value.bookId, blocks: [...next] });
  };

  return (
    <>
      {allowBookPick ? (
        <div className="mb-4">
          <label htmlFor={`${idBase}-book`} className={LABEL}>
            Book
          </label>
          <select
            id={`${idBase}-book`}
            className={FIELD}
            value={value.bookId}
            onChange={(event) => {
              setOwnExpanded(new Set());
              onChange({ bookId: event.target.value, blocks: [] });
            }}
          >
            <option value="">Choose a book</option>
            {books.map((book) => (
              <option key={book.file} value={book.file}>
                {book.title}
              </option>
            ))}
          </select>
          {location && isLoading ? <p className="mt-2 text-sm text-gray-400">Loading…</p> : null}
        </div>
      ) : null}
      {/* min-w-0: a fieldset will not shrink below its widest line by default. */}
      <fieldset className="min-w-0">
        <legend className="sr-only">Chapters and blocks</legend>
        {/* renderSetupTree (app.js:3126), element for element. */}
        <div
          id={`${idBase}-tree`}
          className="max-h-[55vh] overflow-y-auto overscroll-contain rounded-xl border border-gray-700 bg-gray-900/60 divide-y divide-gray-700/70"
        >
          {chapters.map((chapter, ci) => {
            const blockIds = blocksOfChapter(chapter).map((_b, bi) => theoryBlockId(ci, bi));
            const picked = blockIds.filter((id) => selected.has(id)).length;
            const isOpen = expanded.has(ci);
            return (
              <div key={ci} data-chapter-group={String(ci)}>
                {/* Sticky, so a long chapter's blocks never scroll away from their chapter. */}
                <div className="sticky top-0 z-10 flex items-center gap-1 pr-3 bg-gray-900">
                  <button
                    type="button"
                    data-toggle={String(ci)}
                    aria-expanded={isOpen ? 'true' : 'false'}
                    aria-controls={`${idBase}-blocks-${ci}`}
                    aria-label={`Blocks of chapter ${ci + 1}`}
                    className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg text-gray-400 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
                    onClick={() =>
                      setExpanded((current) => {
                        const next = new Set(current);
                        if (next.has(ci)) next.delete(ci);
                        else next.add(ci);
                        return next;
                      })
                    }
                  >
                    <svg
                      className={`w-4 h-4 transition-transform${isOpen ? ' rotate-90' : ''}`}
                      aria-hidden="true"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" />
                    </svg>
                  </button>
                  <label className="flex flex-1 min-w-0 items-center gap-3 min-h-[44px] cursor-pointer">
                    <ChapterBox
                      chapterIndex={ci}
                      checked={picked > 0 && picked === blockIds.length}
                      indeterminate={picked > 0 && picked < blockIds.length}
                      onChange={(on) => setMany(blockIds, on)}
                    />
                    <span className="truncate text-white">{`${ci + 1}. ${chapterName(chapter.title, ci)}`}</span>
                    <span className="ml-auto shrink-0 pl-2 text-xs text-gray-400 tabular-nums" data-tally={String(ci)}>
                      {picked ? `${picked}/${blockIds.length}` : `${blockIds.length}`}
                    </span>
                  </label>
                </div>
                <ul id={`${idBase}-blocks-${ci}`} className={isOpen ? 'pb-2' : 'hidden-view pb-2'}>
                  {blocksOfChapter(chapter).map((block, bi) => {
                    const id = theoryBlockId(ci, bi);
                    return (
                      <li key={id}>
                        <label className="flex items-center gap-3 min-h-[44px] pl-14 pr-3 cursor-pointer hover:bg-gray-800/60">
                          <input
                            type="checkbox"
                            className={CHECKBOX_CLASS}
                            data-block={id}
                            checked={selected.has(id)}
                            onChange={(event) => setMany([id], event.target.checked)}
                          />
                          <span className="min-w-0 text-sm text-gray-300">{`${bi + 1}. ${(block && block.term) || `Block ${bi + 1}`}`}</span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </div>
      </fieldset>
    </>
  );
}
