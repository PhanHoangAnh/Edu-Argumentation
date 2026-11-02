// Seam 23 (quiz/QuizSetupScreen) — THE MULTI-SELECT CHAPTER / BLOCK PICKER.
//
// PORTED FROM (by symbol, app.js): renderSetupTree, setChapterOpen, syncSetupTree,
// renderSetupCount, openQuizSetup, closeQuizSetup, readSetupChoice, saveSetupChoice,
// allBlockIds, selectedBlockIds, practiceQuestionsFor, generateScopeText.
//
// Contract DOM this seam owns:
//   #quiz-setup-screen · #setup-tree · `#setup-tree input[data-block="*"]` ·
//   #setup-all-btn · #setup-none-btn · #setup-start-btn · #setup-cancel-btn
//   (+ #setup-close-btn, added by item E 22-09-26 — NOT a frozen-contract selector)
//
// ⛔ `data-block` on each checkbox is a CONTRACT ATTRIBUTE, not a convenience: the gate
//    selects `#setup-tree input[data-block="*"]`. Losing it in favour of a React key or
//    a value prop empties that selector.
// ⚠ The picker is MULTI-SELECT WITH DESELECT, and the chosen set is REMEMBERED per mode
//   (practice / generate) across visits.
import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useBookContext } from '../state/BookProvider';
import { useProgressContext } from '../state/ProgressProvider';
import { useQuiz } from '../state/QuizProvider';
import type { QuizQuestion, StoredQuestionBody } from '../data/types';
import { NEW_PER_DAY, SESSION_SIZE, clampStep, useFlags, useMastery, usePrefs, useReviewDue } from '../data/queries';
import type { MasteryArea } from '../data/types';
import type { ReviewDue } from '../data/queries';
import { NextUpRow } from '../account/MasteryBars';
import { areaQuestions, drawForArea } from '../account/ProgressPanel';
import { examPost, savePrefs } from '../data/writes';
import { examOpenKey, normaliseExamRun, useExamOpen } from '../data/queries';
import { askConfirm, showNotice } from '../shell/dialog';
import { LOADING_PANEL_CLASS, LoadingPanel } from '../shell/LoadingPanel';
import { EXAM_MINUTES, EXAM_QUESTIONS, examQuestions, examTitle, remainingMs, spokenClock } from './examMode';
import type { ExamRun } from './examMode';
import { ReviewStats } from './ReviewStats';
import { SizePicker } from './SizePicker';
import type { StudyActions } from '../shell/useStudyActions';
import { AI_ONLY_ON_LIBRARY_BOOKS } from '../shell/useStudyActions';
// study-rooms-qna P2 (29-09-26): the chapter/block tree moved to scope/ScopePicker.tsx, verbatim;
// this dialog renders it bound to the active book (allowBookPick={false}).
import { ScopePicker } from '../scope/ScopePicker';

/** setupMode (app.js:3091). PRACTICE and GENERATE QUIZ open this same dialog. */
export type SetupMode = 'practice' | 'generate';

export interface QuizSetupScreenProps {
  mode: SetupMode;
  /** True while the dialog is showing — the selection is (re)loaded on each open. */
  open: boolean;
  /** Switches the shell to #quiz-screen (practice). ⛔ SEEDING THE RUN IS THIS SEAM'S JOB. */
  onStart: () => void;
  onCancel: () => void;
  actions: StudyActions;
}

/**
 * practiceQuestionsFor(ids), ported verbatim (app.js:3121).
 * ⛔ Filters on `source.block`, never on position.
 */
export function practiceQuestionsFor(bank: QuizQuestion[], ids: string[]): QuizQuestion[] {
  const wanted = new Set(ids);
  return bank.filter((question) => question?.source?.block && wanted.has(question.source.block));
}

/**
 * exam-recall-suite A4 (22-10-26): a Review-due or Flagged run holds at most `size` cards.
 * ⛔ Ordinary Practice is NEVER capped (orchestrator ruling 22-10-26): every question in the
 *    chosen lessons, as before.
 */
export function capToSize(questions: QuizQuestion[], size: number): QuizQuestion[] {
  return questions.length > size ? questions.slice(0, size) : questions;
}

