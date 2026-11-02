// exam-recall-suite P1 (22-10-26) — B: flag any question, from the quiz header.
//
// A 44px toggle (aria-pressed) with the lucide `Flag` glyph, inlined as SVG (this app ships no
// icon package; its other icons are inline SVG too). The flagged set is the server's
// (/api/flags), updated optimistically and rolled back if the save fails. Every press says what
// happened in a short status line — "Flagged" / "Unflagged" / "Not saved" — never silent.
// ⛔ Class strings are complete literals (Tailwind purge).
import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { flagsKey, useFlags } from '../data/queries';
import { reviewKeyOf, storedBodyOf, toggleFlag } from '../data/writes';
import type { FlaggedQuestion, QuizQuestion } from '../data/types';

const BTN_OFF =
  'min-h-[44px] min-w-[44px] rounded-lg border border-gray-600 text-gray-300 hover:border-brand-600 hover:text-white transition-colors active:scale-95 motion-reduce:transform-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 flex items-center justify-center';
const BTN_ON =
  'min-h-[44px] min-w-[44px] rounded-lg border border-brand-600 bg-brand-600/20 text-brand-400 hover:text-white transition-colors active:scale-95 motion-reduce:transform-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 flex items-center justify-center';

export function FlagButton({ moduleId, question }: { moduleId: string; question: QuizQuestion | undefined }) {
  const queryClient = useQueryClient();
  const flags = useFlags(moduleId, Boolean(question));
  const key = reviewKeyOf(question);
  const flagged = Boolean(key && flags.data?.some((f) => f.question === key));
  const [status, setStatus] = useState('');
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  useEffect(() => setStatus(''), [key]);

  if (!question || !key) return null;

  const say = (text: string) => {
    setStatus(text);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setStatus(''), 2500);
  };

  const toggle = async () => {
    const want = !flagged;
    const previous = queryClient.getQueryData<FlaggedQuestion[]>(flagsKey(moduleId));
    const body = storedBodyOf(question);
    queryClient.setQueryData<FlaggedQuestion[]>(flagsKey(moduleId), (list = []) =>
      want ? [...list.filter((f) => f.question !== key), { question: key, body: body ?? null }] : list.filter((f) => f.question !== key),
    );
    const ok = await toggleFlag({ module: moduleId, question: key, flagged: want, body });
    if (!ok) {
      queryClient.setQueryData(flagsKey(moduleId), previous);
      say('Not saved');
      return;
    }
    say(want ? 'Flagged' : 'Unflagged');
    void queryClient.invalidateQueries({ queryKey: flagsKey(moduleId) });
  };

  return (
    <div className="flex items-center gap-2">
      <button
        id="flag-btn"
        type="button"
        aria-pressed={flagged}
        aria-label={flagged ? 'Unflag question' : 'Flag question'}
        title={flagged ? 'Unflag' : 'Flag for later'}
        className={flagged ? BTN_ON : BTN_OFF}
        onClick={() => void toggle()}
      >
        {/* lucide `flag` (ISC), inlined */}
        <svg
          className="w-5 h-5"
          viewBox="0 0 24 24"
          fill={flagged ? 'currentColor' : 'none'}
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M4 22V4a1 1 0 0 1 .4-.8A6 6 0 0 1 8 2c3 0 5 2 7.333 2q2 0 3.067-.8A1 1 0 0 1 20 4v10a1 1 0 0 1-.4.8A6 6 0 0 1 16 16c-3 0-5-2-8-2a6 6 0 0 0-4 1.528" />
        </svg>
      </button>
      {/* After the button (it sits left-aligned under the question number). Visible from `sm` up; on
          a phone the filled glyph is the cue and the status is read out only. */}
      <span id="flag-status" role="status" aria-live="polite" className="sr-only sm:not-sr-only text-xs font-semibold uppercase tracking-wider text-gray-400">
        {status}
      </span>
    </div>
  );
}
