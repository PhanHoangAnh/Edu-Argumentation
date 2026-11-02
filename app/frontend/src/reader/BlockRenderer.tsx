// Seam 15 (reader/BlockRenderer) — ⛔ RULING R6 LIVES HERE. READ THE RULING, NOT THIS.
//     process/features/ml/active/edu-replatform_21-09-26/RULING-R6-inline-visuals_21-09-26.md
//
// THE RULING, in the user's words:
//   "remember fig/picture/graphs and every visualize element sit at the mentioned
//    position of the correlated theory blocks, not all below. I dont want to read, then
//    scrolll down then scroll up to continue reading and repeat."
//
// It is a STUDY-QUALITY requirement, not a layout preference. The failure it names is
// the read -> scroll down -> scroll up -> resume loop, on every single figure.
//
// ⛔⛔ THE CONTRACT, AS CODE DISCIPLINE (F1b):
//     `blocks[]` **IS** the reading order. This component is a PURE FUNCTION of
//     `blocks[]` WITH ZERO GROUPING LOGIC. It maps. That is all it does.
//
//     FORBIDDEN — every one of these is a natural React/CSS instinct, which is exactly
//     why they are listed:
//       · filtering text-then-visuals into two passes
//       · CSS `order:`
//       · `float`
//       · collecting figures into a footer section
//       · sorting by asset id  ⚠ `fig-4-16` is deliberately emitted BEFORE `fig-4-14`
//         in Chapter 4 — the order is PROSE-MENTION order, not numeric order. A sort
//         that "tidies" this breaks the ruling while looking like a fix.
//
// ⚠ Phase 03 is the phase that DECIDES block render order, so it is the phase that could
//   silently undo R6. Surface 1 (the one-off module.json transform) has ALREADY SHIPPED
//   out of band — 402 of 534 numbered visuals across both books. Phase 03 does NOT redo
//   it and MUST NOT break it. The four-condition placement gate is re-run at the end of
//   the phase against nn's book library.
//
// ⚠ The placement gate is FOUR conditions, all of which must hold. The first wording was
//   VACUOUS and is void — it reported checked=326 failures=0 GREEN against the UNFIXED
//   file. The binding form: (1) the visual appears after the prose that names it;
//   (2) NO paragraph break between mention and visual; (3) only visual sub-blocks
//   between them; (4) no other asset's mention between them.
import type { SubBlock } from '../data/types';
import { TextBlock } from './blocks/TextBlock';
import { VisualBlock } from './blocks/VisualBlock';
import { PanelBlock } from './blocks/PanelBlock';
import { DeeperBlock } from './blocks/DeeperBlock';
import { CodeCellsBlock } from './codecells/CodeCellsBlock';

export interface BlockRendererProps {
  /** The reading order. Rendered with a plain map, in this order, always. */
  blocks: SubBlock[];
  theme: string;
  assetBase: string;
}

export function BlockRenderer({ blocks, theme, assetBase }: BlockRendererProps) {
  // ⛔ A plain map. No filter, no sort, no partition, no grouping. See the header.
  return (
    <>
      {blocks.map((block, index) => (
        <SubBlockView key={index} block={block} theme={theme} assetBase={assetBase} />
      ))}
    </>
  );
}

/**
 * The dispatcher. Branch order is ported from appendTheoryContent EXACTLY — it is
 * order-sensitive: `equation` and `figure`-with-`src`-but-no-`svg` are caught by the
 * asset-panel branch BEFORE the generic figure branch, and a `figure` carrying inline
 * `svg` falls through to it. Reordering these branches changes what renders.
 */
function SubBlockView({ block, theme, assetBase }: { block: SubBlock; theme: string; assetBase: string }) {
  if (!block || typeof block !== 'object') return null;

  if (block.type === 'code_cells') return <CodeCellsBlock block={block} />;

  // A3 OWNS renderDeeper's own shape (a collapsible "go deeper" panel). It is routed
  // through PanelBlock here so the seam exists; the markup is not yet ported.
  // ⚑ Phase 04: renderDeeper, not the generic panel — the generic panel printed [object Object].
  if (block.type === 'deeper') return <DeeperBlock block={block} />;

  if (block.type === 'equation' || (block.type === 'figure' && block.src && !block.svg)) {
    return <VisualBlock block={block} assetBase={assetBase} compact={false} />;
  }

  if (block.type === 'text') return <TextBlock block={block} />;

  if (block.type === 'figure' || block.type === 'diagram') {
    return <VisualBlock block={block} assetBase={assetBase} />;
  }

  return <PanelBlock block={block} theme={theme} />;
}