/** Practice length choices; 0 = every question in the selection. */
const PRACTICE_COUNTS = [0, 10, 20, 30, 50] as const;
const COUNT_KEY = 'edu.practice.count.v1';

/** A random `n` of `questions`, kept in their original order. */
export function sampleQuestions(questions: QuizQuestion[], n: number): QuizQuestion[] {
  if (n <= 0 || questions.length <= n) return questions;
  const picked = new Set<number>();
  while (picked.size < n) picked.add(Math.floor(Math.random() * questions.length));
  return questions.filter((_, index) => picked.has(index));
}

/** An AI card / flag's stored body as a quiz question, keyed so grading and flagging find it. */
function questionFromBody(key: string, body: StoredQuestionBody | null | undefined): QuizQuestion | null {
  if (!body || typeof body.question !== 'string' || !Array.isArray(body.options) || body.options.length < 2) return null;
  const correct = body.correct;
  const valid = Array.isArray(correct)
    ? correct.length >= 2 && correct.every((n) => Number.isInteger(n) && n >= 0 && n < body.options.length)
    : Number.isInteger(correct) && correct >= 0 && correct < body.options.length;
  if (!valid) return null;
  return { question: body.question, options: body.options, correct, explanations: body.explanations ?? null, source: { question: key } };
}

/**
 * The questions of a review run, oldest due first, at most `size`. Shared by "Review due (N)" here
 * and the floating review reminder (quiz/ReviewReminder.tsx, 01-11-26).
 * 22-10-26: an AI-written card has no bank entry — it is rebuilt from the body stored with it.
 * Each run question is a COPY carrying the card's lapses, so the quiz can tag a leech (A5).
 */
export function reviewRunQuestions(bank: QuizQuestion[], due: ReviewDue['due'], size: number): QuizQuestion[] {
  const byKey = new Map<string, QuizQuestion>();
  for (const question of bank) if (question?.source?.question) byKey.set(question.source.question, question);
  return due
    .map((card): QuizQuestion | null => {
      const question = byKey.get(card.question) ?? questionFromBody(card.question, card.body);
      return question ? { ...question, reviewLapses: Number(card.lapses) || 0 } : null;
    })
    .filter((question): question is QuizQuestion => Boolean(question))
    .slice(0, size);
}

const GHOST_BTN =
  'min-h-[44px] px-4 rounded-lg border border-gray-600 text-gray-200 hover:border-brand-600 hover:text-white text-sm font-semibold uppercase tracking-wider transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600';

