// A2 — THEORY NAVIGATION, AS PURE FUNCTIONS.
//
// ⚠ WHY THIS IS NOT A CONTEXT. It started as a fifth provider holding `currentTheory`
//   (app.js:1414) so the LIBRARY and the READER could share one cursor. It was backed out:
//   slice A3 owns routing/useHashCursor and was writing ReaderScreen.tsx at the same moment
//   (measured mtime, 22-09-26 08:41). A second useHashCursor instance is a SECOND CURSOR —
//   worse than an unwired helper, because `select()` would move a cursor the reader never
//   reads and the hash would disagree with the screen.
//
//   So the WALK lives here, pure and consumer-free, and the cursor stays exactly where A3
//   put it. Wiring is a one-line import for whoever owns the reader next. See the slice-A2
//   report §Collision.
//
// PORTED FROM (by symbol, app.js): previousTheory (1471-1478), nextTheory (1480-1488),
// nextLesson (340-350).

import type { TheoryCursor } from '../data/types';

export type BlockCountOf = (chapterIndex: number) => number;

/**
 * previousTheory — back one block, else the LAST block of the nearest earlier NON-EMPTY
 * chapter. null only at the true start of the book.
 *
 * ⛔ The empty-chapter skip is the whole point. A chapter whose `items` is empty must be
 *    stepped OVER, not landed on — landing there shows a blank reader with working buttons.
 */
export function previousTheory(
  cursor: TheoryCursor,
  blockCountOf: BlockCountOf,
): TheoryCursor | null {
  if (cursor.blockIndex > 0) {
    return { chapterIndex: cursor.chapterIndex, blockIndex: cursor.blockIndex - 1 };
  }
  for (let c = cursor.chapterIndex - 1; c >= 0; c -= 1) {
    const count = blockCountOf(c);
    if (count) return { chapterIndex: c, blockIndex: count - 1 };
  }
  return null;
}

/**
 * nextTheory — forward one block, else the FIRST block of the nearest later NON-EMPTY
 * chapter. null only at the true end of the book.
 *
 * ⚠ A1's approximation (`chapterIndex >= chapters.length - 1 && blockIndex >= blocks.length - 1`)
 *   disables Next on the LAST BLOCK OF EVERY CHAPTER, not just the last of the book —
 *   Géron has 19 chapters, so that is 18 dead ends.
 */
export function nextTheory(
  cursor: TheoryCursor,
  chapterCount: number,
  blockCountOf: BlockCountOf,
): TheoryCursor | null {
  if (cursor.blockIndex + 1 < blockCountOf(cursor.chapterIndex)) {
    return { chapterIndex: cursor.chapterIndex, blockIndex: cursor.blockIndex + 1 };
  }
  for (let c = cursor.chapterIndex + 1; c < chapterCount; c += 1) {
    if (blockCountOf(c)) return { chapterIndex: c, blockIndex: 0 };
  }
  return null;
}

export interface NextLesson extends TheoryCursor {
  /** true == the book is finished; the cursor is its LAST block, not a fresh one. */
  done: boolean;
}

/**
 * nextLesson — the FIRST INCOMPLETE block, walking chapters in order.
 *
 * ⛔⛔ THIS IS B15's REAL MECHANISM, AND IT IS NOT WHERE A1 OR A3 PUT IT.
 *     app.js:1238-1242 — #read-tutorial-btn calls nextLesson() and selectTheory()s it,
 *     which OVERWRITES the hash before the reader is shown. renderTutorial(), the one
 *     place that honours the hash, runs on LOAD only. That is why arriving on
 *     `#chapter=1&block=8` and clicking LEARN lands on block 1 and stamps
 *     `#chapter=1&block=1`.
 *     ⚠ The competing story — "renderTutorial's `!tutorialData.sections` guard fires
 *       because packaged books carry `chapters`" — is FALSE against disk: theoryChapters()
 *       READS tutorialData.sections, and app/backend/content.py `_shape()` refuses to list
 *       any book that lacks it. Every listable book HAS sections, so that guard never
 *       fires. Evidence in the slice-A2 report §B15.
 *
 * ⛔ A finished book returns its LAST block with done:true, never null — that is what makes
 *    the button read "Continue reading" instead of vanishing (app.js:370).
 */
export function nextLesson(
  chapterCount: number,
  blockCountOf: BlockCountOf,
  isBlockComplete: (chapterIndex: number, blockIndex: number) => boolean,
): NextLesson | null {
  for (let ci = 0; ci < chapterCount; ci += 1) {
    const count = blockCountOf(ci);
    for (let bi = 0; bi < count; bi += 1) {
      if (!isBlockComplete(ci, bi)) return { chapterIndex: ci, blockIndex: bi, done: false };
    }
  }
  const last = chapterCount - 1;
  if (last < 0) return null;
  return { chapterIndex: last, blockIndex: Math.max(0, blockCountOf(last) - 1), done: true };
}
