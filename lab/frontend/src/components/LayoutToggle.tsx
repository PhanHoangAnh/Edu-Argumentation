import type { Arrangement } from '../layout';

// ⚑ 25-09-26 (user): two GLYPHS, no text — side by side = two columns, stacked = two rows.
//   Sits at the right end of the lesson-title row. The name is the tooltip + aria-label.
const BTN = 'min-h-[42px] min-w-[44px] flex items-center justify-center transition-colors'; // 25-09-26: same height as the window glyphs
const on = 'bg-gray-700 text-white';
const off = 'text-gray-400 hover:text-white';

function Glyph({ value }: { value: Arrangement }) {
  return (
    <svg className="w-5 h-5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      {value === 'side' ? (
        <>
          <rect x="2" y="3" width="7" height="14" rx="1.5" />
          <rect x="11" y="3" width="7" height="14" rx="1.5" />
        </>
      ) : (
        <>
          <rect x="2" y="2.5" width="16" height="6.5" rx="1.5" />
          <rect x="2" y="11" width="16" height="6.5" rx="1.5" />
        </>
      )}
    </svg>
  );
}

export function LayoutToggle({ arrangement, onChange }: { arrangement: Arrangement; onChange: (next: Arrangement) => void }) {
  const button = (value: Arrangement, label: string) => (
    <button
      id={`lab-layout-${value}`}
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={arrangement === value ? 'true' : 'false'}
      className={`${BTN} ${arrangement === value ? on : off}`}
      onClick={() => onChange(value)}
    >
      <Glyph value={value} />
    </button>
  );
  return (
    <div className="ml-auto flex shrink-0 rounded-lg border border-gray-600 overflow-hidden" role="group" aria-label="Layout">
      {button('side', 'Side by side')}
      {button('stacked', 'Stacked')}
    </div>
  );
}
