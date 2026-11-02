// Seam 11 (library) — THE HOME PAGE: current book, progress totals, library.
//
// ⚑ PHASE 04 PARITY REWRITE (23-09-26). Measured side by side against the live :8767 before
//   this change (shots /var/tmp/p4/shots/before-*-home.png): the welcome card had NO
//   "Continue reading / Practice / Generate quiz" row (a lone "LEARN" button sat BELOW the card
//   instead), #current-next was always empty, the Import link pointed at "/", there was no
//   #empty-state, and the upload icon had been moved out of the header. All four were
//   "declared deviations" in slice A1/A2 comments; none was the legacy's behaviour.
//
// THE DOM IS THE LEGACY'S (index.html:230-306): #welcome-screen IS the card, and #home-kpis and
// #services-section are its SIBLINGS. So this file exports three components and the shell
// places them — the card inside <Screen id="welcome-screen">, the other two after it.
//
// PORTED FROM (by symbol, app.js): renderHome, nextLesson, plural, setAppState,
// renderHomeKpis, renderLibrary, the #read-tutorial-btn / #start-btn / #start-generated-btn
// listeners, loadBundledModule's import link.
import { useBookContext } from '../state/BookProvider';
import { useLibrary } from '../state/LibraryProvider';
import { useProgressContext } from '../state/ProgressProvider';
import { nextLesson } from '../state/theoryNav';
import { BookCard } from './BookCard';
import { OUTLINE_BTN, PRIMARY_BTN } from '../shell/ui';

/** plural(count, word) — ported verbatim. toLocaleString is the legacy's: "1,550 questions". */
function plural(count: number, word: string): string {
  return `${count.toLocaleString()} ${word}${count === 1 ? '' : 's'}`;
}

const AI_ONLY_ON_LIBRARY_BOOKS = 'AI quizzes need a library book';
// ⚑ 23-09-26: OUTLINE_BTN and PRIMARY_BTN moved VERBATIM to shell/ui.ts so the Account and sign-in
//   pages use the SAME strings (gates/gate-r-style.mjs measures the pairs).

export interface WelcomeCardProps {
  /** #read-tutorial-btn — enterReader(), which jumps to nextLesson() first. */
  onOpenReader: () => void;
  /** #start-btn — openQuizTab('practice'). */
  onPractice: () => void;
  /** #start-generated-btn — openQuizTab('generate'). */
  onGenerate: () => void;
  aiReady: boolean;
  providerReady: boolean;
}

