// exam-recall-suite P1 (22-10-26) — A1 review stats + A5 leeches + D2 new-card cap, in the
// Practice dialog as ONE collapsed row ("Stats"), so the dialog does not grow until he opens it.
//
// Native <details>/<summary>: keyboard + screen-reader disclosure for free, no state to keep.
// The 7-day bars are decoration (aria-hidden); the same numbers are in a screen-reader line and in
// each bar's title, so nothing is only visible as a shape.
// A failed /api/review/stats read hides the numbers but keeps the New / day stepper.
// ⛔ Class strings are complete literals (Tailwind purge).
import { useReviewStats, NEW_PER_DAY } from '../data/queries';
import { SizePicker } from './SizePicker';

const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export interface ReviewStatsProps {
  moduleId: string;
  /** The Practice dialog is open — fetch only then. */
  open: boolean;
  newPerDay: number;
  onNewPerDay: (next: number) => void;
}

export function ReviewStats({ moduleId, open, newPerDay, onNewPerDay }: ReviewStatsProps) {
  const stats = useReviewStats(moduleId, open);
  const data = stats.data;
  const week = data?.next7 ?? [];
  const weekTotal = week.reduce((sum, n) => sum + n, 0);
  const peak = Math.max(1, ...week);
  const today = new Date().getDay();
  const dayName = (offset: number) => DAY[(today + offset + 1) % 7];
  const retention = data?.retention ?? null;

  return (
    <details id="review-stats" className="mt-4 rounded-lg border border-gray-700 group">
      <summary className="min-h-[44px] px-4 flex items-center gap-2 cursor-pointer select-none rounded-lg text-sm font-semibold uppercase tracking-wider text-gray-200 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 [&::-webkit-details-marker]:hidden list-none">
        <svg className="w-4 h-4 transition-transform motion-reduce:transition-none group-open:rotate-90" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="m9 18 6-6-6-6" />
        </svg>
        Stats
        {data && <span className="ml-auto text-xs font-normal normal-case tracking-normal text-gray-400">{data.dueToday} due today</span>}
      </summary>
      <div className="px-4 pb-4 pt-1 space-y-3">
        {stats.isLoading && <p className="text-sm text-gray-400">Loading…</p>}
        {stats.isError && <p className="text-sm text-gray-400">Stats unavailable right now.</p>}
        {data && (
          <>
            <div className="flex flex-wrap items-end gap-x-6 gap-y-3 text-sm text-gray-300">
              <p>
                Due today <span id="stats-due-today" className="font-bold text-white tabular-nums">{data.dueToday}</span>
              </p>
              <div className="flex items-end gap-2">
                <span>Next 7 days</span>
                <div className="flex items-end gap-1 h-8" aria-hidden="true">
                  {week.map((n, i) => (
                    <div
                      key={i}
                      title={`${dayName(i)}: ${n}`}
                      className="w-2.5 rounded-sm bg-brand-600"
                      style={{ height: `${n ? Math.max(12, (n / peak) * 100) : 6}%`, opacity: n ? 1 : 0.35 }}
                    />
                  ))}
                </div>
                <span id="stats-next7" className="font-bold text-white tabular-nums">{weekTotal}</span>
                <span className="sr-only">{week.map((n, i) => `${dayName(i)} ${n}`).join(', ')}</span>
              </div>
            </div>
            <p className="text-sm text-gray-300">
              Retention{' '}
              <span id="stats-retention" className="font-bold text-white tabular-nums">{retention === null ? '—' : `${retention}%`}</span>{' '}
              <span className="text-gray-400">(30 d)</span> · Cards{' '}
              <span id="stats-total" className="font-bold text-white tabular-nums">{data.total}</span> · Leeches{' '}
              <span id="stats-leeches" className="font-bold text-white tabular-nums">{data.leeches}</span>
            </p>
            {data.leeches > 0 && <p className="text-xs text-gray-400">Leech = missed 6+ times. Still scheduled.</p>}
          </>
        )}
        <SizePicker
          id="new-per-day"
          label="New / day"
          unit="new cards per day"
          value={newPerDay}
          min={NEW_PER_DAY.min}
          max={NEW_PER_DAY.max}
          step={NEW_PER_DAY.step}
          onChange={onNewPerDay}
        />
      </div>
    </details>
  );
}
