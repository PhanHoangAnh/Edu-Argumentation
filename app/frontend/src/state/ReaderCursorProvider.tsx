// Seam 8b (state/ReaderCursorProvider) — THE READER CURSOR, LIFTED. Slice A2.
//
// ⚠ PLAN DEVIATION, declared: this is a FIFTH provider. The plan says "4 contexts +
//   TanStack Query", but its OWN measured inventory lists five client groups —
//   local-only · server-cache · quiz atom · book identity · **cursor 1**. `currentTheory`
//   (app.js:1414) is read by TWO screens: the reader renders it, and the LIBRARY moves it
//   (#read-tutorial-btn jumps to nextLesson() before the reader is shown). A value two
//   sibling screens share is what a context is for.
//
// ⚑ Phase 06a: it now wraps routing/usePathCursor (the hash cursor is retired, ruling R25).
// (history) IT WRAPPED routing/useHashCursor — it did not replace it. Hash parsing, the hashchange
//    listener, clamping and the load-time hash read all stay in slice A3's file, which was
//    NOT edited by A2.
//
// ⛑ THE CROSS-SLICE CONTRACT IS NOW CLOSED (slice A4/B, 22-09-26 — blocker A2-R3).
//    routing/useHashCursor.ts names `state/ReaderCursorProvider.enterReader()` as the owner
//    of B15's overwrite. That only holds if THIS is the single cursor in the app, and until
//    this slice it was not: `reader/ReaderScreen.tsx` called `useHashCursor(...)` itself, so
//    there were TWO INSTANCES and the reader never saw enterReader()'s jump — writeCursorHash
//    uses replaceState, and replaceState emits NO `hashchange`, so nothing propagated.
//    Consequence while it lasted: LEARN did not stamp the hash the reader was showing, i.e.
//    B15's overwrite half was DEAD and b15probe.mjs would have read a hash that differs from
//    the pinned :8791 baseline — a divergence that would have been reported as "the port
//    broke B15" when in fact the port had failed to reproduce it.
//    ⛔ ReaderScreen now consumes `useReaderCursor()`. THERE IS EXACTLY ONE CURSOR IN THE
//       APP. Do not add a second `useHashCursor(...)` call anywhere outside this provider.
//    (A2 left it unwired deliberately rather than racing slice A3's concurrent edits to that
//     file — the right call; a lost update there would have destroyed real work.)
//
// PORTED FROM (by symbol, app.js): currentTheory, selectTheory's cursor write, and the
// #read-tutorial-btn listener (1238-1242). The three WALKS are pure and live in
// state/theoryNav.ts.
import { createContext, useCallback, useContext, useMemo } from 'react';
import type { ReactNode } from 'react';
import { usePathCursor } from '../routing/usePathCursor';
import type { TheoryCursor } from '../data/types';
import { useBookContext } from './BookProvider';
import { useProgressContext } from './ProgressProvider';
import { nextLesson, nextTheory, previousTheory } from './theoryNav';
import type { NextLesson } from './theoryNav';

interface ReaderCursorValue {
  cursor: TheoryCursor;
  select: (next: TheoryCursor) => void;
  /** null == no earlier block anywhere in the book. This is what disables Previous. */
  previous: TheoryCursor | null;
  /** null == no later block anywhere in the book. This is what disables Next. */
  next: TheoryCursor | null;
  /** The first incomplete block; a finished book returns its last with done:true. */
  resume: NextLesson | null;
  /** #read-tutorial-btn's whole behaviour: jump to the first unfinished lesson. */
  enterReader: () => void;
  /** The cursor has been set from the URL for the loaded book (routing/usePathCursor). */
  ready: boolean;
}

const ReaderCursorContext = createContext<ReaderCursorValue | null>(null);

export function ReaderCursorProvider({ children }: { children: ReactNode }) {
  const { chapters, blocksOf, data, activeBookFile } = useBookContext();
  const { isBlockComplete } = useProgressContext();
  const blockCountOf = useCallback((index: number) => blocksOf(index).length, [blocksOf]);
  // ⚠ `data` is passed so A3's load-time hash read is live rather than inert. Their own
  //   note asks slice A2 for a book identity token for the same-chapter-count book switch;
  //   BookProvider.moduleId is it, and it is exposed — wiring it is A3's call.
  // ⚑ Phase 06a: the cursor comes from the PATH (/<book>/<unit>-<n>/<m>-<slug>), or from an old
  //   `#chapter=&block=` link, when the book loads. The shell writes the address bar.
  const { cursor, select, ready } = usePathCursor(chapters.length, blockCountOf, data, activeBookFile);

  const value = useMemo<ReaderCursorValue>(() => {
    const resume = nextLesson(chapters.length, blockCountOf, isBlockComplete);
    return {
      cursor,
      select,
      previous: previousTheory(cursor, blockCountOf),
      next: nextTheory(cursor, chapters.length, blockCountOf),
      resume,
      /**
       * ⚑ Phase 06a: B15 is RETIRED with the hash (ruling R25). A deep link now opens the reader
       *   ON its lesson directly (routing/usePathCursor), so this click no longer overwrites a
       *   deep link — it is only "Continue reading": the first unfinished lesson. History below.
       *
       * (was) ⛔⛔ THIS IS B15, REPRODUCED ON PURPOSE.
       *
       * app.js:1238-1242 — #read-tutorial-btn calls nextLesson() and selectTheory()s it.
       * selectTheory writes the hash, so LEARN STAMPS OVER whatever deep link the user
       * arrived with. renderTutorial(), the only place the hash is honoured, is called
       * from the book-LOAD path (app.js:1378) and never from this click.
       * On a book with no progress nextLesson() is block 1 — which is exactly the pinned
       * :8791 baseline `#chapter=1&block=1` that gates/b15probe.mjs compares against.
       */
      enterReader: () => {
        if (resume) select({ chapterIndex: resume.chapterIndex, blockIndex: resume.blockIndex });
      },
      ready,
    };
  }, [cursor, select, ready, chapters.length, blockCountOf, isBlockComplete]);

  return <ReaderCursorContext.Provider value={value}>{children}</ReaderCursorContext.Provider>;
}

export function useReaderCursor(): ReaderCursorValue {
  const value = useContext(ReaderCursorContext);
  if (!value) throw new Error('useReaderCursor must be used inside <ReaderCursorProvider>');
  return value;
}