/** The current-book card — the CONTENT of #welcome-screen (the Screen carries its chrome). */
export function WelcomeCard({ onOpenReader, onPractice, onGenerate, aiReady, providerReady }: WelcomeCardProps) {
  const { data, chapters, blocksOf, quizBank } = useBookContext();
  const { overall, isBlockComplete } = useProgressContext();
  const title = (data?.title as string | undefined) ?? '';
  const isReady = Boolean(title);
  const live = overall();
  const lessons = chapters.reduce((sum, _chapter, index) => sum + blocksOf(index).length, 0);
  const next = nextLesson(chapters.length, (ci) => blocksOf(ci).length, isBlockComplete);
  let nextLabel = '';
  if (next) {
    const block = blocksOf(next.chapterIndex)[next.blockIndex];
    const name = (block && block.term) || `Lesson ${next.blockIndex + 1}`;
    nextLabel = next.done ? 'All lessons done' : `Next: ${next.chapterIndex + 1}.${next.blockIndex + 1} ${name}`;
  }

  return (
    <>
      <p className="text-xs font-semibold uppercase tracking-widest text-brand-600">Current book</p>
      {/* Shown when no book is selected. The panel itself stays put so the home page does not
          reflow when a book is closed (user, 21-09-26). */}
      <p id="welcome-empty" className={isReady ? 'hidden-view mt-3 text-gray-400' : 'mt-3 text-gray-400'}>
        No book selected. Pick one from the library below.
      </p>
      <div id="welcome-body" className={isReady ? undefined : 'hidden-view'}>
        <h1 id="welcome-title" className="mt-2 text-3xl sm:text-4xl font-light text-white leading-tight">
          {title}
        </h1>
        <p id="current-meta" className="mt-2 text-sm text-gray-400">
          {isReady
            ? [plural(chapters.length, 'chapter'), plural(lessons, 'lesson'), plural(quizBank.length, 'question')].join(' · ')
            : ''}
        </p>
        <div className="mt-6">
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span id="current-progress-label" className="text-gray-300">
              {`${live.done} / ${live.total} lessons done`}
            </span>
            <span id="current-progress-percent" className="font-semibold text-white tabular-nums">
              {`${live.percent}%`}
            </span>
          </div>
          <div
            id="current-progress-track"
            className="mt-2 h-2 rounded-full bg-gray-700 overflow-hidden"
            role="progressbar"
            aria-label="Lessons done"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={live.percent}
          >
            <div
              id="current-progress-bar"
              className="h-full rounded-full bg-brand-600 transition-all duration-300"
              style={{ width: `${live.percent}%` }}
            />
          </div>
          <p id="current-next" className="mt-3 text-sm text-gray-400 truncate">
            {nextLabel}
          </p>
        </div>
        <div className="mt-6 flex flex-wrap gap-3">
          <button
            id="read-tutorial-btn"
            type="button"
            disabled={!isReady}
            onClick={onOpenReader}
            className={PRIMARY_BTN}
          >
            {live.done ? 'Continue reading' : 'Start reading'}
          </button>
          <button id="start-btn" type="button" disabled={!isReady} onClick={onPractice} className={OUTLINE_BTN}>
            Practice
          </button>
          <button
            id="start-generated-btn"
            type="button"
            disabled={!isReady || !aiReady}
            title={aiReady ? '' : providerReady ? AI_ONLY_ON_LIBRARY_BOOKS : 'Connect a model in Settings first'}
            onClick={onGenerate}
            className={OUTLINE_BTN}
          >
            AI-Quiz
          </button>
        </div>
      </div>
    </>
  );
}

/** renderHomeKpis (app.js:405) — across-the-library totals. */
/** `hidden`: the AI-Quiz loading state hides the home widgets (user, 24-09-26) — see AppShell. */
export function HomeKpis({ hidden = false }: { hidden?: boolean } = {}) {
  const { books } = useLibrary();
  const sum = (key: 'lessons' | 'chapters' | 'questions') =>
    books.reduce((total, book) => total + (Number(book[key]) || 0), 0);
  const lessons = sum('lessons');
  const done = books.reduce((total, book) => total + Math.min(Number(book.done) || 0, Number(book.lessons) || 0), 0);
  const percent = lessons ? Math.round((done / lessons) * 100) : 0;
  const started = books.filter((book) => (Number(book.done) || 0) > 0).length;
  const furthest = [...books].sort((a, b) => (Number(b.done) || 0) - (Number(a.done) || 0))[0];

  return (
    <section id="home-kpis" className={books.length && !hidden ? 'mt-10' : 'hidden-view mt-10'} aria-labelledby="home-kpis-heading">
      <h2 id="home-kpis-heading" className="text-2xl text-white font-light mb-4">Your progress</h2>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="rounded-2xl border border-gray-700 bg-gray-800 px-5 py-4">
          <p className="text-xs uppercase tracking-wider text-gray-400">Lessons done</p>
          <p id="kpi-lessons" className="mt-1 text-3xl text-white font-bold tabular-nums">{`${done}`}</p>
          <div className="mt-3 h-1.5 w-full rounded-full bg-gray-700 overflow-hidden">
            <div id="kpi-lessons-bar" className="h-full rounded-full bg-brand-600" style={{ width: `${percent}%` }} />
          </div>
          <p id="kpi-lessons-sub" className="mt-2 text-xs text-gray-400 tabular-nums">{`of ${lessons} · ${percent}%`}</p>
        </div>
        <div className="rounded-2xl border border-gray-700 bg-gray-800 px-5 py-4">
          <p className="text-xs uppercase tracking-wider text-gray-400">Books</p>
          <p id="kpi-books" className="mt-1 text-3xl text-white font-bold tabular-nums">{`${books.length}`}</p>
          <p id="kpi-books-sub" className="mt-2 text-xs text-gray-400 tabular-nums">
            {started ? `${started} started` : 'none started yet'}
          </p>
        </div>
        <div className="rounded-2xl border border-gray-700 bg-gray-800 px-5 py-4">
          <p className="text-xs uppercase tracking-wider text-gray-400">Chapters</p>
          <p id="kpi-chapters" className="mt-1 text-3xl text-white font-bold tabular-nums">{`${sum('chapters')}`}</p>
          <p className="mt-2 text-xs text-gray-400">across the library</p>
        </div>
        <div className="rounded-2xl border border-gray-700 bg-gray-800 px-5 py-4">
          <p className="text-xs uppercase tracking-wider text-gray-400">Questions</p>
          <p id="kpi-questions" className="mt-1 text-3xl text-white font-bold tabular-nums">{sum('questions').toLocaleString()}</p>
          <p className="mt-2 text-xs text-gray-400">available to practise</p>
        </div>
      </div>
      <p id="kpi-furthest" className="mt-4 text-sm text-gray-400">
        {furthest && (Number(furthest.done) || 0) > 0
          ? `Furthest along: ${furthest.title} — ${furthest.done} of ${furthest.lessons} lessons.`
          : 'Pick a book below to start.'}
      </p>
    </section>
  );
}

