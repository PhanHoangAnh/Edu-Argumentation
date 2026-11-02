// Seam 13 (reader/ReaderScreen) — THE READING PANE.
//
// PORTED FROM (by symbol, app.js): renderTheoryBlock, selectTheory, renderTutorial,
// showTutorial, previousTheory, nextTheory, renderBlockQuizButton, setReaderMode.
//
// ⛔⛔ B7 — SCROLL RESET IS TIED TO **VISIBILITY**, NOT TO THE CURSOR (Decision 6).
//     A useLayoutEffect keyed on [cursor, isVisible] writes el.scrollTop = 0 ONLY WHEN
//     VISIBLE. Both legacy write sites (selectTheory's reset and returnToReader's)
//     collapse into this one effect.
//     ⚠ A ref callback would be the idiomatic React place for this and it NEVER
//       RE-FIRES here, because the screen is never unmounted — see shell/Screen.tsx.
//     Without the reset, "Next" lands you halfway down the next lesson: the READING PANE
//     scrolls, not the window.
//
// ⛔ B3 — the `body.reader-mode` 100dvh / min-h-0 chain is what makes #tutorial-article
//    the scroll container rather than the window. The <body> class is owned by AppShell;
//    the min-h-0 chain is owned here, and breaking either makes the pane un-scrollable
//    while still looking correct.
//    ⚠ The scroll gate carries an ANTI-VACUITY FLOOR: it must FIRST assert
//      `scrollHeight > clientHeight + 200` and fail if the fixture cannot scroll at all.
//      On a short block `scrollHeight <= clientHeight` and "scrollTop === 0" passes
//      trivially.
//
// Contract DOM this seam owns:
//   #tutorial-screen · #tutorial-content · `#tutorial-content button` ·
//   `#tutorial-content rich-text-viewer` · `#tutorial-content .katex .sqrt`
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useBookContext } from '../state/BookProvider';
import { useProgressContext } from '../state/ProgressProvider';
import { useReaderCursor } from '../state/ReaderCursorProvider';
import { BlockRenderer } from './BlockRenderer';
import { lessonHasCode } from './labCode';
import { TheoryToc } from './TheoryToc';
import { ChatDock, LabDock, labOrigins, labPath } from './LabDock';
import { useChatDock } from '../ask/chatDock';
import { ExercisePanel } from '../exercises/ExercisePanel';
import { exerciseSpec } from '../exercises/exerciseSpec';
import type { SubBlock } from '../data/types';
import type { StudyActions } from '../shell/useStudyActions';
import { AI_ONLY_ON_LIBRARY_BOOKS } from '../shell/useStudyActions';

export interface ReaderScreenProps {
  /** Drives the B7 scroll reset. See the header — this is NOT decoration. */
  isVisible: boolean;
  /** Phase 04: the assessment + AI quiz actions (shell/useStudyActions). */
  actions: StudyActions;
  /** 25-09-26: bring the reader to the front (Lab asked to be docked back into it). */
  onShowReader?: () => void;
}

/** 22-10-26: the one-line reason shown while Lab is off. */
const LAB_OFF = 'Lab is off while chat is docked. Press Popup in the chat.';

/** isWideViewport (app.js:259) — the contents panel is a column at lg+, a drawer below. */
const WIDE_VIEWPORT = '(min-width: 1024px)';
function isWideViewport(): boolean {
  return typeof window !== 'undefined' && window.matchMedia(WIDE_VIEWPORT).matches;
}

