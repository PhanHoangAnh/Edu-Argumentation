// Seam 11 (library/BookCard) — ONE CARD IN THE LIBRARY GRID.
//
// Split out of renderLibrary (one of the six spanning functions). The card is its own
// seam because it carries four of the contract's selectors on its own and because the
// rename affordance (Phase 04) attaches here, not to the grid.
//
// Contract DOM this component owns:
//   #library-grid [data-book]            · every card
//   #library-grid [data-book="*"]        · a specific book's card
//   #library-grid [data-book][aria-current="true"]
//   #library-grid [data-rename="*"]      · the title, double-click to rename
//   #library-grid input[type="text"]     · the rename input (Phase 04 — a WRITE)
//
// ⛔⛔ aria-current IS THE STRING "true"/"false" — NEVER a boolean. React omits
//     aria-current={false} from the DOM ENTIRELY, and the contract selector
//     `[aria-current="true"]` then matches zero elements and reads as a broken port.
//     ⚠ NOTE THE ASYMMETRY, measured from the legacy app and deliberate: the CARD sets
//       aria-current on every card ("true" or "false"); the TOC BUTTON sets it only on
//       the current item and omits it otherwise. Both behaviours are reproduced as-is.
//
// ⚠ It is a <div role="button" tabIndex={0}>, NOT a <button>. The title turns into an
//   <input> on double-click, and an <input> inside a <button> is invalid and unfocusable
//   in browsers. Do not "clean this up" into a <button>.
import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../data/queries';
import { postJson } from '../data/writes';
import type { LibraryBook } from '../data/types';
import { useAccount } from '../account/AccountContext';
import { askConfirm, showNotice } from '../shell/dialog';

export interface BookCardProps {
  book: LibraryBook;
  /** The book currently open. Drives the "Current" chip and aria-current. */
  current: boolean;
  /** Lessons done — the OPEN book reports live progress, others their stored count. */
  done: number;
  onOpen: (file: string) => void;
}

/*
  ⛔⛔ THE CLASS STRINGS ARE VERBATIM FROM `renderLibrary` (aws-quiz-app/js/app.js:465-522),
      ported 22-09-26 (EVL fix 003). A3's header said "A3 OWNS the class strings and the exact
      element order" and A3 shipped the element order WITHOUT them — MEASURED on the deployed
      :8792 before this fix, `#library-grid [data-book]`.className was the EMPTY STRING, as
      were #library-grid, #read-tutorial-btn and #services-section. So the library rendered as
      a bare stack of text lines flush to x=0 and read as "the port is broken".
  ⚠ The card's border/background is CONDITIONAL on `current` in the legacy and stays so here;
    that pair is what the "Current" chip reinforces, and it is the only place `current`
    changes appearance rather than just `aria-current`.
*/
const CARD_BASE =
  'flex flex-col gap-3 text-left rounded-xl border p-5 min-h-[44px] cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600';
const CARD_CURRENT = 'border-brand-600 bg-gray-800';
const CARD_OTHER = 'border-gray-700 bg-gray-800/60 hover:border-gray-500 hover:bg-gray-800';

/** A click on the TITLE waits this long, so the first click of a double-click cannot open or
 *  close the book before the second lands (app.js:1247 TITLE_DBLCLICK_MS). */
const TITLE_DBLCLICK_MS = 260;