/** #services-section — renderLibrary (app.js:465). */
/** `hidden`: the AI-Quiz loading state hides the home widgets (user, 24-09-26) — see AppShell. */
export function LibrarySection({ hidden = false }: { hidden?: boolean } = {}) {
  const { ordered } = useLibrary();
  const { activeBookFile, openBook, closeBook, data } = useBookContext();
  const { overall } = useProgressContext();
  const live = overall();
  // The importer is the separate :8769 service. /importer/ works on both doors (27-09-26): the public
  // nginx proxies it; on the direct VPN door the study app bounces /importer/ to http://<host>:8769/.
  const importHref = '/importer/';

  return (
    <section id="services-section" className={hidden ? 'hidden-view mt-10' : 'mt-10'} aria-labelledby="library-heading">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <h2 id="library-heading" className="text-2xl text-white font-light">Library</h2>
        <div className="flex flex-wrap gap-2">
          <a
            id="import-book-link"
            href={importHref}
            target="_blank"
            rel="noopener"
            className="inline-flex items-center justify-center min-h-[44px] px-5 rounded-lg border border-gray-600 text-gray-200 hover:border-brand-600 hover:text-white font-semibold uppercase tracking-wider text-sm transition-colors active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
          >
            Import
          </a>
        </div>
      </div>
      <div id="library-grid" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {ordered.map((book) => (
          <BookCard
            key={book.file}
            book={book}
            current={book.file === activeBookFile}
            // The OPEN book reports LIVE progress; the others their stored count, clamped.
            done={book.file === activeBookFile ? live.done : Math.min(book.done ?? 0, book.lessons)}
            // Closing is the card that opened it — no separate control (user, 21-09-26).
            onOpen={(file) => (file === activeBookFile ? closeBook() : openBook(file))}
          />
        ))}
      </div>
      <div
        id="empty-state"
        className={
          ordered.length > 0 || Boolean(data?.title)
            ? 'hidden-view rounded-2xl border border-dashed border-gray-700 px-6 py-12 text-center'
            : 'rounded-2xl border border-dashed border-gray-700 px-6 py-12 text-center'
        }
      >
        <p className="text-white text-lg">No books yet</p>
        <p className="mt-1 text-sm text-gray-400">Import a PDF or upload a module.</p>
      </div>
    </section>
  );
}
