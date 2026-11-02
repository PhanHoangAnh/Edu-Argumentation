// exam-recall-suite P2 (22-10-26) — the Account page's "Progress" section: mastery per area + Next up
// (D) and the answer History with Retry wrong (C). For the OPEN book (the one Practice uses); the Book
// select switches the open book, exactly like picking it in the library.
//
// Runs started here are ordinary quiz runs (state/quizReducer) on the open book's bank:
//   · Practice an area → that area's questions, shuffled, capped to the book's session size.
//   · Retry wrong → only that past run's missed questions; the result keeps the run's ORIGINAL
//     denominator (run/retryFrom, memory redo-only-what-was-missed).
// ⛔ Class strings are complete literals (Tailwind purge).
import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useBookContext } from '../state/BookProvider';
import { useQuiz } from '../state/QuizProvider';
import { SESSION_SIZE, useHistory, useMastery, useModules, usePrefs } from '../data/queries';
import type { HistoryFilter, HistoryItem, HistoryPage, MasteryArea, QuizQuestion, StoredQuestionBody } from '../data/types';
import { LoadingPanel } from '../shell/LoadingPanel';
import { showNotice } from '../shell/dialog';
import { BODY_MUTED, CAPTION, SECTION_TITLE } from '../shell/ui';
import { HistoryList } from './HistoryList';
import { MasteryBars } from './MasteryBars';

// ---------------------------------------------------------------- run builders (pure; also used by Practice)

/** The chapter a bank question belongs to: `source.chapter`, else the `chNN` of its block / key. */
function chapterOf(question: QuizQuestion): number | null {
  const c = Number(question?.source?.chapter);
  if (Number.isInteger(c)) return c;
  const m = /^ch(\d{1,3})-/.exec(question?.source?.block ?? question?.source?.question ?? '');
  return m ? Number(m[1]) : null;
}

/** Every bank question in an area (its chapters). */
export function areaQuestions(bank: QuizQuestion[], area: MasteryArea): QuizQuestion[] {
  const wanted = new Set(area.chapters);
  return bank.filter((question) => {
    const c = chapterOf(question);
    return c !== null && wanted.has(c);
  });
}

/** A practice draw for one area: shuffled (Fisher-Yates), at most `size` questions. */
export function drawForArea(bank: QuizQuestion[], area: MasteryArea, size: number): QuizQuestion[] {
  const pool = areaQuestions(bank, area).slice();
  for (let i = pool.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, Math.max(1, size));
}

/** A stored body (AI question) as a quiz question, keyed so grading / flagging find it again. */
function fromBody(key: string, body: StoredQuestionBody | null | undefined): QuizQuestion | null {
  if (!body || typeof body.question !== 'string' || !Array.isArray(body.options) || body.options.length < 2) return null;
  const correct = body.correct;
  const ok = Array.isArray(correct)
    ? correct.length >= 2 && correct.every((n) => Number.isInteger(n) && n >= 0 && n < body.options.length)
    : Number.isInteger(correct) && correct >= 0 && correct < body.options.length;
  return ok ? { question: body.question, options: body.options, correct, explanations: body.explanations ?? null, source: { question: key } } : null;
}

export interface RetryPlan {
  full: QuizQuestion[];
  wrong: QuizQuestion[];
  originalTotal: number;
  originalWrong: number;
  /** Missed questions that could not be rebuilt (they stay counted as wrong). */
  lost: number;
}

/**
 * A past run's retry, from the History items loaded so far. The DENOMINATOR comes from the server's
 * `runs[runId]` (every logged answer of the run), never from the rows on screen — a page can hold part
 * of a run.
 */
export function retryPlanFor(runId: string, items: HistoryItem[], runs: HistoryPage['runs'], bank: QuizQuestion[]): RetryPlan | null {
  const run = runs[runId];
  if (!run || run.answered <= 0) return null;
  const originalWrong = Math.max(0, run.answered - run.right);
  if (!originalWrong) return null;
  const byKey = new Map<string, QuizQuestion>();
  for (const q of bank) if (q?.source?.question) byKey.set(q.source.question, q);
  const seen = new Set<string>();
  const full: QuizQuestion[] = [];
  const wrong: QuizQuestion[] = [];
  for (const item of items) {
    if (item.runId !== runId || !item.question || seen.has(item.question)) continue;
    seen.add(item.question);
    const q = byKey.get(item.question) ?? fromBody(item.question, item.body);
    if (!q) continue;
    full.push(q);
    if (item.correct === false) wrong.push(q);
  }
  if (!wrong.length) return null;
  return { full, wrong, originalTotal: run.answered, originalWrong, lost: Math.max(0, originalWrong - wrong.length) };
}

// ---------------------------------------------------------------- the panel

interface LibraryBookLite { file: string; moduleId?: string; title: string }

const SELECT =
  'min-h-[44px] max-w-full rounded-lg border border-gray-600 bg-gray-900 px-3 text-sm text-gray-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600';

