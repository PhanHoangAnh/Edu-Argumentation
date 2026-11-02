// Multi-answer questions (21-10-26, requested for the AWS CLF-C02 module; user-approved).
//
// CONTRACT: `question.correct` is an integer (one right option — every existing book) OR a
// strictly ascending list of >= 2 distinct option positions (choose-N). Grading a list is an
// EXACT SET match: no partial credit, the way the real exam marks it.
//
// Pure functions, no React, so the rule has one home and one unit check
// (gates/gate-multi-answer.mjs). The SERVER repeats the same validation for rooms and for the
// wrong-answer write: never trust the client's idea of "correct".
import type { QuizQuestion } from '../data/types';

/** The correct positions of a choose-N question, or null for a single-answer question. */
export function correctSetOf(question: Pick<QuizQuestion, 'correct' | 'options'> | undefined | null): number[] | null {
  const correct = question?.correct;
  if (!Array.isArray(correct) || correct.length < 2) return null;
  const size = question?.options?.length ?? 0;
  const ok =
    correct.every((v, i) => Number.isInteger(v) && v >= 0 && v < size && (i === 0 || v > correct[i - 1]));
  return ok ? (correct as number[]) : null;
}

/** True when `picked` is exactly the correct set (order-insensitive). */
export function sameSet(picked: readonly number[], correct: readonly number[]): boolean {
  if (picked.length !== correct.length) return false;
  const a = [...picked].sort((x, y) => x - y);
  const b = [...correct].sort((x, y) => x - y);
  return a.every((v, i) => v === b[i]);
}

/** Is option `index` one of the right answers? Works for both shapes. */
export function isRightOption(question: Pick<QuizQuestion, 'correct' | 'options'> | undefined | null, index: number): boolean {
  const set = correctSetOf(question);
  return set ? set.includes(index) : index === question?.correct;
}
