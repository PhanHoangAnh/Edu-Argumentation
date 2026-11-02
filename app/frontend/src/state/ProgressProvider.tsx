// Seam 7 (state/ProgressProvider) — READ-ONLY PROGRESS. One of the four contexts (A2).
//
// ⛔ PHASE 03 NEVER WRITES. progress.json must be byte-identical before and after a full
//    browse, and the build must be INCAPABLE of writing, not merely observed not to.
//    There is no queuePendingProgress, no postProgress, no flushPendingProgress here —
//    those are Phase 04 and they land in a NEW module so the bundle grep stays honest.
//
// ⚠ The legacy app flushes a localStorage queue (`eduPendingProgress`) on
//   DOMContentLoaded. That key MUST NOT be read or written by this build: the exit gate
//   seeds it before page load precisely so a write path cannot hide behind an empty
//   queue. If you find yourself needing it here, you are writing Phase 04 code.
//
// PORTED FROM (by symbol, app.js): progress, refreshProgress, isBlockComplete,
// chapterProgress, overallProgress, theoryBlockId.
import { createContext, useContext, useMemo } from 'react';
import type { ReactNode } from 'react';
import { useProgress } from '../data/queries';
import { useBookContext } from './BookProvider';

export interface ProgressSummary {
  done: number;
  total: number;
  percent: number;
}

interface ProgressContextValue {
  /**
   * ⚑ A2: the VALUE is an object, not a boolean — store.py:93 returns
   * `{"ch01-b03": {...}}` and the legacy code only ever tests it with Boolean()
   * (app.js:1076). Typing it `boolean` was A1 guessing at a shape it had not measured;
   * anything that starts reading `completed[id] === true` will be wrong against real data.
   */
  completed: Record<string, unknown>;
  blockIdOf: (chapterIndex: number, blockIndex: number) => string;
  isBlockComplete: (chapterIndex: number, blockIndex: number) => boolean;
  chapterProgress: (chapterIndex: number) => ProgressSummary;
  overall: () => ProgressSummary;
}

const ProgressContext = createContext<ProgressContextValue | null>(null);

/** theoryBlockId — positional, and therefore only unique WITHIN a module. */
export function theoryBlockId(chapterIndex: number, blockIndex: number): string {
  return `ch${String(chapterIndex + 1).padStart(2, '0')}-b${String(blockIndex + 1).padStart(2, '0')}`;
}

export function ProgressProvider({ children }: { children: ReactNode }) {
  const { moduleId, chapters, blocksOf } = useBookContext();
  const { data } = useProgress(moduleId);

  const value = useMemo<ProgressContextValue>(() => {
    const completed = data?.completed ?? {};
    const isBlockComplete = (chapterIndex: number, blockIndex: number) =>
      Boolean(completed[theoryBlockId(chapterIndex, blockIndex)]);
    const chapterProgress = (chapterIndex: number): ProgressSummary => {
      const total = blocksOf(chapterIndex).length;
      let done = 0;
      for (let index = 0; index < total; index += 1) {
        if (isBlockComplete(chapterIndex, index)) done += 1;
      }
      return { done, total, percent: total ? Math.round((done / total) * 100) : 0 };
    };
    const overall = (): ProgressSummary => {
      let done = 0;
      let total = 0;
      chapters.forEach((_chapter, index) => {
        const summary = chapterProgress(index);
        done += summary.done;
        total += summary.total;
      });
      return { done, total, percent: total ? Math.round((done / total) * 100) : 0 };
    };
    return { completed, blockIdOf: theoryBlockId, isBlockComplete, chapterProgress, overall };
  }, [data, chapters, blocksOf]);

  return <ProgressContext.Provider value={value}>{children}</ProgressContext.Provider>;
}

export function useProgressContext(): ProgressContextValue {
  const value = useContext(ProgressContext);
  if (!value) throw new Error('useProgressContext must be used inside <ProgressProvider>');
  return value;
}
