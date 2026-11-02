// Seam 18 (exercises), part 1 — WHAT COUNTS AS AN EXERCISE BLOCK.
//
// PORTED FROM (by symbol, app.js): EXERCISE_TERM, exerciseSpec, currentExerciseSpec.
//
// Two shapes, in this order — the order matters, because the legacy callout shape is
// still what the importer writes for most books and would shadow the authored one:
//   1. AUTHORED — a sub-block carrying `exercises: [{n, prompt, options, correct,
//      explanations}]`. Supports multiple choice.
//   2. LEGACY — a `callout` of plain `items` strings. Write-mode only.
//
// `intro` is every OTHER sub-block in the lesson. It renders ABOVE the panel, through
// the same BlockRenderer, so R6 ordering holds inside an exercise lesson too.
import type { SubBlock, TheoryBlock } from '../data/types';

const EXERCISE_TERM = /exercise/i;

export interface ExerciseEntry {
  n: number;
  prompt: string;
  options: string[] | null;
  correct: number | null;
  explanations?: string[] | null;
}

export interface ExerciseSpec {
  list: ExerciseEntry[];
  intro: SubBlock[];
  title?: string;
}

export function exerciseSpec(item: TheoryBlock | undefined): ExerciseSpec | null {
  if (!item || !EXERCISE_TERM.test(item.term ?? '')) return null;
  const blocks: SubBlock[] = Array.isArray(item.blocks) ? (item.blocks as SubBlock[]) : [];

  // `exercises` is not on SubBlock because only the authored shape carries it; the cast
  // goes through `unknown` deliberately rather than widening the shared type.
  const authored = blocks.find((sub) => {
    const candidate = sub as unknown as { exercises?: unknown };
    return sub && Array.isArray(candidate.exercises) && candidate.exercises.length > 0;
  }) as unknown as (SubBlock & { exercises: Record<string, unknown>[] }) | undefined;

  if (authored) {
    const list: ExerciseEntry[] = authored.exercises
      .map((entry, index) => ({
        n: Number(entry.n) || index + 1,
        prompt: String(entry.prompt ?? entry.question ?? ''),
        options: Array.isArray(entry.options) ? (entry.options as string[]) : null,
        correct: Number.isInteger(entry.correct) ? (entry.correct as number) : null,
        explanations: Array.isArray(entry.explanations) ? (entry.explanations as string[]) : null,
      }))
      .filter((entry) => entry.prompt);
    if (list.length) {
      return { list, intro: blocks.filter((sub) => sub !== authored), title: authored.title };
    }
  }

  const callout = blocks.find(
    (sub) => sub && sub.type === 'callout' && Array.isArray(sub.items) && sub.items.length > 0,
  );
  if (!callout) return null;
  return {
    list: (callout.items ?? []).map((text, index) => ({
      n: index + 1,
      prompt: String(text),
      options: null,
      correct: null,
    })),
    intro: blocks.filter((sub) => sub !== callout),
    title: callout.title,
  };
}
