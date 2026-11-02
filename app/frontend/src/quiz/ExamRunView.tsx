// exam-recall-suite P3 (22-10-26) — E: the timed mock exam, INSIDE #quiz-screen (QuizScreen's exam branch).
//
// Same page, same option cards, same pinned bar as an ordinary run — what changes in an exam:
//   · "Question 12 of 65" in the header, a server-driven countdown, Flag (exam + the normal flag list),
//     and a question navigator (ExamNavigator).
//   · NO verdict while the exam runs: a pick is saved to the server (/api/exam/answer) and can be
//     changed until Submit. Nothing is scored, logged or enrolled here — the server grades at finish
//     and writes the answer log itself (addons/exam.py).
//   · Back / Next move freely; Submit asks first (app dialog) with the unanswered / flagged counts.
//   · Leave asks first (app dialog): the run stays open on the server and the timer keeps running;
//     Practice → Exam → Resume brings it back, and so does a reload (memory
//     in-progress-work-persists-until-new). No `beforeunload` prompt: a reload loses nothing.
//   · At 0:00 it submits on its own; a late answer the server refused (409) shows the result instead.
// ⛔ Never window.confirm / alert (memory no-native-browser-dialogs; gate R-RO4): shell/dialog.tsx only.
// ⛔ #action-container stays a DESCENDANT of #quiz-screen (QuizScreen B6/B6b) — no portal.
// ⛔ Class strings are complete literals (Tailwind purge).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { examOpenKey, flagsKey, normaliseExamResult } from '../data/queries';
import { examPost } from '../data/writes';
import type { QuizQuestion } from '../data/types';
import { RichTextViewer } from '../reader/RichTextViewer';
import { askConfirm, showNotice } from '../shell/dialog';
import { LOADING_PANEL_CLASS, LoadingPanel } from '../shell/LoadingPanel';
import { useQuiz } from '../state/QuizProvider';
import { ExamNavigator } from './ExamNavigator';
import { ExamResult } from './ExamResult';
import { ExamTimer } from './ExamTimer';
import { examCounts, examTitle, isComplete, submitSummary } from './examMode';
import type { ExamChoice, ExamRun } from './examMode';
import { correctSetOf } from './multiAnswer';
import { OptionCard } from './OptionCard';

const FLAG_OFF =
  'min-h-[44px] min-w-[44px] rounded-lg border border-gray-600 text-gray-300 hover:border-brand-600 hover:text-white transition-colors active:scale-95 motion-reduce:transform-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 flex items-center justify-center';
const FLAG_ON =
  'min-h-[44px] min-w-[44px] rounded-lg border border-brand-600 bg-brand-600/20 text-brand-400 hover:text-white transition-colors active:scale-95 motion-reduce:transform-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 flex items-center justify-center';
const BAR_GHOST =
  'min-h-[44px] shrink-0 rounded-lg border border-gray-600 px-4 text-sm font-bold uppercase tracking-wider text-gray-200 hover:border-brand-600 hover:text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600';
const BAR_PRIMARY =
  'min-h-[44px] shrink-0 rounded-lg bg-brand-600 hover:bg-brand-900 px-6 text-sm font-bold uppercase tracking-wider text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white';

/** The question's book key (exam questions always come from the bank). */
const keyOf = (question: QuizQuestion | undefined) => question?.source?.question ?? '';

export interface ExamRunViewProps {
  run: ExamRun;
  moduleId: string;
  /** Leave the exam screen (opens the Practice dialog, where Resume / New exam live). */
  onLeave: () => void;
}

