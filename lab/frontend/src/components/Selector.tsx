import type { Book } from '../api';
import type { ReactNode } from 'react';
import type { SelectorPlace } from '../layout';

// ⚑ 25-09-26 (user): THREE dropdowns — Book, Chapter, Lesson — and nothing else (the lesson list
//   is gone). The box is the study app's field (app/frontend/src/shell/ui.ts FIELD: gray-900 fill,
//   gray-600 border, brand-red focus); the caption is its CAPTION. lab-select (app.css) adds the
//   chevron and an ellipsis for a long name; the full name is the tooltip.
// It sits either as one short row above the workspace ('top') or as a left column ('sidebar');
// the glyph button switches, and only shows where a sidebar can exist (lg+).
const SELECT =
  'lab-select w-full min-w-0 min-h-[44px] rounded-lg border border-gray-600 bg-gray-900 pl-3 py-2 text-sm text-white focus:border-brand-600 focus:outline-none focus:ring-1 focus:ring-brand-600 transition-colors disabled:opacity-50';
const CAPTION = 'min-w-0 flex-1 flex flex-col gap-1 text-xs uppercase tracking-wider text-gray-400';

function PlaceGlyph({ place }: { place: SelectorPlace }) {
  // Draws the layout the button switches TO.
  return (
    <svg className="w-5 h-5" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <rect x="2" y="3" width="16" height="14" rx="2" />
      {place === 'sidebar' ? <path d="M7.5 3v14" /> : <path d="M2 8h16" />}
      {place === 'sidebar' ? <rect x="2" y="3" width="5.5" height="14" rx="2" fill="currentColor" opacity="0.35" stroke="none" /> : <rect x="2" y="3" width="16" height="5" rx="2" fill="currentColor" opacity="0.35" stroke="none" />}
    </svg>
  );
}

export function Selector(props: {
  books: Book[];
  bookId: string | null;
  chapterN: number | null;
  lessonId: string | null;
  place: SelectorPlace;
  onBook: (id: string) => void;
  onChapter: (n: number) => void;
  onLesson: (id: string) => void;
  onPlace: (place: SelectorPlace) => void;
  /** 25-09-26: Lab's window glyphs (close / new tab) when it has no header — inside the Learn window. */
  extra?: ReactNode;
}) {
  const book = props.books.find((b) => b.id === props.bookId) ?? null;
  const chapter = book?.chapters.find((c) => c.n === props.chapterN) ?? null;
  const lesson = chapter?.lessons.find((l) => l.id === props.lessonId) ?? null;
  const top = props.place === 'top';
  const other: SelectorPlace = top ? 'sidebar' : 'top';
  return (
    <div
      id="lab-selector"
      data-place={props.place}
      // ⚑ 25-09-26 (user): the three menus SHRINK to the room left (flex-1, min-w-0) so the trailing
      //   buttons stay on the same row at EVERY width — never a column; a long name ends in an ellipsis.
      className={top ? 'flex flex-row items-end gap-2 sm:gap-3' : 'flex flex-col gap-3'}
    >
      {!top ? (
        <div className={`${props.extra ? 'flex' : 'hidden lg:flex'} shrink-0 items-center justify-end gap-2`}>
          <div className="hidden lg:flex">
            <PlaceButton other={other} onPlace={props.onPlace} />
          </div>
          {props.extra}
        </div>
      ) : null}
      <label className={CAPTION}>
        Book
        <select id="lab-book-select" className={SELECT} title={book?.title ?? ''} value={props.bookId ?? ''} onChange={(e) => props.onBook(e.target.value)}>
          {props.books.map((b) => (
            <option key={b.id} value={b.id}>
              {b.title}
            </option>
          ))}
        </select>
      </label>
      <label className={CAPTION}>
        Chapter
        <select
          id="lab-chapter-select"
          className={SELECT}
          title={chapter?.title ?? ''}
          value={props.chapterN ?? ''}
          onChange={(e) => props.onChapter(Number(e.target.value))}
          disabled={!book}
        >
          {(book?.chapters ?? []).map((c) => (
            <option key={c.n} value={c.n}>
              {c.title}
            </option>
          ))}
        </select>
      </label>
      <label className={CAPTION}>
        Lesson
        <select
          id="lab-lesson-select"
          className={SELECT}
          title={lesson ? `${lesson.n}. ${lesson.title}` : ''}
          value={props.lessonId ?? ''}
          onChange={(e) => props.onLesson(e.target.value)}
          disabled={!chapter}
        >
          {!lesson ? (
            <option value="" disabled>
              Choose a lesson…
            </option>
          ) : null}
          {(chapter?.lessons ?? []).map((l) => (
            <option key={l.id} value={l.id}>
              {l.n}. {l.title}
            </option>
          ))}
        </select>
      </label>
      {top ? (
        <div className={`${props.extra ? 'flex' : 'hidden lg:flex'} shrink-0 items-center justify-end gap-2`}>
          <div className="hidden lg:flex">
            <PlaceButton other={other} onPlace={props.onPlace} />
          </div>
          {props.extra}
        </div>
      ) : null}
    </div>
  );
}

function PlaceButton({ other, onPlace }: { other: SelectorPlace; onPlace: (place: SelectorPlace) => void }) {
  const label = other === 'sidebar' ? 'Move the selectors to a left sidebar' : 'Move the selectors to a row on top';
  return (
    <button
      id="lab-selector-place"
      type="button"
      title={label}
      aria-label={label}
      onClick={() => onPlace(other)}
      className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg border border-gray-600 text-gray-400 hover:border-brand-600 hover:text-white transition-colors"
    >
      <PlaceGlyph place={other} />
    </button>
  );
}
