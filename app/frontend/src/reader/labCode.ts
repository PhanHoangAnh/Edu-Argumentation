/**
 * Does this lesson have code Lab can run? — the reader's copy of the ONE D5 rule.
 *
 * ⛔ MIRROR of ml/study/Edu-Argumentation/lab/backend/library.py `lesson_code`. The Lab button
 *    is shown exactly when Lab lists the lesson, so the two copies must agree rule for rule;
 *    gate T2-xref proves they do. Change one, change the other.
 *
 * The block passed in is already normalised by BookProvider.blocksOfChapter (a plain-string
 * item became {term: "Point N", blocks: [{type: 'text', content}]}), which is the same
 * normalisation library.py applies.
 *   1. the FIRST `card` whose title starts with "Full script": its ``` fence bodies (no fence
 *      -> the card text) — used when non-blank; a blank one does not fall through to a
 *      second card;
 *   2. else any non-blank cell source in a `code_cells` BLOCK;
 *   3. else any non-blank ```python fence in a `text` or `card` block.
 */
import type { SubBlock, TheoryBlock } from '../data/types';

const FENCE_ANY = /```[^\n]*\n([\s\S]*?)```/g;
const FENCE_PY = /```python[^\n]*\n([\s\S]*?)```/g;

function bodies(content: string, fence: RegExp): string[] {
  return Array.from(content.matchAll(fence), (match) => match[1] ?? '');
}

export function lessonHasCode(block: TheoryBlock | undefined): boolean {
  const blocks: SubBlock[] = Array.isArray(block?.blocks)
    ? (block.blocks as unknown[]).filter((b): b is SubBlock => typeof b === 'object' && b !== null)
    : [];

  const script = blocks.find((b) => b.type === 'card' && typeof b.title === 'string' && b.title.startsWith('Full script'));
  if (script && typeof script.content === 'string') {
    const found = bodies(script.content, FENCE_ANY);
    const code = found.length ? found.map((part) => part.replace(/\n+$/, '')).join('\n\n') : script.content.trim();
    if (code.trim()) return true;
  }

  for (const b of blocks) {
    if (b.type !== 'code_cells') continue;
    const cells = (b as { cells?: unknown }).cells;
    if (!Array.isArray(cells)) continue;
    for (const cell of cells) {
      const source = typeof cell === 'object' && cell !== null ? (cell as { source?: unknown }).source : undefined;
      if (typeof source === 'string' && source.trim()) return true;
    }
  }

  return blocks.some(
    (b) => (b.type === 'text' || b.type === 'card') && typeof b.content === 'string' && bodies(b.content, FENCE_PY).some((body) => body.trim()),
  );
}