export function QuizSetupScreen({ mode, open, onStart, onCancel, actions }: QuizSetupScreenProps) {
  const { chapters, blocksOf, quizBank, data, moduleId, activeBookFile } = useBookContext();
  const { blockIdOf } = useProgressContext();
  const { dispatch } = useQuiz();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const startRef = useRef<HTMLButtonElement | null>(null);
  // 21-10-26 spaced repetition: cards due for review in THIS book. Shown only in Practice. If the call
  // fails (or the server predates it) the button and the line simply do not appear.
  // exam-recall-suite P1 (22-10-26): session size (A4) + new-card cap (D2) are per book, saved on the
  // server (/api/study/prefs). Local state answers the click at once; the save is debounced, and a
  // failed save keeps the local value for this visit (defaults stand if the read fails).
  const queryClient = useQueryClient();
  const isPractice = mode === 'practice';
  const prefs = usePrefs(moduleId, open && isPractice);
  const [size, setSize] = useState<number>(SESSION_SIZE.fallback);
  // 22-10-26: how many questions an ordinary Practice run asks (0 = all). A random draw, remembered.
  const [count, setCount] = useState<number>(() => {
    try {
      const saved = Number(localStorage.getItem(COUNT_KEY));
      return (PRACTICE_COUNTS as readonly number[]).includes(saved) ? saved : 0;
    } catch {
      return 0;
    }
  });
  const [newPerDay, setNewPerDay] = useState<number>(NEW_PER_DAY.fallback);
  useEffect(() => {
    if (!prefs.data) return;
    setSize(prefs.data.sessionSize);
    setNewPerDay(prefs.data.newPerDay);
  }, [prefs.data]);
  const saveTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(saveTimer.current), []);
  const changePrefs = (next: { sessionSize: number; newPerDay: number }) => {
    const sessionSize = clampStep(next.sessionSize, SESSION_SIZE);
    const perDay = clampStep(next.newPerDay, NEW_PER_DAY);
    setSize(sessionSize);
    setNewPerDay(perDay);
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      void savePrefs({ module: moduleId, sessionSize, newPerDay: perDay }).then((ok) => {
        if (ok) queryClient.setQueryData(['study-prefs', moduleId], { sessionSize, newPerDay: perDay });
      });
    }, 600);
  };
  const review = useReviewDue(moduleId, open && isPractice, size);
  const dueCount = review.data?.dueCount ?? 0;
  // B: flagged questions in this book — "Flagged (N)" starts a run from them.
  const flags = useFlags(moduleId, open && isPractice);
  // exam-recall-suite P2 (22-10-26) D: the weakest area, one tap to practise it (full list: Account → Progress).
  const mastery = useMastery(moduleId, open && isPractice);
  const nextUp = mastery.data?.nextUp ? mastery.data.areas.find((a) => a.id === mastery.data?.nextUp) ?? null : null;
  const startArea = (area: MasteryArea) => {
    const questions = drawForArea(quizBank, area, size);
    if (!questions.length) return;
    dispatch({ type: 'run/reset', questions });
    dispatch({ type: 'scope/set', scope: 'selection', label: area.name, blockId: null });
    onStart();
  };

  const catalog = chapters.flatMap((chapter, chapterIndex) =>
    blocksOf(chapterIndex).map((block, blockIndex) => ({
      id: blockIdOf(chapterIndex, blockIndex),
      chapterIndex,
      blockIndex,
      chapterTitle: chapter.title,
      term: block.term,
    })),
  );
  const allIds = catalog.map((entry) => entry.id);
  const storeKey = `eduQuizSetup.${moduleId}.${mode}`;   // readSetupChoice/saveSetupChoice (app.js:3097)

  // openQuizSetup (app.js:3230): on every open, restore THIS mode's saved pick and expand the
  // chapters that hold part of it, so a saved pick is visible, not hidden. Then focus Start.
  useEffect(() => {
    if (!open) return;
    let saved: string[] = [];
    try {
      const raw = JSON.parse(localStorage.getItem(storeKey) || '[]');
      saved = Array.isArray(raw) ? raw : [];
    } catch {
      saved = [];
    }
    const valid = new Set(allIds);
    const next = new Set(saved.filter((id) => valid.has(id)));
    setSelected(next);
    setExpanded(new Set(chapters.map((_c, ci) => ci).filter((ci) => blocksOf(ci).some((_b, bi) => next.has(blockIdOf(ci, bi))))));
    document.body.classList.add('overflow-hidden');
    requestAnimationFrame(() => startRef.current?.focus());
    return () => document.body.classList.remove('overflow-hidden');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, storeKey]);

  const ids = allIds.filter((id) => selected.has(id));   // selectedBlockIds: reading order
  // renderSetupCount (app.js:3208).
  const blocksText = `${ids.length} block${ids.length === 1 ? '' : 's'}`;
  let countText: string;
  let ready = ids.length > 0;
  if (!ids.length) {
    countText = 'Nothing selected';
  } else if (mode === 'practice') {
    const count = practiceQuestionsFor(quizBank, ids).length;
    countText = `${blocksText} · ${count} question${count === 1 ? '' : 's'}`;
    ready = count > 0;
  } else if (!actions.aiReady) {
    countText = actions.providerReady ? AI_ONLY_ON_LIBRARY_BOOKS : 'No model connected';
    ready = false;
  } else {
    const count = ids.length === 1 ? actions.aiQuestionCount : actions.generatedCountFor(ids.length);
    countText = `${blocksText} · ${count} AI questions`;
  }

  /** The #setup-start-btn listener (app.js:3294). */
  const start = () => {
    if (!ids.length) return;
    try {
      localStorage.setItem(COUNT_KEY, String(count));
    } catch {
      /* per-viewer convenience only */
    }
    try {
      localStorage.setItem(storeKey, JSON.stringify(ids));
    } catch {
      /* per-viewer convenience only */
    }
    if (mode === 'generate') {
      // Everything ticked is the same as no restriction: draw from the whole book.
      void actions.startGeneratedQuiz(ids.length === allIds.length ? [] : ids);
      return;
    }
    if (ids.length === allIds.length) {
      dispatch({ type: 'run/reset', questions: sampleQuestions(quizBank, count) });
      dispatch({ type: 'scope/set', scope: 'module', label: (data?.title as string | undefined) || 'Whole module', blockId: null });
    } else if (ids.length === 1) {
      const only = catalog.find((entry) => entry.id === ids[0]);
      dispatch({ type: 'run/reset', questions: sampleQuestions(practiceQuestionsFor(quizBank, ids), count) });
      dispatch({
        type: 'scope/set',
        scope: 'block',
        label: `${only?.chapterTitle || `Chapter ${(only?.chapterIndex ?? 0) + 1}`} — ${only?.term || `Block ${(only?.blockIndex ?? 0) + 1}`}`,
        blockId: ids[0],
      });
    } else {
      const hit = [...new Set(ids.map((id) => catalog.find((entry) => entry.id === id)?.chapterIndex ?? -1))];
      const wholeChapter = hit.length === 1 && ids.length === blocksOf(hit[0]).length;
      dispatch({ type: 'run/reset', questions: sampleQuestions(practiceQuestionsFor(quizBank, ids), count) });
      dispatch({
        type: 'scope/set',
        scope: 'selection',
        label: wholeChapter
          ? chapters[hit[0]]?.title || `Chapter ${hit[0] + 1}`
          : `${ids.length} blocks from ${hit.length} chapter${hit.length === 1 ? '' : 's'}`,
        blockId: null,
      });
    }
    onStart();
  };

  /** Start a spaced-repetition run: the due cards that exist in this book's bank, oldest due first. */
  const startReview = () => {
    const questions = reviewRunQuestions(quizBank, review.data?.due ?? [], size);
    if (!questions.length) return;
    dispatch({ type: 'run/reset', questions });
    dispatch({ type: 'scope/set', scope: 'review', label: 'Review', blockId: null });
    onStart();
  };

  /** B: a run from the flagged questions (book ones from the bank, AI ones from their stored body). */
  const flaggedQuestions = (() => {
    const byKey = new Map<string, QuizQuestion>();
    for (const question of quizBank) if (question?.source?.question) byKey.set(question.source.question, question);
    return (flags.data ?? [])
      .map((flag) => byKey.get(flag.question) ?? questionFromBody(flag.question, flag.body))
      .filter((question): question is QuizQuestion => Boolean(question));
  })();
  const startFlagged = () => {
    const questions = capToSize(flaggedQuestions, size);
    if (!questions.length) return;
    dispatch({ type: 'run/reset', questions });
    dispatch({ type: 'scope/set', scope: 'selection', label: 'Flagged', blockId: null });
    onStart();
  };

  return (
    <>
      {/* ⛔ The backdrop is the dismiss affordance (D-8). */}
      <div id="setup-backdrop" className="fixed inset-0 bg-black/70" onClick={onCancel} />
      <div
        className="relative min-h-full flex items-start sm:items-center justify-center p-4"
        onClick={(event) => {
          if (event.target === event.currentTarget) onCancel();
        }}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="setup-title"
          className="w-full max-w-3xl bg-gray-800 border border-gray-700 rounded-2xl p-6 sm:p-8 shadow-2xl"
        >
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <h2 id="setup-title" className="text-3xl text-white font-light">
              {mode === 'practice' ? 'Practice' : 'AI-Quiz'}
            </h2>
            <div className="flex items-center gap-2">
              <button id="setup-all-btn" type="button" className={GHOST_BTN} onClick={() => setSelected(new Set(allIds))}>
                All
              </button>
              <button id="setup-none-btn" type="button" className={GHOST_BTN} onClick={() => setSelected(new Set())}>
                None
              </button>
              {/*
                ⚠ NOT IN THE LEGACY. Added in Phase 03 item E (the D-8 nav trap) and fenced by
                  gate-r-modal.mjs: the header is covered while this modal is open, so the way out
                  has to be visible from the top of the dialog. Kept deliberately.
              */}
              <button
                id="setup-close-btn"
                type="button"
                onClick={onCancel}
                aria-label="Close and go back"
                title="Close and go back (Esc)"
                className="min-h-[44px] min-w-[44px] shrink-0 rounded-lg border border-gray-600 text-gray-300 hover:border-brand-600 hover:text-white hover:bg-gray-700 transition-colors active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 flex items-center justify-center"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>

          {/* ⚠ Phase 03 item E, fenced by gate-r-modal.mjs — see the close button above. */}
          <p id="setup-dismiss-hint" className="mb-4 text-sm text-gray-400">
            The menu bar is hidden while you choose. Press{' '}
            <kbd className="rounded border border-gray-600 px-1.5 py-0.5 font-mono text-xs text-gray-200">Esc</kbd>,
            or use <span className="text-gray-200 font-semibold">&times;</span> / Cancel, to go back.
          </p>

          <ScopePicker
            books={[]}
            value={{ bookId: activeBookFile ?? '', blocks: [...selected] }}
            onChange={(next) => setSelected(new Set(next.blocks))}
            allowBookPick={false}
            chapters={chapters}
            expanded={expanded}
            onExpandedChange={setExpanded}
          />

          <p id="setup-count" className="mt-4 text-sm text-gray-400" role="status" aria-live="polite">
            {countText}
          </p>

          {mode === 'practice' && review.data && (
            <p id="review-status" className="mt-1 text-sm text-gray-400" role="status">
              {dueCount > 0
                ? `${dueCount} question${dueCount === 1 ? '' : 's'} due for review`
                : review.data.total > 0
                  ? 'Nothing due for review right now'
                  : 'Questions you answer here come back for review later'}
            </p>
          )}

          {isPractice && nextUp && (
            <div className="mt-4 rounded-lg border border-gray-700 px-4 py-2">
              <NextUpRow area={nextUp} idBase="setup" onPractice={startArea} canPractice={areaQuestions(quizBank, nextUp).length > 0} />
            </div>
          )}

          {isPractice && (
            <ReviewStats
              moduleId={moduleId}
              open={open}
              newPerDay={newPerDay}
              onNewPerDay={(next) => changePrefs({ sessionSize: size, newPerDay: next })}
            />
          )}

          {isPractice && (
            <div id="practice-count" role="radiogroup" aria-label="Questions per practice run" className="mt-5 flex flex-wrap items-center gap-2">
              <span className="mr-1 text-sm font-semibold text-gray-200">Questions</span>
              {PRACTICE_COUNTS.map((n) => (
                <button
                  key={n}
                  type="button"
                  role="radio"
                  aria-checked={count === n}
                  onClick={() => setCount(n)}
                  className={`min-h-[44px] min-w-[44px] rounded-lg border px-3 text-sm font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 ${
                    count === n ? 'border-brand-600 bg-brand-600 text-white' : 'border-gray-600 text-gray-300 hover:border-brand-600 hover:text-white'
                  }`}
                >
                  {n === 0 ? 'All' : n}
                </button>
              ))}
            </div>
          )}

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <button
              ref={startRef}
              id="setup-start-btn"
              type="button"
              disabled={!ready}
              onClick={start}
              className="min-h-[44px] px-8 rounded-lg bg-brand-600 hover:bg-brand-900 text-white font-bold uppercase tracking-wider text-sm transition-colors active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Start
            </button>
            {mode === 'practice' && dueCount > 0 && (
              <button
                id="setup-review-btn"
                type="button"
                onClick={startReview}
                className="min-h-[44px] px-6 rounded-lg border border-brand-600 text-white hover:bg-brand-600 text-sm font-bold uppercase tracking-wider transition-colors"
              >
                Review due ({dueCount})
              </button>
            )}
            {isPractice && flaggedQuestions.length > 0 && (
              <button
                id="setup-flagged-btn"
                type="button"
                onClick={startFlagged}
                className="min-h-[44px] px-6 rounded-lg border border-gray-600 text-gray-200 hover:border-brand-600 hover:text-white text-sm font-bold uppercase tracking-wider transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
              >
                Flagged ({flaggedQuestions.length})
              </button>
            )}
            {/* ⚠ Quiz sessions (resume) were not ported in Phase 03, so there is never one to
                  resume: the button stays in its legacy initial state, hidden. */}
            <button id="setup-resume-btn" type="button" className={`hidden-view min-h-[44px] px-6 rounded-lg border border-gray-600 text-gray-200 hover:border-brand-600 hover:text-white text-sm font-semibold uppercase tracking-wider transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600`}>
              Resume
            </button>
            <button
              id="setup-cancel-btn"
              type="button"
              onClick={onCancel}
              className="min-h-[44px] px-6 rounded-lg text-sm font-semibold uppercase tracking-wider text-gray-400 hover:text-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 ml-auto"
            >
              Cancel
            </button>
          </div>
          {isPractice && (
            <ExamRow
              moduleId={moduleId}
              open={open}
              hasQuestions={quizBank.length > 0}
              onOpenRun={(run) => {
                const { questions } = examQuestions(quizBank, run.questionKeys);
                if (!questions.length) {
                  void showNotice({ title: 'Exam not found in this book', body: 'Its questions are not in the open book.' });
                  return;
                }
                dispatch({ type: 'exam/load', run, questions, label: examTitle(run.blueprint) });
                onStart();
              }}
            />
          )}
          {isPractice && (
            <div className="mt-4">
              <SizePicker
                id="session-size"
                label="Per review"
                unit="cards per review"
                value={size}
                min={SESSION_SIZE.min}
                max={SESSION_SIZE.max}
                step={SESSION_SIZE.step}
                onChange={(next) => changePrefs({ sessionSize: next, newPerDay })}
              />
              <p className="mt-1 text-xs text-gray-400">Cards per review or flagged run.</p>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

/**
 * exam-recall-suite P3 (22-10-26) — E: the "Exam" row of the Practice dialog.
 *   · Book WITH an `exam` block: its facts, read-only ("CLF-C02 · 65 q · 90 min"), from the server.
 *   · Book without one: "Practice exam" with editable Questions / Minutes, labelled as DEFAULTS
 *     (the server's numbers: min(40, pool) q, 60 min). No scaled score in that mode.
 *   · An open run: Resume (time left from the server) + New exam (submits the open one first, after asking).
 *   · The last finished result can be reopened. A failed read hides the row (it never blocks Practice).
 * ⛔ Class strings are complete literals (Tailwind purge).
 */
function ExamRow({
  moduleId,
  open,
  hasQuestions,
  onOpenRun,
}: {
  moduleId: string;
  open: boolean;
  hasQuestions: boolean;
  onOpenRun: (run: ExamRun) => void;
}) {
  const queryClient = useQueryClient();
  const exam = useExamOpen(moduleId, open && hasQuestions);
  const preview = exam.data?.preview ?? null;
  const [questions, setQuestions] = useState<number>(EXAM_QUESTIONS.min);
  const [minutes, setMinutes] = useState<number>(EXAM_MINUTES.min);
  useEffect(() => {
    if (!preview) return;
    setQuestions(preview.questions);
    setMinutes(preview.minutes);
  }, [preview]);
  const [busy, setBusy] = useState(false);
  const abort = useRef<AbortController | null>(null);

  if (!preview || !hasQuestions) return null;
  const run = exam.data?.run ?? null;
  const last = exam.data?.last ?? null;
  const maxQ = Math.max(1, preview.maxQuestions ?? EXAM_QUESTIONS.max);
  const minQ = Math.min(EXAM_QUESTIONS.min, maxQ);
  const maxM = preview.maxMinutes ?? EXAM_MINUTES.max;

  const start = async (restart: boolean) => {
    const controller = new AbortController();
    abort.current = controller;
    setBusy(true);
    const outcome = await examPost(
      '/api/exam/start',
      { module: moduleId, restart, ...(preview.isDefault ? { questions, minutes } : {}) },
      controller.signal,
    );
    abort.current = null;
    setBusy(false);
    void queryClient.invalidateQueries({ queryKey: examOpenKey(moduleId) });
    if (controller.signal.aborted) return;
    const started = outcome.kind === 'ok' ? normaliseExamRun(outcome.data.run, Date.now()) : null;
    if (!started) {
      void showNotice({ title: 'Exam not started', body: outcome.kind === 'ok' ? 'The server sent no run.' : outcome.error });
      return;
    }
    onOpenRun(started);
  };
  const resume = async () => {
    // Re-read first: the server is the clock, and a run past its deadline is submitted by this read.
    const fresh = await exam.refetch();
    const live = fresh.data?.run ?? null;
    if (live) {
      onOpenRun(live);
      return;
    }
    if (fresh.data?.last) {
      void showNotice({ title: 'Time ran out', body: 'That exam was submitted at its deadline.' });
      onOpenRun(fresh.data.last);
    }
  };
  const newExam = async () => {
    const ok = await askConfirm({ title: 'New exam?', body: 'The open exam is submitted as it is.', confirmLabel: 'New exam', cancelLabel: 'Keep it' });
    if (ok) void start(true);
  };

  if (busy) {
    return (
      <div id="exam-row" className={LOADING_PANEL_CLASS}>
        <LoadingPanel
          idBase="exam-start"
          title={<>Starting the <span className="font-bold">exam</span></>}
          scope={preview.isDefault ? `${questions} questions · ${minutes} min` : `${preview.questions} questions · ${preview.minutes} min`}
          model=""
          onCancel={() => abort.current?.abort()}
        />
      </div>
    );
  }

  const lastResult = last?.result ?? null;
  return (
    <div id="exam-row" className="mt-6 border-t border-gray-700 pt-4" data-mode={preview.mode}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <span id="exam-row-label" className="min-w-[5.5rem] text-sm font-semibold text-gray-200">
          {preview.mode === 'exam' && preview.name ? 'Exam' : 'Practice exam'}
        </span>
        {!preview.isDefault && (
          <span id="exam-facts" className="text-sm text-white tabular-nums">
            {preview.name ? `${preview.name} · ` : ''}
            {preview.questions} q · {preview.minutes} min
          </span>
        )}
        {run ? (
          <>
            <button id="exam-resume-btn" type="button" className="min-h-[44px] px-6 rounded-lg bg-brand-600 hover:bg-brand-900 text-white font-bold uppercase tracking-wider text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white" onClick={() => void resume()}>
              Resume
            </button>
            <span id="exam-open-left" className="text-sm text-gray-300">{spokenClock(remainingMs(run))}</span>
            <button id="exam-new-run-btn" type="button" className={GHOST_BTN} onClick={() => void newExam()}>
              New exam
            </button>
          </>
        ) : (
          !preview.isDefault && (
            <button id="exam-start-btn" type="button" className="min-h-[44px] px-6 rounded-lg border border-brand-600 text-white hover:bg-brand-600 text-sm font-bold uppercase tracking-wider transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600" onClick={() => void start(false)}>
              Start exam
            </button>
          )
        )}
      </div>
      {preview.isDefault && !run && (
        <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-3">
          <SizePicker id="exam-questions" label="Questions" unit="questions" value={questions} min={minQ} max={maxQ} step={EXAM_QUESTIONS.step} onChange={setQuestions} />
          <SizePicker id="exam-minutes" label="Minutes" unit="minutes" value={minutes} min={EXAM_MINUTES.min} max={maxM} step={EXAM_MINUTES.step} onChange={setMinutes} />
          <button id="exam-start-btn" type="button" className="min-h-[44px] px-6 rounded-lg border border-brand-600 text-white hover:bg-brand-600 text-sm font-bold uppercase tracking-wider transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600" onClick={() => void start(false)}>
            Start exam
          </button>
        </div>
      )}
      <p id="exam-row-help" className="mt-1 text-xs text-gray-400">
        {preview.isDefault
          ? 'Defaults — change them if you like. Timed, scored at the end.'
          : `The book's exam numbers. Timed, scored at the end${preview.hasScaled ? '; scaled score is an estimate' : ''}.`}
      </p>
      {exam.data?.expiredNow && <p className="mt-1 text-xs text-amber-300">Your last exam ran out of time and was submitted.</p>}
      {lastResult && !run && last && (
        <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-gray-300">
          <span id="exam-last">Last: {lastResult.right}/{lastResult.total}</span>
          <button id="exam-last-btn" type="button" className={GHOST_BTN} onClick={() => onOpenRun(last)}>
            Result
          </button>
        </div>
      )}
    </div>
  );
}