export function ProgressPanel({ open, onStartRun }: { open: boolean; onStartRun: () => void }) {
  const { moduleId, quizBank, data, activeBookFile, openBook, isLoading: bookLoading } = useBookContext();
  const { dispatch } = useQuiz();
  const queryClient = useQueryClient();
  const modules = useModules();
  const books = ((modules.data ?? []) as unknown as LibraryBookLite[]).filter((b) => b && b.file);
  const prefs = usePrefs(moduleId, open);
  const size = prefs.data?.sessionSize ?? SESSION_SIZE.fallback;

  const mastery = useMastery(moduleId, open);
  const [filter, setFilter] = useState<HistoryFilter>('all');
  const [areaId, setAreaId] = useState('');
  const areas = mastery.data?.areas ?? [];
  const area = areas.find((a) => a.id === areaId) ?? null;
  const areaParam = useMemo(
    () => (!area ? null : mastery.data?.kind === 'domain' ? { domain: area.id } : area.chapters.length ? { chapter: area.chapters[0] } : null),
    [area, mastery.data?.kind],
  );
  const history = useHistory(moduleId, filter, areaParam, open);
  const pages = history.data?.pages ?? [];
  const items = pages.flatMap((p) => p.items);
  const runs = Object.assign({}, ...pages.map((p) => p.runs)) as HistoryPage['runs'];
  const [retrying, setRetrying] = useState('');

  const title = (data?.title as string | undefined) || moduleId;
  const canPractice = (a: MasteryArea) => quizBank.length > 0 && areaQuestions(quizBank, a).length > 0;

  const practiceArea = (a: MasteryArea) => {
    const questions = drawForArea(quizBank, a, size);
    if (!questions.length) return;
    dispatch({ type: 'run/reset', questions });
    dispatch({ type: 'scope/set', scope: 'selection', label: a.name, blockId: null });
    onStartRun();
  };

  const retry = (runId: string) => {
    setRetrying(runId);
    const plan = retryPlanFor(runId, items, runs, quizBank);
    setRetrying('');
    if (!plan) {
      void showNotice({ title: 'Nothing to retry', body: 'These questions are not in the open book any more.' });
      return;
    }
    dispatch({ type: 'run/retryFrom', full: plan.full, wrong: plan.wrong, originalTotal: plan.originalTotal, originalWrong: plan.originalWrong });
    dispatch({ type: 'scope/set', scope: 'selection', label: 'Retry wrong', blockId: null });
    onStartRun();
  };

  const loading = bookLoading || mastery.isLoading;
  return (
    <section id="account-progress-panel" className="mt-8" aria-labelledby="progress-panel-title">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 id="progress-panel-title" className={SECTION_TITLE}>Progress</h3>
        {books.length > 1 && (
          <>
            <label htmlFor="progress-book" className="sr-only">Book</label>
            <select id="progress-book" className={SELECT} value={activeBookFile ?? ''} onChange={(e) => e.target.value && openBook(e.target.value)}>
              {!activeBookFile && <option value="">{title}</option>}
              {books.map((b) => (
                <option key={b.file} value={b.file}>{b.title}</option>
              ))}
            </select>
          </>
        )}
      </div>
      <p className={`${BODY_MUTED} mb-4`}>{title}: mastery per {mastery.data?.kind === 'domain' ? 'exam domain' : 'chapter'}, and every answer.</p>

      <div className="min-h-[8rem]">
        {loading ? (
          <div className="flex flex-col items-center justify-center text-center py-8" aria-busy="true">
            <LoadingPanel
              idBase="progress-loading"
              title="Loading progress"
              scope={title}
              model=""
              onCancel={() => void queryClient.cancelQueries({ queryKey: ['mastery', moduleId] })}
            />
          </div>
        ) : mastery.isError ? (
          <p className="text-sm text-red-300" role="alert">Could not load mastery.</p>
        ) : mastery.data ? (
          <MasteryBars data={mastery.data} onPractice={practiceArea} canPractice={canPractice} />
        ) : null}
      </div>

      <h4 className={`mt-8 mb-3 ${CAPTION}`}>History</h4>
      {history.isError ? (
        <p className="text-sm text-red-300" role="alert">Could not load history.</p>
      ) : history.isLoading ? (
        <p className="text-sm text-gray-400" aria-busy="true">Loading…</p>
      ) : (
        <HistoryList
          items={items}
          filter={filter}
          onFilter={setFilter}
          areas={areas.map((a) => ({ id: a.id, name: a.name }))}
          area={areaId}
          onArea={setAreaId}
          hasMore={Boolean(history.hasNextPage)}
          loadingMore={history.isFetchingNextPage}
          onLoadMore={() => void history.fetchNextPage()}
          onRetry={retry}
          canRetry={(runId) => {
            const r = runs[runId];
            return Boolean(r && r.answered > r.right) && items.some((i) => i.runId === runId && i.correct === false);
          }}
          retrying={retrying}
        />
      )}
    </section>
  );
}
