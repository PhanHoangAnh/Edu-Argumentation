// exam-recall-suite P3 (22-10-26) — E: the exam result, shown inside #quiz-screen once submitted.
//
// What it shows, and only what the server said:
//   · Raw `right / total (pct%)` — always.
//   · `Estimate 760 / 1000 · pass 700` + Pass / Below pass — ONLY when the server's result carries a
//     scaled number (book with `exam.passScaled`). Always labelled "Estimate", with a one-line note:
//     the real exam's raw→scaled mapping is not published (plan E7). Never computed here.
//   · One bar per area (exam domain, else chapter) — the MasteryBars pattern: the number is text, the
//     bar is decoration (aria-hidden), so colour/length is never the only cue.
//   · The missed questions (wrong or unanswered), and "Retry missed" — a run of ONLY those, whose
//     result keeps the exam's ORIGINAL denominator (memory redo-only-what-was-missed; the existing
//     run/retryFrom carry, not a fork).
// ⛔ Class strings are complete literals (Tailwind purge).
import type { QuizQuestion } from '../data/types';
import { CAPTION, OUTLINE_BTN, PRIMARY_BTN, SECTION_TITLE } from '../shell/ui';
import { pctOf } from './examMode';
import type { ExamResultData } from './examMode';

export interface ExamResultProps {
  result: ExamResultData;
  /** "Practice exam" or the blueprint's name. */
  title: string;
  /** The exam's questions by key, to print the missed ones. */
  byKey: Map<string, QuizQuestion>;
  onRetryMissed: () => void;
  onNewExam: () => void;
}

/** Plain text of a question for a one-line list (the reader renders rich text; a list does not need to). */
function plain(text: string | undefined): string {
  return String(text ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/[*_`#>$\\]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function ExamResult({ result, title, byKey, onRetryMissed, onNewExam }: ExamResultProps) {
  const unanswered = new Set(result.unanswered);
  const pct = pctOf(result.right, result.total);
  const missed = result.missed.length;
  const hasScaled = result.scaled !== null && Number.isFinite(result.scaled);
  const top = result.scale ? result.scale[1] : null;
  return (
    <section id="exam-result" aria-labelledby="exam-result-title" className="mx-auto w-full max-w-4xl space-y-8">
      <header>
        <p className={CAPTION}>{title}</p>
        <h2 id="exam-result-title" className="mt-1 text-3xl text-white font-light">Exam result</h2>
      </header>

      <div className="flex flex-wrap items-end gap-x-10 gap-y-4">
        <div>
          <p className={CAPTION}>Raw</p>
          <p id="exam-raw" className="text-4xl font-bold text-white tabular-nums">
            {result.right} / {result.total} <span className="text-2xl font-semibold text-gray-400">({pct}%)</span>
          </p>
        </div>
        {hasScaled && (
          <div id="exam-estimate">
            <p className={CAPTION}>Estimate</p>
            <p className="text-4xl font-bold text-white tabular-nums">
              {result.scaled}
              {top !== null && <span className="text-2xl font-semibold text-gray-400"> / {top}</span>}
            </p>
            <p className="mt-1 text-sm text-gray-300">
              {result.passScaled !== null && <>pass {result.passScaled}</>}
              {result.passed !== null && (
                <>
                  {result.passScaled !== null && ' · '}
                  <span id="exam-verdict" className={result.passed ? 'font-semibold text-green-400' : 'font-semibold text-amber-300'}>
                    {result.passed ? 'Pass' : 'Below pass'}
                  </span>
                </>
              )}
            </p>
          </div>
        )}
      </div>
      {hasScaled && (
        <p id="exam-estimate-note" className="-mt-4 text-xs text-gray-400">
          Estimate only — the real exam's scoring is not published.
        </p>
      )}

      {result.areas.length > 0 && (
        <div>
          <h3 className={SECTION_TITLE}>By area</h3>
          <ul id="exam-areas" className="mt-4 space-y-3" aria-label="Result per area">
            {result.areas.map((area) => {
              const areaPct = pctOf(area.right, area.total);
              return (
                <li key={area.id} data-area={area.id} className="grid grid-cols-[minmax(0,1fr)_auto] sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 text-sm">
                  <span className="min-w-0 break-words text-gray-200">{area.name}</span>
                  <span className="order-3 col-span-2 sm:order-none sm:col-span-1 relative h-2.5 rounded-full bg-gray-700 overflow-hidden" aria-hidden="true">
                    <span className="absolute inset-y-0 left-0 rounded-full bg-gray-300" style={{ width: `${Math.max(0, Math.min(100, areaPct))}%` }} />
                  </span>
                  <span className="tabular-nums whitespace-nowrap text-right">
                    <span className="font-semibold text-white">{areaPct}%</span>{' '}
                    <span className="ml-1 text-gray-400">{area.right}/{area.total}</span>
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <div>
        <h3 className={SECTION_TITLE}>Missed {missed > 0 && <span className="text-gray-400">({missed})</span>}</h3>
        {missed === 0 ? (
          <p className="mt-3 text-sm text-gray-400">None — every question right.</p>
        ) : (
          <ol id="exam-missed" className="mt-4 space-y-2">
            {result.missed.map((key) => {
              const question = byKey.get(key);
              const skipped = unanswered.has(key);
              return (
                <li key={key} data-key={key} className="flex items-start gap-3 rounded-lg border border-gray-700 px-3 py-2 text-sm">
                  <span className={skipped ? 'shrink-0 rounded border border-dashed border-gray-500 px-1.5 text-xs font-semibold uppercase tracking-wider text-gray-300' : 'shrink-0 rounded border border-brand-400 px-1.5 text-xs font-semibold uppercase tracking-wider text-brand-400'}>
                    {skipped ? 'Skipped' : 'Wrong'}
                  </span>
                  <span className="min-w-0 break-words text-gray-200 line-clamp-2">{question ? plain(question.question) : key}</span>
                </li>
              );
            })}
          </ol>
        )}
      </div>

      <div id="exam-result-actions" className="flex flex-col sm:flex-row sm:flex-wrap gap-3">
        {missed > 0 && (
          <button id="exam-retry-missed-btn" type="button" className={PRIMARY_BTN} onClick={onRetryMissed}>
            Retry missed ({missed})
          </button>
        )}
        <button id="exam-new-btn" type="button" className={missed > 0 ? OUTLINE_BTN : PRIMARY_BTN} onClick={onNewExam}>
          New exam
        </button>
      </div>
      {missed > 0 && <p className="-mt-5 text-xs text-gray-400">Only the missed ones; the score still counts all {result.total}.</p>}
    </section>
  );
}
