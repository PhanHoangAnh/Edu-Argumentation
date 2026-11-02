// exam-recall-suite P2 (22-10-26) — D: mastery per area + "Next up".
//
// Area = an exam domain when the book has `exam.domains`, else a chapter (the server decides).
// Each row: name · a bar · the NUMBER as text (`58%  21/36`) · `target 80%`. The bar is decoration
// (aria-hidden): every fact it shows is also text, so colour/length is never the only cue, and nothing
// is revealed only on hover (no tooltips to miss with a keyboard).
// Fewer than 5 answers in an area = "Not enough yet" (no % shown, the bar stays empty).
// ⛔ Class strings are complete literals (Tailwind purge).
import type { MasteryArea, MasteryPayload } from '../data/types';
import { OUTLINE_BTN } from '../shell/ui';

/** Fewer answers than this in an area = "Not enough yet" (plan §2 D). */
export const MASTERY_MIN_ANSWERS = 5;

function pctText(area: MasteryArea): string {
  return area.pct === null ? 'Not enough yet' : `${area.pct}%`;
}

/** "Next up: Ch 7 Ensembles  58%  [Practice]" — used on the Account page and in the Practice dialog. */
export function NextUpRow({
  area,
  idBase,
  onPractice,
  canPractice,
}: {
  area: MasteryArea;
  idBase: string;
  onPractice: (area: MasteryArea) => void;
  /** False when this book's bank holds no question for the area (button disabled, reason shown). */
  canPractice: boolean;
}) {
  return (
    <div id={`${idBase}-next-up`} className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm" data-area={area.id}>
      <span className="text-gray-400">Next up</span>
      <span className="min-w-0 font-semibold text-white break-words">{area.name}</span>
      <span className="tabular-nums text-gray-200">{pctText(area)}</span>
      <button
        id={`${idBase}-next-up-btn`}
        type="button"
        className={`${OUTLINE_BTN} ml-auto`}
        disabled={!canPractice}
        aria-label={`Practice ${area.name}`}
        onClick={() => onPractice(area)}
      >
        Practice
      </button>
      {!canPractice && <span className="basis-full text-xs text-gray-400">No questions for this area in the book.</span>}
    </div>
  );
}

export interface MasteryBarsProps {
  data: MasteryPayload;
  onPractice: (area: MasteryArea) => void;
  canPractice: (area: MasteryArea) => boolean;
}

export function MasteryBars({ data, onPractice, canPractice }: MasteryBarsProps) {
  const next = data.nextUp ? data.areas.find((a) => a.id === data.nextUp) ?? null : null;
  const target = data.target;
  if (!data.areas.length) {
    return <p id="mastery-empty" className="text-sm text-gray-400">No answers yet. Practise a chapter to see it here.</p>;
  }
  return (
    <div className="space-y-4">
      {next && <NextUpRow area={next} idBase="mastery" onPractice={onPractice} canPractice={canPractice(next)} />}
      <ul id="mastery-list" className="space-y-3" aria-label={data.kind === 'domain' ? 'Mastery per exam domain' : 'Mastery per chapter'}>
        {data.areas.map((area) => {
          const width = area.pct === null ? 0 : Math.max(0, Math.min(100, area.pct));
          const below = area.pct !== null && area.pct < target;
          return (
            <li key={area.id} data-area={area.id} className="grid grid-cols-[minmax(0,1fr)_auto] sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 text-sm">
              <span className="min-w-0 break-words text-gray-200">{area.name}</span>
              <span className="order-3 col-span-2 sm:order-none sm:col-span-1 relative h-2.5 rounded-full bg-gray-700 overflow-hidden" aria-hidden="true">
                <span className={`absolute inset-y-0 left-0 rounded-full ${below ? 'bg-amber-400' : 'bg-green-400'}`} style={{ width: `${width}%` }} />
                <span className="absolute inset-y-0 w-0.5 bg-gray-300" style={{ left: `calc(${Math.min(100, Math.max(0, target))}% - 1px)` }} />
              </span>
              <span className="tabular-nums whitespace-nowrap text-right" data-cell="pct">
                {/* P2c (22-10-26): real spaces between the parts — margins alone left "92%11/12" for a screen reader. */}
                <span className={area.pct === null ? 'text-gray-400' : 'font-semibold text-white'}>{pctText(area)}</span>{' '}
                <span className="ml-1 text-gray-400">{area.right}/{area.answered}</span>
                {below && <>{' '}<span className="ml-1 text-gray-400">target {target}%</span></>}
              </span>
            </li>
          );
        })}
      </ul>
      <p className="text-xs text-gray-400">Right answers in the last 200 per area. Target {target}%.</p>
    </div>
  );
}
