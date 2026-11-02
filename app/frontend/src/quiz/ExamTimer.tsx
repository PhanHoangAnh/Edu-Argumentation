// exam-recall-suite P3 (22-10-26) — E: the exam countdown.
//
// ⛔ Driven by the SERVER deadline (ExamRun.deadlineAt + clockOffsetMs) — this component keeps no
//    clock of its own: every tick recomputes "deadline − now". A reload, a sleeping laptop or a
//    throttled background tab therefore shows the right time the moment it paints again.
// a11y: the visible clock is `role="timer"` (implicitly NOT live — a screen reader is not read a
//   number every second). A separate polite status line speaks ONLY at 5 min and 1 min left.
//   Low time is said in text ("Low"), not by colour alone. No animation runs under
//   prefers-reduced-motion (`motion-safe:` only).
// ⛔ Class strings are complete literals (Tailwind purge).
import { useEffect, useRef, useState } from 'react';
import { crossedThreshold, formatClock, remainingMs, spokenClock } from './examMode';
import type { ExamRun } from './examMode';

export interface ExamTimerProps {
  run: Pick<ExamRun, 'deadlineAt' | 'clockOffsetMs'>;
  /** Called once when the clock reaches 0 (the screen submits). */
  onExpire: () => void;
}

export function ExamTimer({ run, onExpire }: ExamTimerProps) {
  const [left, setLeft] = useState(() => remainingMs(run));
  const [announce, setAnnounce] = useState('');
  const prev = useRef(left);
  const expired = useRef(left <= 0);
  const expireRef = useRef(onExpire);
  expireRef.current = onExpire;

  useEffect(() => {
    const tick = () => {
      const next = remainingMs(run);
      const said = crossedThreshold(prev.current, next);
      if (said) setAnnounce(said);
      prev.current = next;
      setLeft(next);
      if (next <= 0 && !expired.current) {
        expired.current = true;
        setAnnounce('Time is up. Submitting.');
        expireRef.current();
      }
    };
    tick();
    // 1 s is enough for a m:ss display; the value is recomputed from the deadline, so a late tick never drifts.
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [run.deadlineAt, run.clockOffsetMs]); // eslint-disable-line react-hooks/exhaustive-deps

  const low = left <= 5 * 60_000;
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <span
        id="exam-timer"
        role="timer"
        aria-label={spokenClock(left)}
        data-low={low ? 'true' : undefined}
        className={
          low
            ? 'inline-flex items-center gap-1 rounded-md border border-amber-400 px-2 py-1 text-base font-bold tabular-nums text-amber-300 motion-safe:transition-colors'
            : 'inline-flex items-center gap-1 rounded-md border border-gray-600 px-2 py-1 text-base font-bold tabular-nums text-white motion-safe:transition-colors'
        }
      >
        {/* lucide `timer` (ISC), inlined */}
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <line x1="10" x2="14" y1="2" y2="2" />
          <line x1="12" x2="15" y1="14" y2="11" />
          <circle cx="12" cy="14" r="8" />
        </svg>
        <span aria-hidden="true">{formatClock(left)}</span>
        {low && <span aria-hidden="true" className="text-[0.65rem] font-semibold uppercase tracking-wider">Low</span>}
      </span>
      <span id="exam-timer-status" role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {announce}
      </span>
    </span>
  );
}
