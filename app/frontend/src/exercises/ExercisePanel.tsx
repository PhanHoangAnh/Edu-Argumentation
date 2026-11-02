// Seam 18 (exercises), part 3 — THE PANEL. Phase 04: renderExercises, fully ported.
//
// PORTED FROM (by symbol, app.js): renderExercises, submitWrittenExercises, syncChooseProgress,
// refreshWriteRetry, finishExercises, recordExerciseResult, exerciseVerdictNote,
// EXERCISE_VERDICT_STYLE, EXERCISE_ACTION_BASE/_PRIMARY/_SECONDARY.
//
// ⚑ PHASE 04 (23-09-26). The Phase-03 panel had bare, unstyled buttons, no status line, no
//   verdict notes, "Retry the wrong ones" always visible, a disabled Submit, and — in BOTH
//   modes — no completion write, so finishing a chapter's exercises never ticked the block.
//
// ⚑ THE A1b DELTA IS KEPT: the three controls dispatch on ./exerciseReducer and the re-render is
//   scoped to this panel instead of rebuilding the whole theory block. Drafts persist to
//   localStorage (`eduExercises.<moduleId>.<blockId>`) — the SAME key the legacy uses, so a draft
//   typed on :8767 is there on :8792.
//
// ⛔ ONE RULE FOR BOTH MODES: everything right ticks the block, exactly like a perfect
//    assessment. The server re-checks score === total, so the page cannot claim a block it did
//    not pass. Against the FULL list, never the narrowed retry list (`carry`).
import { useEffect, useReducer, useRef, useState } from 'react';
import { RichTextViewer } from '../reader/RichTextViewer';
import { OptionCard } from '../quiz/OptionCard';
import {
  emptyExerciseState,
  exerciseReducer,
  exerciseStoreKey,
  readExerciseState,
  writeExerciseState,
} from './exerciseReducer';
import type { ExerciseState, ExerciseVerdict } from './exerciseReducer';
import type { ExerciseSpec } from './exerciseSpec';
import { useBookContext } from '../state/BookProvider';
import { useProgressContext } from '../state/ProgressProvider';
import { useProviderReadiness } from '../data/queries';
import { generationToken, postJson, recordWrongAnswer } from '../data/writes';
import type { ProgressBody } from '../data/writes';

export interface ExercisePanelProps {
  spec: ExerciseSpec;
  /** ch01-b08 — the block this panel's answers are stored under and completes. */
  blockId?: string;
  /** shell/useStudyActions.recordProgress — the one completion write. */
  recordProgress?: (body: ProgressBody) => Promise<{ failed: boolean; marked: boolean }>;
}

const EXERCISE_VERDICT_STYLE: Record<string, [string, string]> = {
  correct: ['✓ Correct', 'border-green-500/50 bg-green-500/10 text-green-300'],
  partial: ['~ Partly right', 'border-amber-500/50 bg-amber-500/10 text-amber-300'],
  incorrect: ['✗ Not right', 'border-red-500/50 bg-red-500/10 text-red-300'],
  unmarked: ['? Not marked', 'border-gray-600 bg-gray-800 text-gray-300'],
};

// One geometry, two colours: emphasis comes from fill, not size (user, 21-09-26).
const EXERCISE_ACTION_BASE =
  'min-h-[44px] rounded-lg border-2 px-6 py-2 text-sm font-semibold uppercase tracking-wider transition-colors';
const EXERCISE_ACTION_PRIMARY = `${EXERCISE_ACTION_BASE} border-brand-600 bg-brand-600 text-white hover:bg-brand-900`;
const EXERCISE_ACTION_SECONDARY = `${EXERCISE_ACTION_BASE} border-gray-500 text-gray-300 hover:border-gray-400 hover:bg-gray-700 hover:text-white`;

interface Status {
  className: string;
  text: string;
}
const STATUS_BASE = 'mb-4 text-sm min-h-[1.25rem]';

function VerdictNote({ verdict }: { verdict: ExerciseVerdict }) {
  const [label, classes] = EXERCISE_VERDICT_STYLE[verdict.verdict] || EXERCISE_VERDICT_STYLE.unmarked;
  return (
    <div className={`mt-3 rounded-lg border px-3 py-2 text-sm ${classes}`}>
      <span className="font-semibold">{label}</span>
      {verdict.feedback ? (
        <div className="mt-1 leading-relaxed text-gray-200">
          <RichTextViewer content={verdict.feedback} />
        </div>
      ) : null}
    </div>
  );
}

