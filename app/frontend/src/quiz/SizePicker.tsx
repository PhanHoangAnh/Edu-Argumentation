// exam-recall-suite P1 (22-10-26) — A4 session size, and the same stepper for D2 "New / day".
//
// A [-] value [+] stepper. Buttons, not a slider: exact steps, 44px targets, keyboard-native.
// The value is announced politely so a screen reader hears the new number after each press.
// ⛔ Class strings are complete literals (Tailwind purge).

const STEP_BTN =
  'min-h-[44px] min-w-[44px] rounded-lg border border-gray-600 text-gray-200 hover:border-brand-600 hover:text-white text-lg font-bold transition-colors active:scale-95 motion-reduce:transform-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center';

export interface SizePickerProps {
  id: string;
  /** 1-3 words, shown before the stepper. */
  label: string;
  /** What the number counts, for the buttons' aria-labels ("questions", "new cards"). */
  unit: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (next: number) => void;
}

export function SizePicker({ id, label, unit, value, min, max, step, onChange }: SizePickerProps) {
  const set = (next: number) => onChange(Math.min(max, Math.max(min, next)));
  return (
    <div id={id} role="group" aria-labelledby={`${id}-label`} className="flex items-center gap-3">
      <span id={`${id}-label`} className="min-w-[5.5rem] text-sm font-semibold text-gray-200">
        {label}
      </span>
      <button
        type="button"
        className={STEP_BTN}
        aria-label={`Fewer ${unit}`}
        disabled={value <= min}
        onClick={() => set(value - step)}
      >
        <span aria-hidden="true">&minus;</span>
      </button>
      <output id={`${id}-value`} aria-live="polite" className="w-10 text-center text-lg font-bold text-white tabular-nums">
        {value}
      </output>
      <button
        type="button"
        className={STEP_BTN}
        aria-label={`More ${unit}`}
        disabled={value >= max}
        onClick={() => set(value + step)}
      >
        <span aria-hidden="true">+</span>
      </button>
    </div>
  );
}
