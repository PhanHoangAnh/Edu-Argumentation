// exam-recall-suite P1 (22-10-26) — A6 confidence tap, review runs only.
//
// Shown with the recall box, BEFORE the options: "how sure are you?". One tap records the answer's
// confidence and reveals the options (it replaces a "Show options" press; that button stays for
// anyone who would rather not say). Nothing is sent here — the choice rides on the answer's log
// entry (data/writes.logAnswer).
// ⛔ Class strings are complete literals (Tailwind purge).
import type { Confidence } from '../data/types';

const CHOICES: { value: Confidence; label: string }[] = [
  { value: 'sure', label: 'Sure' },
  { value: 'unsure', label: 'Unsure' },
  { value: 'guess', label: 'Guess' },
];

const BTN =
  'min-h-[44px] min-w-[44px] px-5 rounded-lg border border-gray-600 text-gray-200 hover:border-brand-600 hover:text-white text-sm font-bold uppercase tracking-wider transition-colors active:scale-95 motion-reduce:transform-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600';

export function ConfidenceRow({ onPick }: { onPick: (value: Confidence) => void }) {
  return (
    <div id="confidence-row" role="group" aria-labelledby="confidence-label" className="mt-3 flex flex-wrap items-center gap-2">
      {/* Own line (w-full) so the three buttons stay together on one row, also at 390 px. */}
      <span id="confidence-label" className="w-full text-sm text-gray-400">
        How sure? Tap to show options
      </span>
      {CHOICES.map((choice) => (
        <button
          key={choice.value}
          id={`confidence-${choice.value}-btn`}
          type="button"
          className={BTN}
          onClick={() => onPick(choice.value)}
        >
          {choice.label}
        </button>
      ))}
    </div>
  );
}
