// LIVE ROOMS — one timed question (study-rooms-qna P3, 30-09-26).
//
// Uses the quiz's own OptionCard (the ONE card, seam 21), so a room answer looks and reveals like a
// quiz answer. Each option also carries a SHAPE and a colour next to the card's letter A-D, so the
// choice never rests on colour alone. Keys 1-4 answer.
//
// ⚑ The countdown bar is aria-hidden and is the only animation this view adds; under reduced
//   motion it is hidden and a plain "N s" label stays.
// ⛔ `correct` is not known here until the reveal frame arrives — the server never sends it with the
//   question (addons/rooms_store.py question_frame).
import { useEffect, useState } from 'react';
import { OptionCard } from '../quiz/OptionCard';
import { CAPTION, CARD } from '../shell/ui';

const SHAPES = ['▲', '◆', '●', '■'];
const SHAPE_CLASS = ['text-red-400', 'text-sky-400', 'text-amber-400', 'text-emerald-400'];
const SHAPE_NAME = ['triangle', 'diamond', 'circle', 'square'];

export interface LiveQuestionProps {
  open: boolean;
  qIdx: number;
  total: number;
  question: string;
  options: string[];
  secs: number;
  /** Local epoch ms at which this question closes (already corrected for clock skew). */
  endsAt: number;
  chosen: number | null;
  locked: boolean;
  reveal: { correct: number; explanations: string[] } | null;
  onAnswer: (choice: number) => void;
}

export function LiveQuestion(props: LiveQuestionProps) {
  const { open, qIdx, total, question, options, secs, endsAt, chosen, locked, reveal, onAnswer } = props;
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (reveal) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [reveal, qIdx]);

  useEffect(() => {
    if (!open || reveal || locked) return undefined;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')) return;
      const n = Number(event.key);
      if (Number.isInteger(n) && n >= 1 && n <= Math.min(4, options.length)) onAnswer(n - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, reveal, locked, options.length, onAnswer]);

  const left = Math.max(0, Math.ceil((endsAt - now) / 1000));
  const fraction = reveal ? 0 : Math.max(0, Math.min(1, (endsAt - now) / (secs * 1000)));

  return (
    <div className={`${CARD} space-y-5`}>
      <div className="flex items-center justify-between gap-3">
        <p className={CAPTION}>{`Question ${qIdx + 1} of ${total}`}</p>
        {!reveal ? <p className="text-sm tabular-nums text-gray-300" aria-hidden="true">{`${left} s`}</p> : null}
      </div>
      {!reveal ? (
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-700 motion-reduce:hidden" aria-hidden="true">
          <div className="h-full bg-brand-600 transition-[width] duration-200 ease-linear" style={{ width: `${fraction * 100}%` }} />
        </div>
      ) : null}
      <p id="live-question" className="text-lg text-white">{question}</p>
      <div id="live-options" className="grid gap-3">
        {options.map((text, i) => (
          <OptionCard
            key={`${qIdx}-${i}`}
            index={i}
            selected={chosen === i}
            reveal={reveal ? (i === reveal.correct ? 'correct' : 'incorrect') : null}
            explanation={reveal ? reveal.explanations[i] : undefined}
            disabled={locked || reveal !== null}
            onSelect={() => onAnswer(i)}
          >
            <span className={`mr-2 ${SHAPE_CLASS[i % 4]}`} aria-hidden="true">{SHAPES[i % 4]}</span>
            <span className="sr-only">{`${SHAPE_NAME[i % 4]}: `}</span>
            {text}
          </OptionCard>
        ))}
      </div>
      {locked && !reveal ? <p id="live-locked" className="text-sm text-gray-400">Answer locked.</p> : null}
    </div>
  );
}
