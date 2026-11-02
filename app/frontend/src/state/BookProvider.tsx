// Seam 4 (state/BookProvider) — BOOK IDENTITY. One of the four contexts (A2).
//
// Owns the 4 book-identity globals, ported by symbol from app.js:
//   moduleId (38) · activeBookFile (53) · assetBase (58) · tutorialData (18)
// plus the server-cache global quizData (17), which arrives in the SAME payload and has
// nowhere else honest to live — it is the loaded book's question bank, not run state.
//
// ⛔ moduleId is the key EVERYTHING else is scoped by — server progress, exercise
//    localStorage, code-cell state. Block ids are POSITIONAL: every book has a
//    ch01-b03, so a wrong moduleId silently shows one book's ticks on another.
//    Explicit id first, never the title — the Géron title changes when chapters are
//    merged in, and a title-derived key would orphan every completion.
//
// ⛔⛔ THE PAYLOAD SHAPE, CORRECTED BY A2 (22-09-26, measured — see data/types.ts):
//        payload = { tutorialData: { title, sections: [ { title, items: [...] } ] },
//                    quizData: [...] }
//    A1 read `payload.chapters[].blocks[]`, which no book has. The PROVIDER API keeps the
//    friendlier names — `chapters` IS tutorialData.sections, `blocksOf(i)` IS
//    sections[i].items — so no consuming component changed. The translation is here, once.
//
// ⛔ `data` is the TUTORIAL HALF (tutorialData), not the raw payload: `data.title` is what
//    the library screen and the home dashboard read, and it is what app.js's own
//    `tutorialData.title` meant.
import { createContext, useContext, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { DEFAULT_BOOK, bookLocationFor, moduleIdFor } from '../data/bookPaths';
import { useBook } from '../data/queries';
import { fileForSlug, parseRoute } from '../routing/paths';
import type { Chapter, ModulePayload, QuizQuestion, TheoryBlock, TutorialData } from '../data/types';

interface BookContextValue {
  /** null = no book open; the library shows its empty state. */
  activeBookFile: string | null;
  openBook: (file: string) => void;
  closeBook: () => void;
  /**
   * loadModuleData(parsed, 'Uploaded module', null) — the header's "Load Course JSON" (app.js:
   * 1384). The book is held IN MEMORY only: activeBookFile stays null, so it has no server
   * file and AI generation is off for it, exactly as the legacy's aiReady() rule says.
   * Throws the legacy's own schema error on a file that is not a module.
   */
  loadUploaded: (payload: ModulePayload) => void;
  moduleId: string;
  assetBase: string;
  /** The TUTORIAL half of the payload. `data.title` is the book title. */
  data: TutorialData | null;
  isLoading: boolean;
  /** tutorialData.sections. The name is the provider's, the shape is the wire's. */
  chapters: Chapter[];
  /** sections[i].items, with the legacy plain-string form wrapped. */
  blocksOf: (chapterIndex: number) => TheoryBlock[];
  /** payload.quizData — the whole bank for the open book. Server cache, not run state. */
  quizBank: QuizQuestion[];
  /**
   * Every lesson (`items[]`) of the chapter that CONTAINS this code-cell `lesson` id.
   *
   * ⛔ This exists so cell numbering can be CHAPTER-SCOPED without a cursor (F7b(i)). A
   *    walkthrough is split across several lessons that share one kernel via the parent
   *    `lesson` id; number the cells block-locally and ch01-b08d's predict cell claims to
   *    be cell 1 of a page that never ran ch01-b08c's fit — `NameError: model` at run time
   *    in Phase 04, not a cosmetic off-by-one.
   * ⚠ Returns [] when no chapter claims the lesson, never a guess.
   */
  chapterBlocksForLesson: (lesson: string) => TheoryBlock[];
}

const BookContext = createContext<BookContextValue | null>(null);

/**
 * theoryBlocks(), ported EXACTLY (app.js:~1441).
 *
 * ⚠ `items` is heterogeneous. A populated module stores objects ({term, blocks}); older
 * hand-written modules store PLAIN STRINGS. Dropping the wrap makes three legacy books
 * render blank lessons with no error.
 */
export function blocksOfChapter(chapter: Chapter | undefined): TheoryBlock[] {
  if (!chapter || !Array.isArray(chapter.items)) return [];
  return chapter.items.map((item, index) =>
    typeof item === 'string'
      ? ({ term: `Point ${index + 1}`, blocks: [{ type: 'text', content: item }] } as TheoryBlock)
      : item,
  );
}

/**
 * loadBundledModule()'s book choice, ported (app.js:3293-3301).
 *
 * ⛔⛔ THIS IS THE FIX FOR G-EVL-1, AND THE MEASURED CAUSE WAS NONE OF THE THREE PRIOR
 *     THEORIES. Measured on the live :8792, 22-09-26, from the network log of a deep link
 *     to `#chapter=1&block=8`:
 *         GET /api/modules              <- the LIBRARY listing arrived (2 cards rendered)
 *         GET /api/progress?module=geron-homl3
 *         ⛔ NO GET /book/geron-homl3/module.json  <- THE BOOK WAS NEVER FETCHED, EVER
 *     `activeBookFile` started `null` and nothing ever opened a default, because
 *     `loadBundledModule()` — the legacy's DOMContentLoaded handler (app.js:3315) — was
 *     never ported. Everything downstream follows from that one omission:
 *       · chapters = []  ->  nextLesson() returns null  ->  ReaderCursorProvider.resume is
 *         null  ->  enterReader() no-ops  ->  ⛔ THE LEARN CLICK NEVER STAMPS THE HASH,
 *         so gate-r-b15's R-B15b read `#chapter=1&block=8` where :8791 reads `block=1`.
 *       · the reader rendered BlockRenderer's "Theory block 1" placeholder (R-B15c).
 *       · `#setup-tree` had no checkboxes, so the quiz could not even be started (G-EVL-2).
 *
 * ⛔ NOT the renderTutorial `sections` guard (slices A1 + A3's first pass): measured, the
 *    importer always emits `sections`, so that guard never fires.
 * ⛔ NOT a visibility-keyed hash apply (A3's first implementation): the load-edge keying in
 *    routing/useHashCursor.ts is correct and was left alone.
 * ⛔ NOT the two-cursor split (wave 3 / slice A4B): that is genuinely closed — there is still
 *    EXACTLY ONE `useHashCursor()` call site, at ReaderCursorProvider:63, and this fix adds
 *    none. The overwrite half was live; it had nothing to walk.
 *
 * ⚠ TWO HALVES OF THE LEGACY ARE DELIBERATELY NOT PORTED HERE, declared rather than faked:
 *   1. THE READ BELOW IS INERT TODAY. `localStorage['eduActiveBook']` is only ever WRITTEN by
 *      the legacy `openBook()` (app.js:618) and cleared by `closeBook()` (app.js:539); the
 *      React port writes that key NOWHERE (grepped, zero hits). So `saved` is always null and
 *      DEFAULT_BOOK always wins — which is exactly the legacy's own behaviour for a fresh
 *      viewer, and therefore exactly what the pinned :8791 gate baseline measures (Playwright
 *      opens a clean context with empty storage). It is kept because it is the faithful shape
 *      and becomes live the moment the write half is ported; it is NOT claimed to work today.
 *   2. NO FALLBACK CHAIN. The legacy loops `[saved, DEFAULT_BOOK]` and tries the next on a
 *      failed fetch. Here a failed fetch leaves the payload null and the library empty-handed,
 *      the same as any other book error. Porting the retry needs an error-driven re-open that
 *      TanStack Query owns; out of scope for this fix.
 */
function initialBookFile(): string {
  // ⚑ Phase 06a: a book PATH (/<book-slug>/...) decides first. Only the fixed slug map is known
  //   this early; a slug outside it is resolved by the shell once /api/modules has answered.
  const route = parseRoute();
  if (route.kind === 'book' || route.kind === 'lesson') {
    const fromPath = fileForSlug(route.slug);
    if (fromPath) return fromPath;
  }
  let saved: string | null = null;
  try {
    saved = window.localStorage.getItem('eduActiveBook');
  } catch {
    /* storage blocked — the legacy swallows this too (app.js:3298) */
  }
  return saved || DEFAULT_BOOK;
}

export function BookProvider({ children }: { children: ReactNode }) {
  // ⛔ A LAZY INITIALISER, not `useState(initialBookFile())`: the latter re-reads storage on
  //    every render. The book choice is made ONCE, at mount, exactly as DOMContentLoaded is
  //    a one-shot event.
  // ⛔ NOT an effect. An effect would render one frame with no book, and BlockRenderer paints
  //    its "Theory block N" placeholder in that frame — the very string gate-r-b15's R-B15c
  //    reports on.
  const [activeBookFile, setActiveBookFile] = useState<string | null>(initialBookFile);
  const location = activeBookFile ? bookLocationFor(activeBookFile) : null;
  const { data: fetched, isLoading } = useBook(location?.url ?? null);
  const [uploaded, setUploaded] = useState<ModulePayload | null>(null);
  const payload = uploaded ?? fetched;

  const value = useMemo<BookContextValue>(() => {
    const tutorial = (payload?.tutorialData ?? null) as TutorialData | null;
    // ⚠ moduleIdFor needs the PAYLOAD (the legacy computes it in loadModuleData, i.e. after the
    //   book arrived). While it is still loading, a packaged book's file name IS its id; anything
    //   else waits on the default rather than inventing an `f-` id from a file that is not a book yet.
    const moduleId = payload
      ? moduleIdFor(payload, activeBookFile)
      : activeBookFile && /^[a-z0-9][a-z0-9-]{1,63}$/.test(activeBookFile)
        ? activeBookFile
        : DEFAULT_BOOK;
    const chapters = Array.isArray(tutorial?.sections) ? (tutorial.sections as Chapter[]) : [];
    return {
      activeBookFile,
      openBook: (file: string) => {
        setUploaded(null);
        setActiveBookFile(file);
      },
      closeBook: () => {
        setUploaded(null);
        setActiveBookFile(null);
      },
      loadUploaded: (parsed: ModulePayload) => {
        const tutorialData = (parsed as { tutorialData?: unknown }).tutorialData;
        if (!tutorialData || typeof tutorialData !== 'object' || !Array.isArray((parsed as { quizData?: unknown }).quizData)) {
          throw new Error("Invalid JSON schema. Must contain 'tutorialData' object and 'quizData' array.");
        }
        const title = (tutorialData as { title?: string }).title;
        setUploaded({ ...parsed, tutorialData: { ...(tutorialData as object), title: title || 'Uploaded module' } } as ModulePayload);
        setActiveBookFile(null);
      },
      moduleId,
      // A packaged book's assets are relative to the BOOK; a legacy book's are relative
      // to the page, which is why base is deliberately '' there (app.js:68).
      assetBase: location?.base ?? '',
      data: tutorial,
      isLoading: uploaded ? false : isLoading,
      chapters,
      blocksOf: (chapterIndex: number) => blocksOfChapter(chapters[chapterIndex]),
      quizBank: Array.isArray(payload?.quizData) ? (payload.quizData as QuizQuestion[]) : [],
      chapterBlocksForLesson: (lesson: string) => {
        if (!lesson) return [];
        for (let index = 0; index < chapters.length; index += 1) {
          const blocks = blocksOfChapter(chapters[index]);
          const owns = blocks.some((item) =>
            (Array.isArray(item?.blocks) ? item.blocks : []).some(
              (sub) => sub && sub.type === 'code_cells' && sub.lesson === lesson,
            ),
          );
          if (owns) return blocks;
        }
        return [];
      },
    };
  }, [activeBookFile, payload, uploaded, isLoading, location?.base]);

  return <BookContext.Provider value={value}>{children}</BookContext.Provider>;
}

export function useBookContext(): BookContextValue {
  const value = useContext(BookContext);
  if (!value) throw new Error('useBookContext must be used inside <BookProvider>');
  return value;
}
