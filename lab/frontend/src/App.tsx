import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiError, api } from './api';
import type { Book, LessonDetail } from './api';
import { EMBEDDED, Header, WindowControls } from './components/Header';
import { Selector } from './components/Selector';
import { CodeEditor } from './components/CodeEditor';
import { ResultPanel } from './components/ResultPanel';
import type { ResultState } from './components/ResultPanel';
import { LayoutToggle } from './components/LayoutToggle';
import { loadLayout, saveLayout } from './layout';
import type { Arrangement, Layout, SelectorPlace } from './layout';
import { codeKey, readStore, removeStore, writeStore } from './storage';

// Deep link: /lab/<bookId>/<chNN-bMM>. The book id is the MODULE id (e.g.
// openintro-statistics-2019-1045f2f5), never the reader's path slug.
function parsePath(): { book: string | null; lesson: string | null } {
  const rest = window.location.pathname.replace(/^\/lab\/?/, '');
  const [book, lesson] = rest.split('/').filter(Boolean).map(decodeURIComponent);
  return { book: book ?? null, lesson: lesson ?? null };
}

function pathFor(book: string | null, lesson: string | null): string {
  if (!book) return '/lab/';
  return `/lab/${encodeURIComponent(book)}/${lesson ? encodeURIComponent(lesson) : ''}`;
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement('textarea');
    area.value = text;
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  }
}