export function BookCard({ book, current, done, onOpen }: BookCardProps) {
  const percent = book.lessons ? Math.round((done / book.lessons) * 100) : 0;
  const [editing, setEditing] = useState(false);
  const [shownTitle, setShownTitle] = useState<string | null>(null);
  const titleTimer = useRef<number | null>(null);
  const queryClient = useQueryClient();
  const title = shownTitle ?? book.title;
  const account = useAccount();
  // ⚑ 25-09-26 (user): the OWNER can delete the SELECTED book — an imported (packaged) one, never
  //   the default. The server re-checks all three (POST /api/book/delete) and soft-deletes it.
  const canDelete = current && account.isOwner && Boolean(book.book) && !book.default;
  const [deleting, setDeleting] = useState(false);
  const remove = async () => {
    // 30-09-26 (defect D): the in-app dialog, danger style, focus starts on Cancel.
    const ok = await askConfirm({
      title: `Delete "${title}"?`,
      body: 'It disappears from the library and Lab for every account. It is moved aside on the server, so it can still be restored.',
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    setDeleting(true);
    try {
      const response = await postJson('/api/book/delete', { file: book.file });
      const reply = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(reply.error || `Delete failed (${response.status}).`);
      window.location.assign('/');   // the open book is gone: start clean on the library
    } catch (error) {
      setDeleting(false);
      void showNotice({ title: 'Could not delete the book', body: (error as Error).message });
    }
  };

  /**
   * renameBook (app.js:548) — optimistic: the card redraws at once; on failure it is put
   * back rather than lying about it. The server owns the override (library-meta.json), so it
   * survives another browser; module.json is never rewritten.
   */
  const rename = async (raw: string) => {
    const clean = String(raw || '').replace(/\s+/g, ' ').trim().slice(0, 160);
    if (!clean || clean === title) return;
    const previous = title;
    setShownTitle(clean);
    try {
      const response = await postJson('/api/book/rename', { file: book.file, title: clean });
      if (!response.ok) throw new Error(`Rename failed (${response.status}).`);
      // Keep the listing's copy in step so a later render does not resurrect the old title.
      queryClient.setQueryData(queryKeys.modules, (books: LibraryBook[] | undefined) =>
        Array.isArray(books) ? books.map((entry) => (entry.file === book.file ? { ...entry, title: clean, renamed: true } : entry)) : books,
      );
    } catch (error) {
      setShownTitle(previous);
      void showNotice({ title: 'Could not rename the book', body: (error as Error).message });
    }
  };

  return (
    <div
      role="button"
      tabIndex={0}
      className={`${CARD_BASE} ${current ? CARD_CURRENT : CARD_OTHER}`}
      data-book={book.file}
      aria-current={current ? 'true' : 'false'}
      onClick={(event) => {
        if (editing) return;
        if ((event.target as HTMLElement).closest('[data-rename]')) {
          if (titleTimer.current) window.clearTimeout(titleTimer.current);
          titleTimer.current = window.setTimeout(() => {
            titleTimer.current = null;
            onOpen(book.file);
          }, TITLE_DBLCLICK_MS);
          return;
        }
        onOpen(book.file);
      }}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onOpen(book.file);
        }
      }}
    >
      <div className="flex items-start justify-between gap-3">
        {editing ? (
          // beginRename (app.js:573): Enter commits, Escape and blur cancel; clicks inside must
          // not reach the card, which would open the book.
          <input
            type="text"
            defaultValue={title}
            maxLength={160}
            autoFocus
            onFocus={(event) => event.currentTarget.select()}
            className="w-full min-w-0 rounded-md border border-brand-600 bg-gray-900 px-2 py-1 text-white text-sm focus:outline-none"
            onClick={(event) => event.stopPropagation()}
            onDoubleClick={(event) => event.stopPropagation()}
            onMouseDown={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.key === 'Enter') {
                event.preventDefault();
                const value = event.currentTarget.value;
                setEditing(false);
                void rename(value);
              } else if (event.key === 'Escape') {
                event.preventDefault();
                setEditing(false);
              }
            }}
            onBlur={() => setEditing(false)}
          />
        ) : (
          <h3
            className="text-white font-semibold leading-snug line-clamp-2"
            data-rename={book.file}
            title="Double-click to rename"
            onDoubleClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              if (titleTimer.current) window.clearTimeout(titleTimer.current);   // cancel the deferred open
              titleTimer.current = null;
              setEditing(true);
            }}
          >
            {title}
          </h3>
        )}
        {current && (
          <span
            className="shrink-0 rounded-full bg-brand-600/15 px-2.5 py-1 text-xs font-semibold text-brand-400"
            title="Click the card to close this book"
          >
            Current
          </span>
        )}
      </div>
      <p className="text-xs text-gray-400">
        {book.chapters === 1 ? '1 chapter' : `${book.chapters.toLocaleString()} chapters`}
      </p>
      <div
        className="h-1.5 rounded-full bg-gray-700 overflow-hidden"
        role="progressbar"
        aria-label={`${title}: lessons done`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
      >
        <div className="h-full rounded-full bg-brand-600" style={{ width: `${percent}%` }} />
      </div>
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-gray-400 tabular-nums">{`${done}/${book.lessons} lessons · ${percent}%`}</p>
        {canDelete ? (
          <button
            id="book-delete-btn"
            type="button"
            disabled={deleting}
            onClick={(event) => {
              event.stopPropagation();   // never let the click reach the card (open/close the book)
              void remove();
            }}
            onKeyDown={(event) => event.stopPropagation()}
            className="min-h-[36px] px-3 rounded-lg border border-gray-600 text-gray-300 hover:text-white hover:border-brand-600 hover:bg-brand-600 text-xs font-semibold uppercase tracking-wider transition-colors active:scale-95 disabled:opacity-50"
          >
            {deleting ? 'Deleting…' : 'Delete'}
          </button>
        ) : null}
      </div>
    </div>
  );
}
