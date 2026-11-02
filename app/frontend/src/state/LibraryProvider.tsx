// Seam 5 (state/LibraryProvider) — THE LIBRARY ORDER. One of the four contexts (A2).
//
// ⛔ libraryOrder LIVES HERE, OUTSIDE THE QUERY CACHE (A2c). It is seeded ONCE from the
//    first successful /api/modules result behind a hasSeeded ref, then reconciled:
//    keep the known order, drop what is absent, append what is fresh.
//
// ⛔ NEVER derive it in a `select` or a useMemo over query data, and ⛔ never reach for
//    `staleTime: Infinity` to stop the reshuffle — that hides the bug and blocks the
//    Phase 04 refetch. The gate is: force a refetch, assert [data-book] DOCUMENT ORDER
//    is unchanged. It goes RED the moment any card moves.
//
// WHY the order is sticky at all: the grid must not reshuffle under the cursor when a
// book is opened. Position stopped being the "you are here" marker — the "Current" chip
// and aria-current are (user, 21-09-26).
//
// PORTED FROM (by symbol, app.js): libraryBooks, libraryOrder, librarySortKey,
// snapshotLibraryOrder, orderedLibraryBooks, loadLibrary.
import { createContext, useContext, useMemo, useRef } from 'react';
import type { ReactNode } from 'react';
import { useLibraryProgressCounts, useModules } from '../data/queries';
import { moduleIdFor } from '../data/bookPaths';
import type { LibraryBook } from '../data/types';

interface LibraryContextValue {
  books: LibraryBook[];
  /** Books in the snapshotted order. This is what the grid maps. */
  ordered: LibraryBook[];
  isLoading: boolean;
}

const LibraryContext = createContext<LibraryContextValue | null>(null);

/**
 * librarySortKey — the order FRESH books are appended in. Ported VERBATIM from
 * app.js:442-449; A1 shipped a title-only stub, which is a different order.
 *
 * ⛔ RECENCY FIRST: most recently READ, then most recently ADDED, then the newer of the
 *    two, then title. The user's own words (21-09-26): the book you were reading this
 *    morning comes first. localeCompare is the final tiebreak, which makes the sort TOTAL
 *    — so a reload of unchanged data reproduces the same order, which is the property the
 *    A2c "force a refetch, [data-book] order unchanged" gate actually rests on.
 */
export function librarySortKey(a: LibraryBook, b: LibraryBook): number {
  const recency = (book: LibraryBook) =>
    Math.max(Number(book.lastReadAt) || 0, 0) || Math.max(Number(book.addedAt) || 0, 0);
  return (
    (Number(b.lastReadAt) || 0) - (Number(a.lastReadAt) || 0) ||
    (Number(b.addedAt) || 0) - (Number(a.addedAt) || 0) ||
    recency(b) - recency(a) ||
    a.title.localeCompare(b.title)
  );
}

export function LibraryProvider({ children }: { children: ReactNode }) {
  const { data, isLoading } = useModules();

  /*
    ⛔⛔ loadLibrary's PROGRESS FAN-OUT (app.js:387-396), added 22-09-26 (EVL fix 003).
        `/api/modules` does NOT carry `done` — measured, on this server and on the legacy one.
        Without this every `book.done` is undefined, and the home KPI panel (which is a
        function of EVERY book, not the open one) reported 0 while the row under it reported
        18. See data/queries.ts:useLibraryProgressCounts for the full measurement.
    ⚠ The id rule is the legacy's verbatim: the book's own `moduleId`, unless it is a
      transient `t-` id, in which case the filename. `moduleIdFor({}, file)` is exactly the
      legacy's fallback call, including the empty payload.
    ⛔ `progressIds` is memoised on the FILE LIST, not on `data`: useQueries is keyed by this
       array and a fresh identity every render would re-subscribe every query each paint.
  */
  const progressIds = useMemo(() => {
    const books = Array.isArray(data) ? data : [];
    return books.map((book) =>
      book.moduleId && !/^t-/.test(book.moduleId) ? book.moduleId : moduleIdFor({}, book.file),
    );
  }, [Array.isArray(data) ? data.map((book) => `${book.file}|${book.moduleId ?? ''}`).join(',') : '']);

  const doneCounts = useLibraryProgressCounts(progressIds);
  // ⛔ A ref, not state: seeding must not itself cause a render, or the reconcile
  //    races the render that reads it.
  const orderRef = useRef<string[]>([]);
  const hasSeeded = useRef(false);

  const value = useMemo<LibraryContextValue>(() => {
    /*
      ⛔ `done` is STAMPED ON here, exactly as `loadLibrary` mutates `book.done` before it
         calls renderLibrary(). A COPY per book, never a mutation of the query cache's own
         objects — TanStack hands out the cached array by reference and writing through it
         corrupts the cache for every other reader.
      ⚠ A book with no answer yet reads 0, which is the legacy's own catch-branch value
        (app.js:395-396). It is not "unknown"; it is the same thing the legacy shows.
    */
    const raw = Array.isArray(data) ? data : [];
    const books: LibraryBook[] = raw.map((book) => {
      const id = book.moduleId && !/^t-/.test(book.moduleId) ? book.moduleId : moduleIdFor({}, book.file);
      return { ...book, progressId: id, done: doneCounts[id] ?? 0 };
    });
    if (books.length && !hasSeeded.current) {
      orderRef.current = [...books].sort(librarySortKey).map((book) => book.file);
      hasSeeded.current = true;
    } else if (books.length) {
      // snapshotLibraryOrder(): keep known order, drop absent, append fresh.
      const known = new Set(orderRef.current);
      const present = new Set(books.map((book) => book.file));
      const fresh = books
        .filter((book) => !known.has(book.file))
        .sort(librarySortKey)
        .map((book) => book.file);
      orderRef.current = orderRef.current.filter((file) => present.has(file)).concat(fresh);
    }
    // orderedLibraryBooks(): with the safety net — anything that never reached the
    // snapshot still renders, last. Dropping a book is worse than showing it late.
    const byFile = new Map(books.map((book) => [book.file, book]));
    const seen = new Set(orderRef.current);
    const ordered = orderRef.current
      .map((file) => byFile.get(file))
      .filter((book): book is LibraryBook => Boolean(book))
      .concat(books.filter((book) => !seen.has(book.file)));
    return { books, ordered, isLoading };
  }, [data, isLoading, doneCounts]);

  return <LibraryContext.Provider value={value}>{children}</LibraryContext.Provider>;
}

export function useLibrary(): LibraryContextValue {
  const value = useContext(LibraryContext);
  if (!value) throw new Error('useLibrary must be used inside <LibraryProvider>');
  return value;
}
