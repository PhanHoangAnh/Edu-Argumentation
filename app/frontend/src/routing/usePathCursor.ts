// Seam 8 (routing) — THE READER CURSOR, NOW READ FROM THE PATH. Phase 06a (ruling R25).
//
// ⚑ REPLACES routing/useHashCursor.ts. That file reproduced B15 on purpose — the pre-existing defect
//   where a `#chapter=N&block=N` deep link was honoured only on book load and LEARN stamped over it.
//   R25 retires the hash: a lesson now has its own PATH (routing/paths.ts), the reader opens ON that
//   lesson, and an old hash link is rewritten to the path. B15's two halves are therefore gone by
//   design, and gates/gate-r-b15.mjs now asserts the redirect instead of the defect.
//
// WHAT THIS HOOK OWNS: the cursor value and its clamping, and ONE load edge — when a book's content
//   arrives, the cursor is set from the URL (a lesson route for THIS book, or a legacy hash), else
//   the book's start. It does NOT write the URL: shell/AppShell owns the address bar, because the
//   path depends on the SCREEN as well as the cursor (reader vs quiz vs home).
//
// ⛔ `ready` IS LOAD-BEARING. The address-bar writer must not run between "the book arrived" and
//    "the cursor was set from the URL": React runs a child's effects before its provider's, so in
//    that one commit the writer would see the OLD cursor, push lesson 1 over the deep link, and
//    the load edge would then read back the path it had just been overwritten with. `ready` turns
//    true only in the render AFTER the cursor was applied for the current book.

import { useCallback, useEffect, useState } from 'react';
import type { ModuleData, TheoryCursor } from '../data/types';
import { cursorForRoute, fileForSlug, legacyHashCursor, parseRoute } from './paths';

const AT_START: TheoryCursor = { chapterIndex: 0, blockIndex: 0 };

/** clampTheory — a deep link past the end lands on the last real block, not blank. */
export function clampCursor(
  cursor: TheoryCursor,
  chapterCount: number,
  blockCountOf: (chapterIndex: number) => number,
): TheoryCursor {
  const chapterIndex = Math.min(Math.max(cursor.chapterIndex, 0), Math.max(chapterCount - 1, 0));
  const blockCount = blockCountOf(chapterIndex);
  return {
    chapterIndex,
    blockIndex: Math.min(Math.max(cursor.blockIndex, 0), Math.max(blockCount - 1, 0)),
  };
}

/** Where a freshly loaded book should open, from the URL alone. */
export function cursorFromLocation(activeBookFile: string | null): TheoryCursor {
  const route = parseRoute();
  if (route.kind === 'lesson' && activeBookFile && fileForSlug(route.slug, [activeBookFile]) === activeBookFile) {
    return cursorForRoute(route) ?? AT_START;
  }
  return legacyHashCursor() ?? AT_START;
}

export interface PathCursor {
  cursor: TheoryCursor;
  /** Moves the cursor (clamped). The shell writes the address bar from it. */
  select: (next: TheoryCursor) => void;
  /** The cursor has been set from the URL for the book currently loaded. */
  ready: boolean;
}

export function usePathCursor(
  chapterCount: number,
  blockCountOf: (chapterIndex: number) => number,
  module: ModuleData | null,
  activeBookFile: string | null,
): PathCursor {
  const [cursor, setCursor] = useState<TheoryCursor>(AT_START);
  const [appliedFor, setAppliedFor] = useState<ModuleData | null>(null);

  const select = useCallback(
    (next: TheoryCursor) => setCursor(clampCursor(next, chapterCount, blockCountOf)),
    [chapterCount, blockCountOf],
  );

  // THE LOAD EDGE: a new book object (a different book, or the first one) with chapters in it.
  useEffect(() => {
    if (!module || !chapterCount || appliedFor === module) return;
    setCursor(clampCursor(cursorFromLocation(activeBookFile), chapterCount, blockCountOf));
    setAppliedFor(module);
  }, [module, chapterCount, blockCountOf, activeBookFile, appliedFor]);

  return { cursor, select, ready: Boolean(module) && appliedFor === module };
}
