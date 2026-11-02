// Seam 15 (reader/BlockRenderer), leaf 4 — THE `deeper` PANEL. Phase 04.
//
// PORTED FROM (by symbol, app.js): renderDeeper (app.js:2141-2168), verbatim.
//
// ⛔⛔ THIS FIXES THE `[object Object]` DEFECT (found by eye 22-09-26, backlogged as port-only).
//     `deeper` items are {term, text} OBJECTS (291 Géron lessons carry the shape). The port
//     routed `deeper` through the generic PanelBlock, which renders `items` as strings, so each
//     item printed as "[object Object]". The legacy renders a collapsible <details> whose rows
//     are `**term** — text`. It rendered inside rich-text-viewer's SHADOW ROOT, which is why 78
//     green gates and every light-DOM text probe missed it — gate R-DEEP pierces the shadow root.
//
// ⚠ Rule 15: the label says WHICH kind of "go deeper" it is. `kind: 'concept'` is reasoning;
//   anything else (untagged included) is API notes — which is what they historically were.
import type { SubBlock } from '../../data/types';
import { TutorialListItem } from './PanelBlock';

interface DeeperItem {
  term?: string;
  text?: string;
}

export function DeeperBlock({ block }: { block: SubBlock }) {
  const kind = (block as { kind?: string }).kind === 'concept' ? 'concept' : 'syntax';
  const label = kind === 'concept' ? 'Go deeper · why it works' : 'Go deeper · Python notes';
  const items = (Array.isArray(block.items) ? block.items : []) as unknown[];
  return (
    <details className="not-prose group my-6 rounded-xl border border-gray-700 bg-gray-900/60" data-deeper={kind}>
      <summary className="flex min-h-[44px] cursor-pointer select-none items-center gap-2 rounded-xl px-4 text-sm font-semibold text-gray-200 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 [&::-webkit-details-marker]:hidden">
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          className="h-4 w-4 shrink-0 transition-transform group-open:rotate-90"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="m9 6 6 6-6 6" />
        </svg>
        <span>{label}</span>
      </summary>
      <ul className="m-0 space-y-3 px-4 pb-4 pt-1 text-gray-300 [overflow-wrap:anywhere]">
        {items.map((entry, index) => {
          const item = (entry && typeof entry === 'object' ? entry : null) as DeeperItem | null;
          if (!item || !item.text) return null;   // the legacy skips an entry without text
          return <TutorialListItem key={index} content={`**${item.term || ''}** — ${item.text}`} />;
        })}
      </ul>
    </details>
  );
}