export function ExamRunView({ run, moduleId, onLeave }: ExamRunViewProps) {
  const { state, dispatch } = useQuiz();
  const queryClient = useQueryClient();
  const questions = state.active;
  const count = questions.length;
  const index = Math.min(state.currentQuestionIndex, Math.max(0, count - 1));
  const question = questions[index];
  const key = keyOf(question);
  const choice = key ? run.answers[key] : undefined;
  const correctSet = correctSetOf(question);
  const choose = correctSet ? correctSet.length : 1;
  const picked: number[] = Array.isArray(choice) ? choice : typeof choice === 'number' ? [choice] : [];
  const flagged = Boolean(key && run.flags.includes(key));
  const title = examTitle(run.blueprint);
  const [status, setStatus] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const statusTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(statusTimer.current), []);
  const say = (text: string, sticky = false) => {
    setStatus(text);
    window.clearTimeout(statusTimer.current);
    if (!sticky) statusTimer.current = window.setTimeout(() => setStatus(''), 2500);
  };

  const byKey = useMemo(() => {
    const map = new Map<string, QuizQuestion>();
    for (const q of questions) if (keyOf(q)) map.set(keyOf(q), q);
    return map;
  }, [questions]);
  const counts = examCounts(run, byKey);

  /** The run ended on the server (deadline / already submitted): show its result. */
  const closeWith = useCallback(
    (rawResult: unknown) => {
      const result = normaliseExamResult(rawResult);
      if (result) dispatch({ type: 'exam/finished', result });
      void queryClient.invalidateQueries({ queryKey: examOpenKey(moduleId) });
    },
    [dispatch, queryClient, moduleId],
  );

  // ---------------------------------------------------------------- answer (saved per pick)
  const save = async (next: ExamChoice | null) => {
    if (!key || run.finished) return;
    const before = choice ?? null;
    dispatch({ type: 'exam/answer', key, choice: next });
    const outcome = await examPost('/api/exam/answer', { runId: run.id, question: key, chosen: next });
    if (outcome.kind === 'closed') {
      say(outcome.error, true);
      closeWith(outcome.result);
      return;
    }
    if (outcome.kind === 'failed') {
      dispatch({ type: 'exam/answer', key, choice: before });
      say(`Not saved — ${outcome.error}`, true);
      return;
    }
    say('Saved');
  };
  const pick = (option: number) => {
    if (run.finished || submitting) return;
    if (!correctSet) {
      if (choice === option) return;
      void save(option);
      return;
    }
    // choose-N: tick / untick, at most N ticks; an empty set clears the answer.
    const next = picked.includes(option)
      ? picked.filter((i) => i !== option)
      : picked.length >= choose
        ? picked
        : [...picked, option].sort((x, y) => x - y);
    if (next.length === picked.length && next.every((v, i) => v === picked[i])) return;
    void save(next.length ? next : null);
  };

  // ---------------------------------------------------------------- flag (exam + the normal flag list)
  const toggleFlag = async () => {
    if (!key || run.finished) return;
    const want = !flagged;
    dispatch({ type: 'exam/flag', key, flagged: want });
    const outcome = await examPost('/api/exam/flag', { runId: run.id, question: key, flagged: want });
    if (outcome.kind === 'closed') {
      closeWith(outcome.result);
      return;
    }
    if (outcome.kind === 'failed') {
      dispatch({ type: 'exam/flag', key, flagged: !want });
      say('Not saved', true);
      return;
    }
    say(want ? 'Flagged' : 'Unflagged');
    void queryClient.invalidateQueries({ queryKey: flagsKey(moduleId) });
  };

  // ---------------------------------------------------------------- submit / time up
  const finishing = useRef(false);
  const finishAbort = useRef<AbortController | null>(null);
  const finish = useCallback(async () => {
    if (finishing.current) return;
    finishing.current = true;
    setSubmitting(true);
    const controller = new AbortController();
    finishAbort.current = controller;
    const outcome = await examPost('/api/exam/finish', { runId: run.id }, controller.signal);
    finishAbort.current = null;
    setSubmitting(false);
    finishing.current = false;
    if (controller.signal.aborted) return;   // Cancel: back to the questions (a 409 later shows the result if it did land)
    if (outcome.kind === 'failed') {
      void showNotice({ title: 'Exam not submitted', body: `${outcome.error} Your answers are saved — try Submit again.` });
      return;
    }
    closeWith(outcome.kind === 'ok' ? outcome.data.result : outcome.result);
  }, [run.id, closeWith]);
  const submit = async () => {
    const ok = await askConfirm({ title: 'Submit exam?', body: submitSummary(counts), confirmLabel: 'Submit', cancelLabel: 'Keep going' });
    if (ok) void finish();
  };
  const onExpire = useCallback(() => void finish(), [finish]);

  const leave = async () => {
    const ok = await askConfirm({ title: 'Leave exam?', body: 'Timer keeps running. Resume from Practice.', confirmLabel: 'Leave', cancelLabel: 'Stay' });
    if (ok) onLeave();
  };

  const go = (to: number) => dispatch({ type: 'exam/goto', index: to });

  // ---------------------------------------------------------------- the result (same screen)
  if (run.finished && run.result) {
    return (
      <ExamResult
        result={run.result}
        title={title}
        byKey={byKey}
        onRetryMissed={() => {
          const result = run.result;
          if (!result) return;
          const wrong = result.missed.map((k) => byKey.get(k)).filter((q): q is QuizQuestion => Boolean(q));
          if (!wrong.length) return;
          // ⛔ The existing carry (run/retryFrom → narrowTo), not a fork: the redo's result reads
          //    `right + fixed / total` — the exam's ORIGINAL denominator (memory redo-only-what-was-missed).
          dispatch({ type: 'run/retryFrom', full: questions, wrong, originalTotal: result.total, originalWrong: result.total - result.right });
          dispatch({ type: 'scope/set', scope: 'selection', label: `${title} · missed`, blockId: null });
        }}
        onNewExam={onLeave}
      />
    );
  }

  if (submitting) {
    return (
      <div id="exam-submitting" className={LOADING_PANEL_CLASS}>
        <LoadingPanel
          idBase="exam-loading"
          title={<>Scoring your <span className="font-bold">exam</span></>}
          scope={`${counts.answered} of ${count} answered`}
          model=""
          onCancel={() => finishAbort.current?.abort()}
        />
      </div>
    );
  }

  if (!question) {
    return (
      <div id="exam-empty" className="mx-auto max-w-xl py-16 text-center">
        <p className="text-lg text-gray-300">This exam's questions are not in the open book.</p>
        <button type="button" className={`${BAR_GHOST} mt-6`} onClick={onLeave}>
          Back
        </button>
      </div>
    );
  }

  const isLast = index === count - 1;
  const answeredPct = count ? (counts.answered / count) * 100 : 0;

  return (
    <div id="exam-run" data-run={run.id}>
      {/* Header — the 390 px lesson (P1c): the right cluster holds only the short clock + Leave; the flag and
          the navigator sit in their own rows under the number, so "Question 12 of 65" never squeezes. */}
      <div className="flex justify-between items-start gap-3 mb-6 border-b border-gray-700 pb-4">
        <div className="min-w-0">
          <div id="exam-position" className="text-xl text-white font-light">
            Question{' '}
            <span className="font-bold text-brand-600" id="question-number-badge">{index + 1}</span>
            <span className="text-gray-400"> of {count}</span>
          </div>
          <p id="quiz-scope-label" className="mt-1 text-[0.75rem] uppercase tracking-widest text-gray-500 truncate">
            {title} · {counts.answered}/{count} answered
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              id="exam-flag-btn"
              type="button"
              aria-pressed={flagged}
              aria-label={flagged ? 'Unflag question' : 'Flag for review'}
              title={flagged ? 'Unflag' : 'Flag for review'}
              className={flagged ? FLAG_ON : FLAG_OFF}
              onClick={() => void toggleFlag()}
            >
              {/* lucide `flag` (ISC), inlined */}
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill={flagged ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M4 22V4a1 1 0 0 1 .4-.8A6 6 0 0 1 8 2c3 0 5 2 7.333 2q2 0 3.067-.8A1 1 0 0 1 20 4v10a1 1 0 0 1-.4.8A6 6 0 0 1 16 16c-3 0-5-2-8-2a6 6 0 0 0-4 1.528" />
              </svg>
            </button>
            <span id="exam-status" role="status" aria-live="polite" className="text-xs font-semibold uppercase tracking-wider text-gray-400">
              {status}
            </span>
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2 sm:flex-row sm:items-center sm:gap-4">
          <ExamTimer run={run} onExpire={onExpire} />
          <button
            id="exam-leave-btn"
            type="button"
            className="min-h-[44px] text-sm font-semibold text-gray-500 hover:text-brand-600 transition-colors uppercase tracking-wider"
            onClick={() => void leave()}
          >
            Leave
          </button>
        </div>
      </div>

      <ExamNavigator
        count={count}
        current={index}
        answered={counts.answered}
        flagged={counts.flagged}
        defaultOpen={typeof window !== 'undefined' && window.matchMedia?.('(min-width: 1024px)').matches}
        statusOf={(i) => {
          const k = keyOf(questions[i]);
          return { answered: isComplete(questions[i], run.answers[k]), flagged: run.flags.includes(k) };
        }}
        onJump={go}
      />

      <div id="question-asset" />
      <h3 id="question-text" className="text-xl text-white mb-8 leading-relaxed font-medium">
        <RichTextViewer content={question.question} />
      </h3>
      {correctSet && (
        <p id="exam-choose" className="-mt-5 mb-6 text-sm font-semibold uppercase tracking-widest text-gray-400">
          Choose {choose} · {picked.length} selected
        </p>
      )}

      <div
        id="options-container"
        role="group"
        aria-labelledby="question-text"
        className={
          (question.options?.length ?? 0) >= 5
            ? 'grid grid-cols-1 gap-1.5 mb-4'
            : 'grid grid-cols-1 gap-1.5 mb-4'
        }
      >
        {(question.options ?? []).map((text, option) => (
          <OptionCard
            key={`${key}-${option}`}
            index={option}
            selected={picked.includes(option)}
            reveal={null}
            disabled={submitting}
            onSelect={() => pick(option)}
          >
            <RichTextViewer content={text} />
          </OptionCard>
        ))}
      </div>

      {/* ⛔ B6 — inside #quiz-screen, never a portal. Always shown in an exam (Back / Next / Submit). */}
      <div id="action-container" className="glass-bar fixed inset-x-0 bottom-1.5 z-40">
        <div className="action-bar-inner mx-auto flex w-full items-center justify-between gap-3 px-4 py-3">
          <p id="next-hint" className="hidden min-w-0 truncate text-xs font-semibold uppercase tracking-widest text-gray-500 sm:block">
            {`Question ${index + 1} of ${count}`}
            {counts.unanswered ? ` · ${counts.unanswered} unanswered` : ''}
          </p>
          <div className="ml-auto flex items-center gap-2">
            <button id="exam-prev-btn" type="button" className={BAR_GHOST} disabled={index === 0} onClick={() => go(index - 1)} aria-label="Previous question">
              Back
            </button>
            {!isLast && (
              <button id="exam-next-btn" type="button" className={BAR_GHOST} onClick={() => go(index + 1)} aria-label="Next question">
                Next
              </button>
            )}
            <button id="exam-submit-btn" type="button" className={BAR_PRIMARY} disabled={submitting} onClick={() => void submit()}>
              {submitting ? 'Submitting' : 'Submit'}
            </button>
          </div>
        </div>
      </div>

      {/* Answered share, not position: an exam is not walked front to back. */}
      <div id="progress-container" className="fixed bottom-0 left-0 w-full h-1.5 bg-gray-800 z-50">
        <div id="progress-bar" className="h-full bg-brand-600 motion-safe:transition-all motion-safe:duration-500 ease-out" style={{ width: `${answeredPct}%` }} />
      </div>
    </div>
  );
}