export function ExercisePanel({ spec, blockId = '', recordProgress }: ExercisePanelProps) {
  const { moduleId, activeBookFile, chapters } = useBookContext();
  const { chapterProgress, isBlockComplete } = useProgressContext();
  const provider = useProviderReadiness();
  const storeKey = exerciseStoreKey(moduleId, blockId);
  const [state, dispatch] = useReducer(exerciseReducer, emptyExerciseState, () => readExerciseState(storeKey));
  const [status, setStatus] = useState<Status>({ className: STATUS_BASE, text: '' });
  const [busy, setBusy] = useState(false);
  const chapterIndex = Math.max(0, Number(blockId.slice(2, 4)) - 1);
  const blockIndex = Math.max(0, Number(blockId.slice(6, 8)) - 1);

  // ⛔ localStorage, never the server — drafts only. The completion is the one server write.
  useEffect(() => {
    writeExerciseState(storeKey, state);
  }, [storeKey, state]);

  const hasChoices = spec.list.every(
    (entry) => Array.isArray(entry.options) && entry.options.length > 1 && Number.isInteger(entry.correct),
  );
  const mode = state.mode === 'choose' && !hasChoices ? 'write' : state.mode;
  const isRight = (s: ExerciseState, n: number) => s.verdicts[n]?.verdict === 'correct';
  const full = spec.list;
  const retryOnly = state.retryOnly && full.some((e) => isRight(state, e.n)) && full.some((e) => !isRight(state, e.n));
  const list = retryOnly ? full.filter((entry) => !isRight(state, entry.n)) : full;
  const carry = { hidden: full.length - list.length, total: full.length };
  const wrongShown = list.filter((row) => state.verdicts[row.n] && state.verdicts[row.n].verdict !== 'correct').length;

  /** recordExerciseResult (app.js:2855). */
  const recordResult = async (correct: number, total: number, source: string, base: Status) => {
    if (!recordProgress) return;
    const wasComplete = isBlockComplete(chapterIndex, blockIndex);
    const outcome = await recordProgress({ module: moduleId, block: blockId, score: correct, total, source });
    if (outcome.failed) {
      setStatus({ ...base, text: `${base.text} Could not save just now — it will be saved on the next page load.` });
      return;
    }
    if (outcome.marked) {
      // chapterProgress reads the cache the write just refreshed; the next render has the tick.
      const chapter = chapters[chapterIndex];
      const p = chapterProgress(chapterIndex);
      // `p` is the PRE-write snapshot this closure captured: count the tick only if it is new.
      const done = p.done + (wasComplete ? 0 : 1);
      const percent = p.total ? Math.round((done / p.total) * 100) : 0;
      setStatus({
        ...base,
        text: `${base.text} ✓ Block complete — ${(chapter && chapter.title) || 'this chapter'} is now ${percent}% (${done} of ${p.total}).`,
      });
    }
  };

  /** finishExercises (app.js:2842). */
  const finish = (correct: number, total: number, source: 'exercise' | 'exercise-mcq') => {
    if (correct === total) {
      const base = { className: 'mb-4 text-sm text-green-400 font-semibold', text: `${correct} of ${total} — all correct.` };
      setStatus(base);
      void recordResult(correct, total, source, base);
      return;
    }
    setStatus({
      className: 'mb-4 text-sm text-amber-400',
      text:
        source === 'exercise-mcq'
          ? `${correct} of ${total} correct. Retry the wrong ones — the block ticks at ${total} of ${total}.`
          : `${correct} of ${total} correct. Fix the ones marked below and submit again — the block ticks at ${total} of ${total}.`,
    });
  };

  /** syncChooseProgress (app.js:2733). `silent` = restoring a finished set on load: say so, do
   *  not re-post (the completion was recorded when the last answer was clicked). */
  const syncChoose = (next: ExerciseState, silent: boolean) => {
    const marked = list.filter((r) => next.verdicts[r.n]);
    const correct = marked.filter((r) => next.verdicts[r.n].verdict === 'correct').length;
    const tally = correct + carry.hidden;
    if (marked.length < list.length) {
      setStatus({ className: 'mb-4 text-sm text-gray-400', text: `${marked.length} of ${list.length} answered · ${tally} of ${carry.total} correct` });
      return;
    }
    if (silent && tally === carry.total) {
      setStatus({ className: 'mb-4 text-sm text-green-400 font-semibold', text: `${tally} of ${carry.total} — all correct.` });
      return;
    }
    finish(tally, carry.total, 'exercise-mcq');
  };

  // renderExercises' tail (app.js:2717): choose mode paints its tally on every (re)render of
  // the panel — i.e. on mount, on a mode switch, on retry and on clear.
  const renderSig = `${storeKey}|${mode}|${retryOnly}|${list.length}`;
  const lastSig = useRef('');
  useEffect(() => {
    if (lastSig.current === renderSig) return;
    lastSig.current = renderSig;
    if (mode === 'choose') syncChoose(state, true);
    else setStatus({ className: STATUS_BASE, text: '' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [renderSig]);

  /** submitWrittenExercises (app.js:2767). */
  const submitWritten = async () => {
    if (busy) return;
    const blank = list.filter((r) => !(state.answers[r.n] || '').trim());
    if (blank.length === list.length) {
      setStatus({ className: 'mb-4 text-sm text-amber-400', text: 'Write an answer first.' });
      return;
    }
    const token = await generationToken(provider.tokenRequired);
    if (token === null) return;
    setBusy(true);
    setStatus({
      className: 'mb-4 text-sm text-gray-400',
      text: blank.length ? `Marking ${list.length} answers (${blank.length} left blank)…` : `Marking ${list.length} answers…`,
    });
    const send = () =>
      postJson(
        '/api/exercise/grade',
        {
          module: activeBookFile,
          chapter: chapterIndex + 1,
          block: blockIndex + 1,
          answers: list.map((r) => ({ n: r.n, question: r.prompt, answer: state.answers[r.n] || '' })),
        },
        { 'X-Edu-Quiz-Token': token || '' },
      );
    try {
      let response: Response;
      try {
        response = await send();
      } catch {
        // Same spiky link as the tutor: try once more before reporting a failure.
        setStatus({ className: 'mb-4 text-sm text-gray-400', text: 'Connection dropped, retrying…' });
        await new Promise((done) => setTimeout(done, 1500));
        response = await send();
      }
      const data = (await response.json().catch(() => ({}))) as {
        results?: { n: number; verdict: ExerciseVerdict['verdict']; feedback: string }[];
        error?: string;
      };
      if (!response.ok) throw new Error(data.error || `Error ${response.status}`);
      const byNumber = new Map((data.results || []).map((r) => [r.n, r]));
      const verdicts: Record<string, ExerciseVerdict> = {};
      let correct = 0;
      list.forEach((entry) => {
        const result = byNumber.get(entry.n) || { verdict: 'unmarked' as const, feedback: '' };
        if (result.verdict === 'correct') correct += 1;
        verdicts[entry.n] = { verdict: result.verdict, feedback: result.feedback };
      });
      dispatch({ type: 'verdicts/apply', verdicts });
      finish(correct + carry.hidden, carry.total, 'exercise');
    } catch (error) {
      setStatus({
        className: 'mb-4 text-sm text-red-400',
        text: `${(error as Error).message || 'Marking failed.'} Your answers are saved — try again, or switch to multiple choice.`,
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="my-6 rounded-xl border border-brand-600/40 bg-brand-600/5 p-5" data-exercise-panel="true">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <h3 className="text-lg font-semibold text-brand-400">{spec.title || `${spec.list.length} book exercises`}</h3>
        <div className="inline-flex rounded-lg border border-gray-600 overflow-hidden">
          {(['write', 'choose'] as const).map((value) => {
            const active = mode === value;
            const off = value === 'choose' && !hasChoices;
            return (
              <button
                key={value}
                type="button"
                disabled={off}
                title={off ? 'This module has no multiple-choice options for its exercises yet.' : undefined}
                className={`min-h-[44px] px-4 text-xs font-semibold uppercase tracking-wider transition-colors ${
                  active ? 'bg-brand-600 text-white' : 'bg-transparent text-gray-300 hover:bg-gray-700 hover:text-white'
                }${off ? ' opacity-40 cursor-not-allowed' : ''}`}
                onClick={() => {
                  if (off || mode === value) return;
                  dispatch({ type: 'mode/set', mode: value });
                }}
              >
                {value === 'write' ? 'Write answers' : 'Multiple choice'}
              </button>
            );
          })}
        </div>
      </div>

      <p className="mb-5 text-sm text-gray-400 leading-relaxed">
        {mode === 'write'
          ? "Answer in your own words — you are marked on the meaning, not on matching the book's wording. Answer all of them, then submit once."
          : 'Pick an answer and it is marked straight away. Nothing is sent anywhere, so this works even with the AI quota spent.'}
      </p>

      {retryOnly && (
        <p className="mb-4 text-sm font-semibold text-brand-400">
          {`Retrying ${list.length} of ${carry.total} — ${carry.hidden} already correct and hidden. ${mode === 'write' ? 'Clear' : 'Start over'} brings them all back.`}
        </p>
      )}

      <p className={status.className}>{status.text}</p>

      {list.map((entry) => (
        <div key={entry.n} className="mb-6 border-t border-gray-700/60 pt-5 first:border-t-0 first:pt-0" data-exercise-row={String(entry.n)}>
          <div className="font-medium leading-relaxed [overflow-wrap:anywhere]">
            <RichTextViewer content={entry.prompt} />
          </div>

          {mode === 'write' ? (
            <textarea
              className="mt-3 w-full rounded-lg border border-gray-600 bg-gray-900/70 p-3 text-sm leading-relaxed text-white placeholder-gray-500 focus:border-brand-600 focus:outline-none"
              rows={3}
              placeholder="Your answer…"
              maxLength={1500}
              value={state.answers[entry.n] ?? ''}
              onChange={(event) => dispatch({ type: 'answer/write', n: entry.n, text: event.target.value })}
            />
          ) : (
            <div className="mt-4 space-y-3">
              {(entry.options ?? []).map((text, index) => (
                <OptionCard
                  key={index}
                  index={index}
                  selected={state.picks[entry.n] === index}
                  reveal={state.verdicts[entry.n] ? (index === entry.correct ? 'correct' : 'incorrect') : null}
                  explanation={entry.explanations?.[index]}
                  disabled={Boolean(state.verdicts[entry.n])}
                  onSelect={() => {
                    if (state.verdicts[entry.n]) return;   // already answered; the quiz locks too
                    const correct = index === entry.correct;
                    // ⚑ Phase 06a (ruling R25): a wrong multiple-choice pick is recorded, full text.
                    if (!correct && Array.isArray(entry.options) && Number.isInteger(entry.correct)) {
                      recordWrongAnswer({
                        module: moduleId,
                        block: blockId,
                        kind: 'exercise',
                        question: entry.prompt,
                        options: entry.options,
                        chosen: index,
                        correct: entry.correct as number,
                      });
                    }
                    const next = exerciseReducer(state, { type: 'answer/pick', n: entry.n, index, correct });
                    dispatch({ type: 'answer/pick', n: entry.n, index, correct });
                    syncChoose(next, false);
                  }}
                >
                  <RichTextViewer content={text} />
                </OptionCard>
              ))}
            </div>
          )}

          <div>{mode === 'write' && state.verdicts[entry.n] ? <VerdictNote verdict={state.verdicts[entry.n]} /> : null}</div>
        </div>
      ))}

      <div className="flex flex-wrap items-center gap-3 border-t border-gray-700/60 pt-5">
        {mode === 'write' && (
          <button
            type="button"
            className={`${EXERCISE_ACTION_PRIMARY}${busy ? ' opacity-60' : ''}`}
            disabled={busy}
            onClick={() => void submitWritten()}
          >
            Submit for marking
          </button>
        )}
        <button
          type="button"
          className={`${EXERCISE_ACTION_PRIMARY}${wrongShown === 0 ? ' hidden-view' : ''}`}
          onClick={() => dispatch({ type: 'retry/wrongOnly' })}
        >
          Retry the wrong ones
        </button>
        <button type="button" className={EXERCISE_ACTION_SECONDARY} onClick={() => dispatch({ type: 'answers/clear' })}>
          {mode === 'write' ? 'Clear' : 'Start over'}
        </button>
      </div>
    </section>
  );
}
