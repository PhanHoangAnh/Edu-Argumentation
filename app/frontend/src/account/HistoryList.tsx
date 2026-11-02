// exam-recall-suite P2 (22-10-26) — C: answer history, filters All / Wrong / Flagged + an area filter.
//
// Rows are grouped by RUN (one practice / review / retry), newest first. A run with a missed answer
// gets "Retry wrong": it redoes ONLY the missed questions and the result keeps the run's ORIGINAL
// denominator (memory redo-only-what-was-missed) — the carry lives in state/quizReducer (run/retryFrom).
// Right/wrong is a shape (tick / cross) AND words for a screen reader — never colour alone.
// ⛔ Class strings are complete literals (Tailwind purge).
import type { HistoryFilter, HistoryItem } from '../data/types';
import { OUTLINE_BTN } from '../shell/ui';

const FILTERS: { id: HistoryFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'wrong', label: 'Wrong' },
  { id: 'flagged', label: 'Flagged' },
];

const CHIP_ON =
  'min-h-[44px] px-4 rounded-lg border border-brand-600 bg-brand-600/15 text-white text-sm font-semibold uppercase tracking-wider transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600';
const CHIP_OFF =
  'min-h-[44px] px-4 rounded-lg border border-gray-600 text-gray-200 hover:border-brand-600 hover:text-white text-sm font-semibold uppercase tracking-wider transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600';
const SELECT =
  'min-h-[44px] max-w-full rounded-lg border border-gray-600 bg-gray-900 px-3 text-sm text-gray-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600';

const KIND: Record<string, string> = { quiz: 'AI quiz', practice: 'Practice', review: 'Review', exam: 'Exam', retry: 'Retry' };

function stamp(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, '0');
  // P2c (22-10-26): " · ", not a plain space — in this font a 12 px space is 2 px wide and
  // "22-10 08:00" read as "22-1008:00".
  return `${p(d.getDate())}-${p(d.getMonth() + 1)} · ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function Glyph({ correct }: { correct: boolean | null }) {
  if (correct === null) {
    return (
      <svg className="w-5 h-5 shrink-0 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
        <path d="M6 12h12" />
      </svg>
    );
  }
  return correct ? (
    <svg className="w-5 h-5 shrink-0 text-green-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  ) : (
    <svg className="w-5 h-5 shrink-0 text-red-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}

/**
 * Consecutive items of one run become one group (newest-first, so a run is contiguous). A legacy row
 * (pre-v5) and a flagged row each stand alone: they have no run to retry.
 */
function groupByRun(items: HistoryItem[]): { runId: string | null; items: HistoryItem[] }[] {
  const groups: { runId: string | null; items: HistoryItem[] }[] = [];
  for (const item of items) {
    const last = groups[groups.length - 1];
    if (last && last.runId === item.runId && item.runId) last.items.push(item);
    else groups.push({ runId: item.runId, items: [item] });
  }
  return groups;
}

export interface HistoryListProps {
  items: HistoryItem[];
  filter: HistoryFilter;
  onFilter: (next: HistoryFilter) => void;
  /** Area filter options: '' = all areas. */
  areas: { id: string; name: string }[];
  area: string;
  onArea: (next: string) => void;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  /** Start a retry of this run's missed questions. */
  onRetry: (runId: string) => void;
  /** True when the run has a miss AND its questions can be rebuilt from this book. */
  canRetry: (runId: string) => boolean;
  /** The run being prepared for retry ('' = none), so its button reads busy. */
  retrying: string;
}

export function HistoryList(props: HistoryListProps) {
  const { items, filter, onFilter, areas, area, onArea, hasMore, loadingMore, onLoadMore, onRetry, canRetry, retrying } = props;
  const groups = groupByRun(items);
  const empty =
    filter === 'wrong' ? 'No wrong answers here.' : filter === 'flagged' ? 'No flagged questions answered here.' : 'No answers yet.';
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label="Show" className="flex flex-wrap gap-2">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              id={`history-filter-${f.id}`}
              type="button"
              aria-pressed={filter === f.id}
              className={filter === f.id ? CHIP_ON : CHIP_OFF}
              onClick={() => onFilter(f.id)}
            >
              {f.label}
            </button>
          ))}
        </div>
        {areas.length > 1 && (
          <>
            <label htmlFor="history-area" className="sr-only">Area</label>
            <select id="history-area" className={SELECT} value={area} onChange={(e) => onArea(e.target.value)}>
              <option value="">All areas</option>
              {areas.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </>
        )}
      </div>

      {!items.length ? (
        <p id="history-empty" className="mt-4 text-sm text-gray-400">{empty}</p>
      ) : (
        <ol id="history-list" className="mt-4 space-y-4">
          {groups.map((group, gi) => {
            const first = group.items[0];
            const runId = group.runId;
            const kind = first.source === 'legacy' ? 'Earlier' : first.source === 'flag' ? 'Flagged' : KIND[first.runKind ?? ''] ?? first.runKind ?? '';
            return (
              <li key={`${runId ?? first.id}-${gi}`} className="rounded-lg border border-gray-700" data-run={runId ?? undefined}>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2 border-b border-gray-700">
                  <span className="text-xs uppercase tracking-wider text-gray-400">{kind}</span>
                  <span className="text-xs tabular-nums text-gray-400">{stamp(first.at)}</span>
                  {runId && canRetry(runId) && (
                    <button
                      type="button"
                      className={`${OUTLINE_BTN} ml-auto`}
                      data-retry-run={runId}
                      disabled={retrying === runId}
                      aria-busy={retrying === runId ? 'true' : 'false'}
                      onClick={() => onRetry(runId)}
                    >
                      {retrying === runId ? 'Loading…' : 'Retry wrong'}
                    </button>
                  )}
                </div>
                <ul className="divide-y divide-gray-700/60">
                  {group.items.map((item, ii) => (
                    <li key={`${item.id}-${ii}`} className="flex items-center gap-3 px-3 py-2 text-sm" data-correct={item.correct === null ? 'none' : item.correct ? 'true' : 'false'}>
                      <Glyph correct={item.correct} />
                      <span className="sr-only">{item.correct === null ? 'Not answered:' : item.correct ? 'Right:' : 'Wrong:'}</span>
                      <span className={`min-w-0 text-gray-200 ${item.question ? 'break-all font-mono' : 'break-words'}`}>{item.label}</span>
                      <span className="ml-auto shrink-0 tabular-nums text-xs text-gray-400">{stamp(item.at)}</span>
                    </li>
                  ))}
                </ul>
              </li>
            );
          })}
        </ol>
      )}

      {hasMore && (
        <button id="history-more-btn" type="button" className={`mt-4 ${OUTLINE_BTN}`} disabled={loadingMore} aria-busy={loadingMore ? 'true' : 'false'} onClick={onLoadMore}>
          {loadingMore ? 'Loading…' : 'Show more'}
        </button>
      )}
    </div>
  );
}
