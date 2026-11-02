// Seam 15 (reader/BlockRenderer), leaf 1 — PROSE.
//
// PORTED FROM: the `block.type === 'text'` branch of appendTheoryContent (by symbol).
//
// ⚠ TWO THINGS HERE ARE LOAD-BEARING AND LOOK LIKE NOISE:
//   1. `lineHeight: var(--reading-leading)` is set INLINE, not via `leading-relaxed`.
//      The prose renders inside <rich-text-viewer>'s shadow DOM, whose :host INHERITS
//      line-height — so the value has to sit on THIS element. The Tailwind class was
//      winning at 1.625 and --reading-leading (1.8) never arrived.
//   2. `[overflow-wrap:anywhere]` is inherited into the shadow DOM. A long inline code
//      span (e.g. KNeighborsRegressor(n_neighbors=3)) otherwise pushed phones 20 px
//      sideways on ch01-b08, measured 17-09-26.
//
// ⛔ THE MEASURE CAP IS GONE (user, 21-09-26: "the text have to fill the remaining
//    space"). Do not reintroduce a max-width here in any unit.
import { RichTextViewer } from '../RichTextViewer';
import type { SubBlock } from '../../data/types';

export function TextBlock({ block }: { block: SubBlock }) {
  return (
    <div
      className="mb-6 [overflow-wrap:anywhere]"
      style={{ lineHeight: 'var(--reading-leading)' }}
    >
      <RichTextViewer content={block.content ?? ''} />
    </div>
  );
}