export function ReaderScreen({ isVisible, actions, onShowReader }: ReaderScreenProps) {
  const { chapters, blocksOf, assetBase, quizBank, moduleId } = useBookContext();
  const { isBlockComplete } = useProgressContext();
  // ⚠ COLLISION REPAIR (slice A3, 22-09-26). Slices A2 and A3 both edited this file in
  //   the same window. A2 lifted the cursor into state/ReaderCursorProvider (a 5th
  //   context, because CodeCellsBlock and AppShell also need it) and rewired the import
  //   here; A3 had already replaced this call with a 3-argument useHashCursor. The two
  //   writes interleaved and left a file importing useReaderCursor while still CALLING
  //   useHashCursor — it did not compile.
  //   Resolved in A2's favour, on the merits: routing/useHashCursor.ts stays the hash
  //   mechanism (A3's seam, unchanged), and the provider is the right owner of a cursor
  //   two sibling screens share. A3's B15 work moved into useHashCursor.ts, where it
  //   belongs. Recorded, not silently merged — see the slice-A3 report.
  //   ⛑ CLOSED BY SLICE A4/B, 22-09-26 — AND THE PREVIOUS RESOLUTION NOTE WAS WRONG.
  //   A3's report said A2 "backed the provider out". On disk it did not:
  //   state/ReaderCursorProvider.tsx exists and shell/AppShell.tsx mounts it and calls its
  //   enterReader(). A3 then repaired THIS file back to a direct useHashCursor() call — so
  //   the app shipped **TWO CURSOR INSTANCES**, and that is not a tidiness problem:
  //     · #read-tutorial-btn (LEARN) moved the PROVIDER's cursor;
  //     · this screen rendered a DIFFERENT cursor that never heard about it, because
  //       writeCursorHash uses replaceState and replaceState emits NO `hashchange`;
  //     · so LEARN did not stamp the hash the reader was showing — B15's overwrite half
  //       was dead, and b15probe.mjs would have read a different hash than :8791.
  //   That is exactly blocker A2-R3. The fix is the one line ReaderCursorProvider's own
  //   header asks for, and it is now applied. ⛔ ONE cursor. Do not reintroduce a local
  //   useHashCursor() here for any reason.
  const { cursor, select, previous, next } = useReaderCursor();
  // ⛔ `previous`/`next` come from the provider and are CROSS-CHAPTER (state/theoryNav).
  //    A1's same-chapter approximation disabled Next on the last block of EVERY chapter and
  //    stranded the reader 18 times in Géron; `null` here means the true end of the BOOK.
  // ⚠ HTMLElement, not HTMLDivElement — the scroll container is an <article> (B3 markup).
  const articleRef = useRef<HTMLElement | null>(null);

  // ⛔ B7. Keyed on [cursor, isVisible]; writes only when visible.
  useLayoutEffect(() => {
    if (!isVisible) return;
    const element = articleRef.current;
    if (element) element.scrollTop = 0;
  }, [cursor, isVisible]);

  // tocOpen / setTocOpen / syncTocToViewport (app.js:257-275): open by default where there
  // is room for it, closed where there is not; re-synced when the viewport crosses lg.
  const [tocOpen, setTocOpen] = useState<boolean>(isWideViewport);
  // ⚑ 25-09-26: the Lab panel beside the reading pane (LabDock). null = closed.
  const [labSrc, setLabSrcRaw] = useState<string | null>(null);
  // ⚑ 22-10-26 (user): while the tutor chat is docked in Lab's slot, Lab cannot open; docking
  //   closes an open Lab. The ref lets the once-registered message listener see the current mode.
  const chatDocked = useChatDock().mode === 'side';
  const chatDockedRef = useRef(chatDocked);
  chatDockedRef.current = chatDocked;
  const [labNote, setLabNote] = useState(false);
  const setLabSrc = (value: string | null) => {
    if (value !== null && chatDockedRef.current) return;
    setLabSrcRaw(value);
  };
  useEffect(() => {
    if (chatDocked) setLabSrcRaw(null);
    else setLabNote(false);
  }, [chatDocked]);
  const toggleLabRef = useRef<() => void>(() => undefined);

  // Lab talks to us by postMessage (its header glyphs), from the panel or from its own tab:
  //   lab:close   (panel)      -> close the panel
  //   lab:popout  (panel)      -> open that Lab page in a NEW browser tab, close the panel
  //   lab:dock    (Lab's tab)  -> put that Lab page back into the panel here, show the reader
  // Only messages from a Lab origin are believed; the href is re-validated (labPath).
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (!labOrigins().includes(event.origin)) return;
      const data = event.data as { type?: unknown; href?: unknown } | null;
      if (!data || typeof data.type !== 'string') return;
      if (data.type === 'lab:close') setLabSrc(null);
      if (data.type === 'lab:popout') {
        const path = labPath(data.href);
        if (path) window.open(path, '_blank');
        setLabSrc(null);
      }
      if (data.type === 'lab:dock') {
        const path = labPath(data.href);
        if (!path) return;
        onShowReader?.();
        setLabSrc(path);
        window.focus();
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [onShowReader]);

  // "Back to Learn" from a Lab tab this window did not open arrives as ?lab=/lab/... (no opener to
  // message). Dock it once, then drop the parameter from the address bar.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const path = labPath(params.get('lab'));
    if (!params.has('lab')) return;
    params.delete('lab');
    const rest = params.toString();
    window.history.replaceState(window.history.state, '', window.location.pathname + (rest ? `?${rest}` : '') + window.location.hash);
    if (path) {
      onShowReader?.();
      setLabSrc(path);
    }
    // once, on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    const query = window.matchMedia(WIDE_VIEWPORT);
    const sync = () => setTocOpen(query.matches);
    query.addEventListener('change', sync);
    return () => query.removeEventListener('change', sync);
  }, []);

  // ⚑ 23-09-26 (user): `[` toggles the contents sidebar from anywhere on the Learn page, and Esc
  //   closes it at EVERY width (it used to close the phone drawer only). Chosen by the user over a
  //   sticky bar. Rules, each asserted by gates/gate-r-style.mjs (R-S-TOC-KEYS):
  //   · LEARN ONLY: the listener exists only while this screen is visible (the screen stays mounted
  //     under .hidden-view on every other page, so `isVisible` is the scope, not mounting).
  //   · Never while typing: ignored when ANY node on the event's composedPath() is an input,
  //     textarea, select or contenteditable — composedPath, not event.target, because
  //     <rich-text-viewer> renders in a shadow root and a retargeted target would hide the field.
  //     Also ignored with Ctrl/Alt/Meta held, on key-repeat, and when already handled.
  //   · Focus: opened by the keyboard -> focus moves INTO the panel (the current lesson, else the
  //     close button); closed by the keyboard -> focus returns to #toc-toggle-btn, with
  //     preventScroll so the lesson's scroll position is not disturbed (the button lives inside the
  //     scrolling <article>).
  const focusAfterToggle = useRef<'panel' | 'toggle' | null>(null);
  useEffect(() => {
    const intent = focusAfterToggle.current;
    if (!intent) return;
    focusAfterToggle.current = null;
    if (intent === 'panel' && tocOpen) {
      const target =
        document.querySelector<HTMLElement>('#toc-nav button[aria-current="true"]') ??
        document.getElementById('toc-close-btn');
      target?.focus({ preventScroll: false });
    } else if (intent === 'toggle' && !tocOpen) {
      document.getElementById('toc-toggle-btn')?.focus({ preventScroll: true });
    }
  }, [tocOpen]);
  useEffect(() => {
    if (!isVisible) return;
    const typing = (event: KeyboardEvent) =>
      event.composedPath().some((node) => {
        if (!(node instanceof HTMLElement)) return false;
        const tag = node.tagName;
        return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || node.isContentEditable;
      });
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.ctrlKey || event.altKey || event.metaKey) return;
      if (event.key === '[') {
        if (event.repeat || typing(event)) return;
        event.preventDefault();
        setTocOpen((open) => {
          focusAfterToggle.current = open ? 'toggle' : 'panel';
          return !open;
        });
      } else if (event.key === ']') {
        // ⚑ 25-09-26 (user): `]` toggles the Lab panel, as `[` toggles the contents sidebar.
        if (event.repeat || typing(event)) return;
        event.preventDefault();
        toggleLabRef.current();
      } else if (event.key === 'Escape') {
        if (typing(event)) return;
        setTocOpen((open) => {
          if (open) focusAfterToggle.current = 'toggle';
          return false;
        });
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isVisible]);

  const chapter = chapters[cursor.chapterIndex];
  const blocks = blocksOf(cursor.chapterIndex);
  const block = blocks[cursor.blockIndex];
  const theme = chapter?.themeColor ?? 'brand-600';
  const done = isBlockComplete(cursor.chapterIndex, cursor.blockIndex);
  const exercises = block ? exerciseSpec(block) : null;
  const subBlocks: SubBlock[] = Array.isArray(block?.blocks) ? (block.blocks as SubBlock[]) : [];
  const blockId = `ch${String(cursor.chapterIndex + 1).padStart(2, '0')}-b${String(cursor.blockIndex + 1).padStart(2, '0')}`;
  // `]`: close the Lab panel if open; else open it on this lesson's code — or, for a lesson with
  // no code, on this book (Lab then shows the book's first lesson with code). Kept in a ref so the
  // key listener (registered once per visibility) always sees the current lesson.
  toggleLabRef.current = () => {
    if (chatDocked) {
      setLabNote(true);
      return;
    }
    if (labSrc) {
      setLabSrc(null);
      return;
    }
    const book = `/lab/${encodeURIComponent(moduleId)}/`;
    setLabSrc(block && lessonHasCode(block) ? `${book}${blockId}` : book);
  };

  // renderTheoryBlock clears #ai-block-status on every block change (app.js:2297).
  const { setAiBlockStatus } = actions;
  useEffect(() => {
    setAiBlockStatus('');
  }, [cursor.chapterIndex, cursor.blockIndex, setAiBlockStatus]);

  // renderBlockQuizButton (app.js:2300) — the button names how many questions this block has.
  const written = quizBankFor(blockId);
  let quizLabel: string;
  let quizTitle: string;
  let quizDisabled = false;
  if (exercises) {
    // On the exercise lesson the exercises on the page ARE the assessment (user, 19-09-26).
    quizLabel = done ? '✓ Exercises complete' : 'Answer the exercises above';
    quizTitle = done
      ? 'Already completed. You can still redo the exercises above.'
      : 'This block is completed by answering the exercises on this page, not by a separate quiz.';
    quizDisabled = true;
  } else if (written > 0) {
    quizLabel = `${done ? 'Retake' : 'Begin Assessment'} · ${written} question${written === 1 ? '' : 's'}`;
    quizTitle = done ? 'Already completed. Retaking cannot un-complete it.' : 'Assess only the block you are reading — 100% marks it complete';
  } else {
    quizLabel = `${done ? 'Retake' : 'Begin Assessment'} · AI-written`;
    quizTitle = 'This block has no written questions; the connected model writes them';
  }

  // syncAiQuizButton (app.js:3359) — recomputed from whatever is true NOW.
  const aiTitle = actions.providerStatusUnknown
    ? 'Provider status unavailable; the book quizzes still work'
    : actions.aiReady
      ? `Generate questions with ${actions.providerModel || 'the connected model'}`
      : actions.providerReady
        ? AI_ONLY_ON_LIBRARY_BOOKS
        : 'Unavailable until an operator configures a provider on the server';

  return (
    <>
      {/* Mobile drawer backdrop; lg:hidden keeps it out of the desktop layout entirely. */}
      <div
        id="toc-backdrop"
        className={`${tocOpen ? '' : 'hidden-view '}fixed inset-0 z-40 bg-black/60 lg:hidden`}
        onClick={() => setTocOpen(false)}
      />

      <TheoryToc
        cursor={cursor}
        open={tocOpen}
        onClose={() => setTocOpen(false)}
        onSelect={(next) => {
          select(next);
          if (!isWideViewport()) setTocOpen(false);
        }}
      />

      {/*
        ⛔ THIS is the scroll container, not the window — that is what `body.reader-mode`'s
           100dvh cap exists to arrange, and it is what B7's `el.scrollTop = 0` writes to.
      */}
      <article
        id="tutorial-article"
        ref={articleRef}
        className={`min-w-0 flex-1 min-h-0 overflow-y-auto flex flex-col bg-gray-800 border border-gray-700 rounded-xl`}
      >
        <div className="flex-1 w-full p-4 sm:p-8 lg:p-10">
          {/*
            ⚑ PHASE 04 PARITY: these two do NOT exist in the legacy markup (index.html:333-341)
              — renderTheoryBlock writes to them through `if (dom.x)` guards that find nothing.
              The port rendered them VISIBLY above every title. Kept in the DOM (an earlier gate
              may read them) but hidden, which is what the reader sees on :8767.
          */}
          <p id="theory-chapter-label" className="hidden-view">{chapter?.title ?? ''}</p>
          <p id="theory-block-position" className={done ? 'hidden-view text-green-400' : 'hidden-view'}>
            {blocks.length ? `Block ${cursor.blockIndex + 1} of ${blocks.length}${done ? ' · ✓ completed' : ''}` : ''}
          </p>

          {/*
            ⚑ 23-09-26 (user): the ☰ toggle sits on the SAME ROW as the lesson title — button left,
              title right, vertically centred — instead of on a row of its own above it. The title
              is `min-w-0 break-words` so a long title wraps inside the row on a phone instead of
              pushing the row wider than the pane. Margin below moved from the h2 to the row.
          */}
          <div className="flex items-center gap-2 sm:gap-4 mb-8">
            <button
              id="toc-toggle-btn"
              type="button"
              onClick={() => setTocOpen((open) => !open)}
              className="min-h-[44px] min-w-[44px] rounded-lg border border-gray-600 text-gray-300 hover:text-white hover:border-brand-600 transition-colors active:scale-95 flex items-center justify-center shrink-0"
              aria-controls="toc-panel"
              aria-expanded={tocOpen ? 'true' : 'false'}
              aria-label="Contents"
              aria-keyshortcuts="["
              title="Toggle sidebar ( [ )"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
            {/* ⛔ <h2>, not <h1> — index.html:342. */}
            {/*
              ⚑ 24-09-26 (user, plan D9): the title carries the lesson's number in its chapter —
                "13. Title" — in the SAME <h2>, same font and size. One text node, so
                textContent is exactly "<n>. <term>" (gates strip /^\d+\.\s/ before comparing).
            */}
            <h2 id="tutorial-main-title" className="min-w-0 flex-1 break-words text-[1.875rem] sm:text-4xl text-white font-light">
              {`${cursor.blockIndex + 1}. ${block?.term ?? `Theory block ${cursor.blockIndex + 1}`}`}
            </h2>
            {/*
              ⚑ 24-09-26 (plan D8, ruling R27): "Lab" opens this lesson's code in the separate Lab
                app, in a new tab. Only when the lesson HAS code (labCode.ts = Lab's own D5 rule).
                The href names the book by its MODULE id (e.g. openintro-statistics-2019-1045f2f5),
                never the reader's path slug — Lab keys books by module id.
              ⚑ 24-09-26 (390 px polish): the link is compact on a phone (px-2, text-xs, 44x44 floor),
                the row gap is gap-2 and the pane padding p-4 below sm, so the title keeps ~232 px and a
                word like "Representative" (220 px at this size) wraps whole instead of breaking
                mid-word. `break-words` stays only as the last resort for a single word wider than
                that (e.g. "Hyperparameters", 252 px) — never overflowing the pane.
                Reading stays static (R24): this is a link, not a run button.
            */}
            {lessonHasCode(block) ? (
              <a
                id="lab-open-btn"
                href={chatDocked ? undefined : `/lab/${encodeURIComponent(moduleId)}/${blockId}`}
                target={chatDocked ? undefined : '_blank'}
                rel="noopener"
                title={chatDocked ? LAB_OFF : "Open this lesson's code in Lab, in this window ( ] )"}
                aria-keyshortcuts="]"
                aria-label={chatDocked ? `Lab, unavailable. ${LAB_OFF}` : 'Lab'}
                aria-disabled={chatDocked ? 'true' : undefined}
                role={chatDocked ? 'link' : undefined}
                tabIndex={chatDocked ? 0 : undefined}
                onClick={(event) => {
                  if (chatDocked) {
                    event.preventDefault();
                    setLabNote(true);
                    return;
                  }
                  // ⚑ 25-09-26 (user): Lab opens in THIS window on every screen; a new tab only from
                  //   Lab's own "open in a new tab" glyph. (Middle-click still opens a tab.)
                  event.preventDefault();
                  setLabSrc(event.currentTarget.getAttribute('href'));
                }}
                className={`shrink-0 min-h-[44px] min-w-[44px] rounded-lg border border-gray-600 text-gray-300 transition-colors flex items-center justify-center ${chatDocked ? 'opacity-40 cursor-not-allowed' : 'hover:text-white hover:border-brand-600 active:scale-95'}`}
              >
                {/* ⚑ 25-09-26 (user): a lab-flask GLYPH, not the word — also frees the title's width at 390 px. */}
                <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M9 3h6" />
                  <path d="M10 3v6.2L4.6 18.4A1.7 1.7 0 0 0 6.1 21h11.8a1.7 1.7 0 0 0 1.5-2.6L14 9.2V3" />
                  <path d="M7.2 14.5h9.6" />
                </svg>
              </a>
            ) : null}
          </div>

          {chatDocked && labNote ? (
            <p id="lab-off-note" role="status" className="-mt-4 mb-6 text-xs text-gray-400">
              {LAB_OFF}
            </p>
          ) : null}

          {/* ⛔ `prose` IS LOAD-BEARING — see app.css `#tutorial-content.prose`. */}
          <div id="tutorial-content" className="text-gray-300 prose prose-invert max-w-none">
            {exercises ? (
              <>
                <BlockRenderer blocks={exercises.intro} theme={theme} assetBase={assetBase} />
                <ExercisePanel spec={exercises} blockId={blockId} recordProgress={actions.recordProgress} />
              </>
            ) : (
              <BlockRenderer blocks={subBlocks} theme={theme} assetBase={assetBase} />
            )}
          </div>

          {/* One row, one button size (user, 21-09-26) — index.html:348-357, verbatim. */}
          <div className="mt-10 pt-6 border-t border-gray-700 flex flex-wrap items-center gap-3">
            <button
              id="prev-block-btn"
              type="button"
              disabled={!previous}
              onClick={() => previous && select(previous)}
              className="min-h-[44px] px-5 rounded-lg border border-gray-600 text-gray-200 font-semibold uppercase tracking-wider text-sm transition-colors hover:bg-gray-700 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Previous
            </button>
            <button
              id="tutorial-to-quiz-btn"
              type="button"
              disabled={quizDisabled}
              title={quizTitle}
              onClick={actions.beginBlockAssessment}
              className={`min-h-[44px] px-5 rounded-lg border border-brand-600 text-brand-400 hover:bg-brand-600 hover:text-white font-semibold uppercase tracking-wider text-sm transition-colors active:scale-95${quizDisabled ? ' opacity-50 cursor-not-allowed' : ''}`}
            >
              <span id="tutorial-to-quiz-label">{quizLabel}</span>
            </button>
            <button
              id="block-ai-quiz-btn"
              type="button"
              disabled={!actions.aiReady || actions.aiBusy}
              title={aiTitle}
              onClick={() => void actions.startBlockAiQuiz()}
              className="min-h-[44px] px-5 rounded-lg border border-gray-600 text-gray-300 hover:border-brand-600 hover:text-white font-semibold uppercase tracking-wider text-sm transition-colors active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              AI-Quiz
            </button>
            {actions.aiBusy ? (
              // ⚑ 25-09-26 (user): cancel the AI-Quiz being written for this block.
              <button
                id="block-ai-cancel-btn"
                type="button"
                onClick={actions.cancelAiQuiz}
                className="min-h-[44px] px-5 rounded-lg border border-gray-600 text-gray-300 hover:border-brand-600 hover:text-white font-semibold uppercase tracking-wider text-sm transition-colors active:scale-95"
              >
                Cancel
              </button>
            ) : null}
            <button
              id="next-block-btn"
              type="button"
              disabled={!next}
              onClick={() => next && select(next)}
              className="min-h-[44px] px-5 rounded-lg bg-brand-600 hover:bg-brand-900 text-white font-semibold uppercase tracking-wider text-sm transition-colors active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed ml-auto"
            >
              Next
            </button>
          </div>
          <p id="ai-block-status" className="mt-3 text-xs text-gray-500" role="status">
            {actions.aiBlockStatus}
          </p>
        </div>
      </article>
      {labSrc && !chatDocked ? <LabDock src={labSrc} /> : null}
      {chatDocked ? <ChatDock /> : null}
    </>
  );

  function quizBankFor(id: string): number {
    return quizBank.filter((q) => q?.source?.block === id).length;
  }
}
