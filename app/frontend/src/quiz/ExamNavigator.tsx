// exam-recall-suite P3 (22-10-26) — E: the exam's question navigator.
//
// One numbered 44px chip per question; a press jumps there. State is told by SHAPE + TEXT, never by
// colour alone (WCAG 1.4.1):
//   answered   = solid filled chip
//   unanswered = dashed outline
//   flagged    = a flag glyph in the corner (any state)
//   current    = a thick ring + aria-current="step"
// Every chip's accessible name says it in words ("Question 3, answered, flagged"), and a one-line
// legend repeats the shapes. The chips wrap (no horizontal scroll at 390 px); the panel is a
// disclosure so 65 chips do not push the question below the fold on a phone.
// Keyboard: native buttons (Tab / Enter / Space); Arrow keys + Home / End move between chips.
// ⛔ Class strings are complete literals (Tailwind purge).
import { useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';

export interface NavStatus {
  answered: boolean;
  flagged: boolean;
}

export interface ExamNavigatorProps {
  count: number;
  current: number;
  statusOf: (index: number) => NavStatus;
  onJump: (index: number) => void;
  answered: number;
  flagged: number;
  /** Open on first render (wide screens). */
  defaultOpen?: boolean;
}

const CHIP_BASE =
  'relative min-h-[44px] min-w-[44px] rounded-lg text-sm font-bold tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white';
const CHIP_ANSWERED = `${CHIP_BASE} bg-gray-200 text-gray-900 border-2 border-gray-200 hover:bg-white`;
const CHIP_OPEN = `${CHIP_BASE} border-2 border-dashed border-gray-500 text-gray-300 hover:border-brand-600 hover:text-white`;
const CURRENT_RING = 'ring-2 ring-brand-600 ring-offset-2 ring-offset-gray-900';

function FlagGlyph({ className }: { className: string }) {
  // lucide `flag` (ISC), inlined — same path as FlagButton.
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 22V4a1 1 0 0 1 .4-.8A6 6 0 0 1 8 2c3 0 5 2 7.333 2q2 0 3.067-.8A1 1 0 0 1 20 4v10a1 1 0 0 1-.4.8A6 6 0 0 1 16 16c-3 0-5-2-8-2a6 6 0 0 0-4 1.528" />
    </svg>
  );
}

export function ExamNavigator({ count, current, statusOf, onJump, answered, flagged, defaultOpen = false }: ExamNavigatorProps) {
  const [open, setOpen] = useState(defaultOpen);
  const listRef = useRef<HTMLOListElement | null>(null);

  const focusChip = (index: number) => {
    const target = listRef.current?.querySelector<HTMLButtonElement>(`button[data-index="${index}"]`);
    target?.focus();
  };
  const onKeyDown = (event: ReactKeyboardEvent<HTMLOListElement>) => {
    const from = Number((event.target as HTMLElement).dataset?.index);
    if (!Number.isInteger(from)) return;
    const next =
      event.key === 'ArrowRight' || event.key === 'ArrowDown' ? Math.min(count - 1, from + 1)
      : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? Math.max(0, from - 1)
      : event.key === 'Home' ? 0
      : event.key === 'End' ? count - 1
      : null;
    if (next === null) return;
    event.preventDefault();
    focusChip(next);
  };

  return (
    <div id="exam-nav" className="mb-6">
      <button
        id="exam-nav-toggle"
        type="button"
        aria-expanded={open}
        aria-controls="exam-nav-panel"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-gray-600 px-4 text-sm font-semibold uppercase tracking-wider text-gray-200 hover:border-brand-600 hover:text-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
      >
        {/* lucide `layout-grid` (ISC), inlined */}
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect width="7" height="7" x="3" y="3" rx="1" />
          <rect width="7" height="7" x="14" y="3" rx="1" />
          <rect width="7" height="7" x="14" y="14" rx="1" />
          <rect width="7" height="7" x="3" y="14" rx="1" />
        </svg>
        <span>Questions</span>
        <span id="exam-nav-summary" className="normal-case tracking-normal font-normal text-gray-400">
          {answered}/{count} answered{flagged ? ` · ${flagged} flagged` : ''}
        </span>
        <svg className={open ? 'w-4 h-4 rotate-180 motion-safe:transition-transform' : 'w-4 h-4 motion-safe:transition-transform'} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      <div id="exam-nav-panel" hidden={!open} className="mt-3">
        <ol
          ref={listRef}
          aria-label="Exam questions"
          onKeyDown={onKeyDown}
          className="flex flex-wrap gap-2"
        >
          {Array.from({ length: count }, (_unused, index) => {
            const status = statusOf(index);
            const isCurrent = index === current;
            const words = [`Question ${index + 1}`, status.answered ? 'answered' : 'unanswered', status.flagged ? 'flagged' : '', isCurrent ? 'current' : '']
              .filter(Boolean)
              .join(', ');
            return (
              <li key={index}>
                <button
                  type="button"
                  data-index={index}
                  data-state={status.answered ? 'answered' : 'unanswered'}
                  data-flagged={status.flagged ? 'true' : undefined}
                  aria-label={words}
                  aria-current={isCurrent ? 'step' : undefined}
                  className={`${status.answered ? CHIP_ANSWERED : CHIP_OPEN} ${isCurrent ? CURRENT_RING : ''}`}
                  onClick={() => onJump(index)}
                >
                  <span aria-hidden="true">{index + 1}</span>
                  {status.flagged && (
                    <span className="absolute -top-1.5 -right-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-gray-900 text-brand-400 border border-brand-400">
                      <FlagGlyph className="w-3 h-3" />
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ol>
        <p id="exam-nav-legend" className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-400">
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden="true" className="inline-block h-3.5 w-3.5 rounded bg-gray-200" /> Answered
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden="true" className="inline-block h-3.5 w-3.5 rounded border-2 border-dashed border-gray-500" /> Unanswered
          </span>
          <span className="inline-flex items-center gap-1.5">
            <FlagGlyph className="w-3.5 h-3.5 text-brand-400" /> Flagged
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden="true" className="inline-block h-3.5 w-3.5 rounded ring-2 ring-brand-600" /> Current
          </span>
        </p>
      </div>
    </div>
  );
}