export function App() {
  const [name, setName] = useState<string | null>(null);
  const [books, setBooks] = useState<Book[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [bookId, setBookId] = useState<string | null>(null);
  const [chapterN, setChapterN] = useState<number | null>(null);
  const [lessonId, setLessonId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [detail, setDetail] = useState<LessonDetail | null>(null);
  const [code, setCode] = useState('');
  const [result, setResult] = useState<ResultState>({ kind: 'idle' });
  const [layout, setLayout] = useState<Layout>(loadLayout);
  const [copied, setCopied] = useState(false);
  // ⚑ 25-09-26 (user): a divider between Code and Result, in both layouts. Share of the CODE pane,
  //   per layout, remembered. Stacked starts at 55 % (was a fixed 45 %: "code is very short").
  const [splits, setSplits] = useState<{ side: number; stacked: number }>(() => {
    try {
      const saved = JSON.parse(readStore('lab:split') || '{}') as { side?: number; stacked?: number };
      const ok = (v: unknown, d: number) => (typeof v === 'number' && v >= 0.2 && v <= 0.8 ? v : d);
      return { side: ok(saved.side, 0.5), stacked: ok(saved.stacked, 0.55) };
    } catch {
      return { side: 0.5, stacked: 0.55 };
    }
  });
  const [dragging, setDragging] = useState(false);
  const [snapped, setSnapped] = useState(false);
  const workspaceRef = useRef<HTMLDivElement | null>(null);
  const [wide, setWide] = useState(() => window.matchMedia('(min-width: 768px)').matches);
  const [fills, setFills] = useState(() => EMBEDDED || window.matchMedia('(min-width: 1024px) and (min-height: 640px)').matches);
  useEffect(() => {
    const md = window.matchMedia('(min-width: 768px)');
    const fill = window.matchMedia('(min-width: 1024px) and (min-height: 640px)');
    const sync = () => {
      setWide(md.matches);
      setFills(EMBEDDED || fill.matches);
    };
    md.addEventListener('change', sync);
    fill.addEventListener('change', sync);
    return () => {
      md.removeEventListener('change', sync);
      fill.removeEventListener('change', sync);
    };
  }, []);
  const runId = useRef(0);

  const book = useMemo(() => books?.find((b) => b.id === bookId) ?? null, [books, bookId]);
  const chapter = useMemo(() => book?.chapters.find((c) => c.n === chapterN) ?? null, [book, chapterN]);
  const running = result.kind === 'running';
  const edited = detail != null && code !== detail.code;

  // Apply a (book, lesson) choice, falling back sensibly and explaining an unknown link.
  const applySelection = useCallback((all: Book[], wantBook: string | null, wantLesson: string | null, push: boolean) => {
    let target = all.find((b) => b.id === wantBook) ?? null;
    let message: string | null = null;
    if (wantBook && !target) message = `There is no book "${wantBook}" in Lab. Pick one from the Book menu.`;
    target = target ?? all[0] ?? null;
    let lesson: string | null = null;
    let chapterNumber = target?.chapters[0]?.n ?? null;
    if (target && wantLesson && target.id === wantBook) {
      const owner = target.chapters.find((c) => c.lessons.some((l) => l.id === wantLesson));
      if (owner) {
        chapterNumber = owner.n;
        lesson = wantLesson;
      } else {
        message = `Lesson ${wantLesson} has no code to run, or does not exist. Pick a lesson from the Lesson menu.`;
      }
    }
    setBookId(target?.id ?? null);
    setChapterN(chapterNumber);
    setLessonId(lesson);
    setNotice(message);
    if (push) window.history.pushState(null, '', pathFor(target?.id ?? null, lesson));
  }, []);

  useEffect(() => {
    api.me().then((me) => setName(me.name), () => undefined);
    api.books().then(
      (all) => {
        setBooks(all);
        const { book: b, lesson: l } = parsePath();
        applySelection(all, b, l, false);
      },
      (error: unknown) => setLoadError(error instanceof ApiError ? error.message : 'Lab could not load the book list.'),
    );
  }, [applySelection]);

  useEffect(() => {
    const onPop = () => {
      if (!books) return;
      const { book: b, lesson: l } = parsePath();
      applySelection(books, b, l, false);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [books, applySelection]);

  // Load the chosen lesson's code; an edit kept in localStorage wins over the original.
  useEffect(() => {
    setDetail(null);
    setResult({ kind: 'idle' });
    if (!bookId || !lessonId) return;
    let live = true;
    api.lesson(bookId, lessonId).then(
      (loaded) => {
        if (!live) return;
        setDetail(loaded);
        setCode(readStore(codeKey(bookId, lessonId)) ?? loaded.code);
      },
      (error: unknown) => live && setNotice(error instanceof ApiError ? error.message : 'Could not load this lesson.'),
    );
    return () => {
      live = false;
    };
  }, [bookId, lessonId]);

  const selectLesson = (id: string) => {
    setLessonId(id);
    setNotice(null);
    window.history.pushState(null, '', pathFor(bookId, id));
  };

  const changeCode = (next: string) => {
    setCode(next);
    if (!bookId || !lessonId || !detail) return;
    if (next === detail.code) removeStore(codeKey(bookId, lessonId));
    else writeStore(codeKey(bookId, lessonId), next);
  };

  const copy = async () => {
    const ok = await copyText(code);
    setCopied(ok);
    if (ok) window.setTimeout(() => setCopied(false), 1500);
  };

  // `selection` = only the highlighted lines (Run selection); omitted = the whole editor.
  const run = async (selection?: string) => {
    if (!bookId || !lessonId || running) return;
    const id = ++runId.current;
    const started = Date.now();
    setResult({ kind: 'running', seconds: 0 });
    const timer = window.setInterval(() => {
      if (runId.current === id) setResult({ kind: 'running', seconds: Math.floor((Date.now() - started) / 1000) });
    }, 1000);
    try {
      const outcome = await api.run(bookId, lessonId, selection ?? code);
      if (runId.current === id) setResult({ kind: 'done', result: outcome });
    } catch (error) {
      if (runId.current === id) {
        const failure = error instanceof ApiError ? error : new ApiError(0, 'Lab could not be reached.');
        setResult({ kind: 'failed', status: failure.status, message: failure.message });
      }
    } finally {
      window.clearInterval(timer);
    }
  };

  const stop = () => {
    if (bookId && lessonId) api.stop(bookId, lessonId).catch(() => undefined);
  };

  // Reset = start over: the lesson's original code, a fresh kernel (every variable from earlier
  // runs forgotten) and an empty result. The kernel half is best-effort — the code is restored even
  // when the runner cannot be reached, and the notice says which half failed.
  const reset = async () => {
    if (!bookId || !lessonId || !detail || running) return;
    removeStore(codeKey(bookId, lessonId));
    setCode(detail.code);
    setResult({ kind: 'idle' });
    setNotice(null);
    try {
      await api.resetKernel(bookId, lessonId);
    } catch (error) {
      setNotice(`Code restored, but the Python session could not be reset: ${error instanceof ApiError ? error.message : 'the runner did not answer'}.`);
    }
  };

  const changeLayout = (next: Layout) => {
    setLayout(next);
    saveLayout(next);
  };
  const changeArrangement = (arrangement: Arrangement) => changeLayout({ ...layout, arrangement });
  const changePlace = (selector: SelectorPlace) => changeLayout({ ...layout, selector });

  const lessonRef = chapter?.lessons.find((l) => l.id === lessonId) ?? null;
  const twoColumns = layout.arrangement === 'side';
  // Stacked: split the height (code 45 % / result 55 %, app.css). Side by side: one row.
  const split = layout.arrangement === 'stacked';
  // Which way the Code/Result seam can be dragged right now (null = no divider: one column that
  // scrolls with the page).
  const axis: 'x' | 'y' | null = twoColumns ? (wide ? 'x' : null) : fills ? 'y' : null;
  const share = twoColumns ? splits.side : splits.stacked;
  const track = `minmax(0, ${share}fr) minmax(0, ${1 - share}fr)`;
  const workspaceStyle = axis === 'x' ? { gridTemplateColumns: track } : axis === 'y' ? { gridTemplateRows: track } : undefined;
  const dragTo = (clientX: number, clientY: number) => {
    const box = workspaceRef.current?.getBoundingClientRect();
    if (!box || !axis) return;
    const raw = axis === 'x' ? (clientX - box.left) / box.width : (clientY - box.top) / box.height;
    // ⚑ 25-09-26 (user): snap to an exact 50/50 within 12 px of the middle.
    const size = axis === 'x' ? box.width : box.height;
    const near = Math.abs(raw - 0.5) * size <= 12;
    setSnapped(near);
    const next = near ? 0.5 : Math.min(0.8, Math.max(0.2, raw));
    setSplits((old) => (twoColumns ? { ...old, side: next } : { ...old, stacked: next }));
  };
  const endDrag = () => {
    setDragging(false);
    setSnapped(false);
    writeStore('lab:split', JSON.stringify(splits));
  };
  const sidebar = layout.selector === 'sidebar';

  const selector = books ? (
    <Selector
      books={books}
      bookId={bookId}
      chapterN={chapterN}
      lessonId={lessonId}
      place={layout.selector}
      onBook={(id) => applySelection(books, id, null, true)}
      onChapter={(n) => {
        setChapterN(n);
        setLessonId(null);
        window.history.pushState(null, '', pathFor(bookId, null));
      }}
      onLesson={selectLesson}
      onPlace={changePlace}
      extra={
        EMBEDDED ? (
          <>
            <LayoutToggle arrangement={layout.arrangement} onChange={changeArrangement} />
            <WindowControls />
          </>
        ) : undefined
      }
    />
  ) : (
    <div className="flex items-center justify-between gap-3">
      <p className="text-sm text-gray-400">{loadError ?? 'Loading books…'}</p>
      {EMBEDDED ? <WindowControls /> : null}
    </div>
  );

  return (
    <>
      {EMBEDDED ? null : <Header name={name} />}
      {/* ⚑ 25-09-26 (user): 6 px page padding (the Learn page's reading pane uses 6 px) — inside the Learn
          window only on the LEFT (the 6 px gap to the lesson), so top and bottom line up with the lesson card — and the menu box
          JOINS the Code/Result widgets — on top of both (top row) or left of them (sidebar, lg+) — with
          one shared border and only the outer corners rounded (app.css, #lab-stage). The notice and the
          standalone title row sit above that joined block. */}
      <main id="lab-main" className={`flex-1 flex flex-col gap-1.5 min-h-0 ${EMBEDDED ? 'pl-1.5' : 'p-1.5'}`}>
        {notice ? (
          <p id="lab-notice" className="rounded-lg border border-gray-600 bg-gray-800 px-4 py-3 text-sm text-gray-200">
            {notice}
          </p>
        ) : null}
        {/* ⚑ 25-09-26 (user): inside the Learn window the lesson title is not repeated — the reader
            beside it shows it; the layout toggle moves into the selector row (see `extra`). */}
        {lessonRef && detail ? (
          <div className={EMBEDDED ? 'hidden' : 'flex items-center gap-4'}>
            <h2 id="lab-lesson-title" className="min-w-0 flex-1 break-words text-2xl sm:text-3xl text-white font-light">
              {lessonRef.n}. {lessonRef.title}
            </h2>
            <LayoutToggle arrangement={layout.arrangement} onChange={changeArrangement} />
          </div>
        ) : null}
        <div id="lab-stage" data-place={layout.selector} data-lesson={lessonRef && detail ? 'yes' : 'no'} className={`flex-1 min-h-0 flex flex-col ${sidebar ? 'lg:flex-row' : ''}`}>
          <aside
          id="lab-aside"
          data-place={layout.selector}
          className={sidebar ? 'lg:w-72 shrink-0 flex flex-col gap-3 bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 lg:p-3 lg:overflow-y-auto' : 'shrink-0 bg-gray-800 border border-gray-700 rounded-xl px-3 py-2'}
        >
          {selector}
          {books && books.length === 0 ? <p className="text-sm text-gray-400">No book has code to run yet.</p> : null}
        </aside>
          <section id="lab-section" className="flex-1 min-w-0 min-h-0 flex flex-col">
            {lessonRef && detail ? (
              <div
                id="lab-workspace"
                data-arrangement={layout.arrangement}
                data-rows={split ? 'split' : 'one'}
                ref={workspaceRef}
                style={workspaceStyle}
                className={`relative grid gap-0 grid-cols-1 ${twoColumns ? 'md:grid-cols-2' : ''} ${dragging ? 'select-none' : ''}`}
              >
                <div id="lab-code-pane" className="lab-pane min-w-0 flex flex-col">
                  <CodeEditor
                    code={code}
                    edited={edited}
                    running={running}
                    onChange={changeCode}
                    onRun={run}
                    onStop={stop}
                    onReset={reset}
                    onCopy={copy}
                    copied={copied}
                  />
                </div>
                {axis ? (
                  <div
                    id="lab-split-divider"
                    role="separator"
                    aria-orientation={axis === 'x' ? 'vertical' : 'horizontal'}
                    aria-label="Drag to resize Code and Result"
                    title="Drag to resize"
                    onPointerDown={(event) => {
                      event.preventDefault();
                      event.currentTarget.setPointerCapture(event.pointerId);
                      setDragging(true);
                    }}
                    onPointerMove={(event) => dragging && dragTo(event.clientX, event.clientY)}
                    onPointerUp={endDrag}
                    onPointerCancel={endDrag}
                    style={axis === 'x' ? { left: `calc(${share * 100}% - 5px)` } : { top: `calc(${share * 100}% - 5px)` }}
                    className={`group absolute z-10 flex items-center justify-center ${axis === 'x' ? 'top-0 bottom-0 w-[10px] cursor-col-resize' : 'left-0 right-0 h-[10px] cursor-row-resize'}`}
                  >
                    <span className={`rounded-full transition-colors ${snapped ? 'bg-white' : dragging ? 'bg-brand-600' : 'bg-transparent group-hover:bg-brand-600'} ${axis === 'x' ? 'w-[3px] h-full' : 'h-[3px] w-full'}`} />
                  </div>
                ) : null}
                {axis && dragging ? (
                  // The exact middle, dashed, while dragging.
                  <div
                    id="lab-split-middle"
                    aria-hidden="true"
                    className={`pointer-events-none absolute z-10 border-dashed ${snapped ? 'border-white' : 'border-brand-600/70'} ${axis === 'x' ? 'top-0 bottom-0 left-1/2 w-0 border-l-2 -translate-x-px' : 'left-0 right-0 top-1/2 h-0 border-t-2 -translate-y-px'}`}
                  />
                ) : null}
                <div id="lab-result-pane" className="lab-pane min-w-0 flex flex-col">
                  <ResultPanel state={result} onCopy={copy} />
                </div>
              </div>
          ) : books && !lessonId ? (
            <div className="rounded-xl bg-gray-800 border border-gray-700 p-8 text-gray-300">
              <h2 className="text-2xl text-white font-light mb-2">Lab</h2>
              <p>Pick a book, a chapter and a lesson. Its code opens here — change it, run it, and see the result.</p>
              <p className="mt-2 text-sm text-gray-400">Your edits stay in this browser. Each person gets their own kernel.</p>
            </div>
          ) : null}
          </section>
        </div>
      </main>
    </>
  );
}
