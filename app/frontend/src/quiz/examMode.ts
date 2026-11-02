// exam-recall-suite P3 (22-10-26) — E: the timed mock exam, pure helpers (no React).
//
// ⛔ THE SERVER IS THE CLOCK. A run's deadline is stored server-side (exam_runs.deadline_at); this
//    side only DISPLAYS it. `clockOffsetMs` = server time − this browser's time, measured from the
//    reply that carried the run, so a wrong PC clock cannot add or steal minutes. A reload re-reads
//    the open run and its deadline — nothing about the clock lives only in this tab.
// ⛔ Exam numbers are never invented (plan E7): when the book has an `exam` block the SERVER sends its
//    question count / minutes / pass mark; otherwise the dialog offers editable defaults, labelled as
//    defaults, and there is no scaled score at all.
import type { QuizQuestion } from '../data/types';
import { correctSetOf } from './multiAnswer';

/**
 * Stepper bounds for a "Practice exam" (book without an `exam` block). The DEFAULT numbers and the
 * upper bounds come from the server (Preview.questions / minutes / maxQuestions / maxMinutes —
 * addons/exam_blueprint.py: min(40, pool) q / 60 min, max 200 q / 300 min); these are the step and
 * floor, and the ceiling used only if the server sends none.
 */
export const EXAM_QUESTIONS = { min: 5, max: 200, step: 5 } as const;
export const EXAM_MINUTES = { min: 5, max: 300, step: 5 } as const;

/** Spoken once each, never every second (aria-live polite). */
export const ANNOUNCE_AT_MS = [5 * 60_000, 60_000] as const;

/** One answer as the exam stores it: an option position, or the ticked set of a choose-N question. */
export type ExamChoice = number | number[];

/** What kind of run this is, as the server snapshotted it at start (Run.mode / name / total / minutes). */
export interface ExamBlueprint {
  /** 'exam' = from the book's `exam` block; 'practice' = a "Practice exam" on editable defaults. */
  mode: 'exam' | 'practice';
  name: string | null;
  questions: number;
  minutes: number;
}

/** The client's picture of one exam run (normalised from the wire in data/queries.ts). */
export interface ExamRun {
  id: string;
  moduleId: string;
  /** Epoch ms, SERVER clock. */
  deadlineAt: number;
  /** server now − client now, measured on the reply that carried this run. */
  clockOffsetMs: number;
  /** The questions, in exam order (book keys: `source.question`). */
  questionKeys: string[];
  /** Keyed by question key. */
  answers: Record<string, ExamChoice>;
  flags: string[];
  finished: boolean;
  /** Set once finished. */
  result: ExamResultData | null;
  blueprint: ExamBlueprint;
}

export interface ExamAreaResult {
  id: string;
  name: string;
  right: number;
  total: number;
}

export interface ExamResultData {
  right: number;
  total: number;
  /** Present ONLY when the server sent it (book with `exam.passScaled`). Always shown as "Estimate". */
  scaled: number | null;
  passScaled: number | null;
  scale: [number, number] | null;
  /** The server's pass / below verdict on the ESTIMATE, or null. */
  passed: boolean | null;
  areas: ExamAreaResult[];
  /** Keys answered wrong OR left unanswered, in exam order. */
  missed: string[];
  /** The missed keys that were left unanswered (shown as "Skipped"). */
  unanswered: string[];
}

/** What the Practice dialog's Exam row shows before a run (server: exam_blueprint.preview). */
export interface ExamPreview {
  /** 'exam' = the book's own `exam` block (numbers fixed); 'practice' = editable defaults. */
  mode: 'exam' | 'practice';
  name: string | null;
  questions: number;
  minutes: number;
  /** True = the numbers are UI defaults, not exam facts. */
  isDefault: boolean;
  poolSize: number;
  /** Upper bounds for the editable defaults (practice mode only). */
  maxQuestions: number | null;
  maxMinutes: number | null;
  /** The book gives a pass mark → a scaled ESTIMATE will be shown. */
  hasScaled: boolean;
}

/** Milliseconds left on the server clock (never negative). */
export function remainingMs(run: Pick<ExamRun, 'deadlineAt' | 'clockOffsetMs'>, now: number = Date.now()): number {
  return Math.max(0, run.deadlineAt - (now + run.clockOffsetMs));
}

/** 41:07, or 1:12:05 from an hour up. */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** "41 minutes left" — the timer's accessible name (spoken when focused, not every second). */
export function spokenClock(ms: number): string {
  const minutes = Math.ceil(Math.max(0, ms) / 60_000);
  if (minutes <= 1) return ms <= 0 ? 'Time is up' : 'Under a minute left';
  return `${minutes} minutes left`;
}

/**
 * The announcement owed when the clock passes 5 min or 1 min (once each), else null.
 * `prev` / `next` are remaining ms at the previous and the current tick.
 */
export function crossedThreshold(prev: number, next: number): string | null {
  for (const at of ANNOUNCE_AT_MS) {
    if (prev > at && next <= at) return at >= 120_000 ? `${Math.round(at / 60_000)} minutes left` : '1 minute left';
  }
  return null;
}

/** Is this choice a complete answer to the question? (choose-N: every box ticked.) */
export function isComplete(question: QuizQuestion | undefined, choice: ExamChoice | undefined): boolean {
  if (choice === undefined || choice === null) return false;
  const set = correctSetOf(question);
  if (set) return Array.isArray(choice) && choice.length === set.length;
  return typeof choice === 'number' && Number.isInteger(choice);
}

export interface ExamCounts {
  total: number;
  answered: number;
  unanswered: number;
  flagged: number;
}

export function examCounts(run: Pick<ExamRun, 'questionKeys' | 'answers' | 'flags'>, byKey: Map<string, QuizQuestion>): ExamCounts {
  const total = run.questionKeys.length;
  const answered = run.questionKeys.filter((key) => isComplete(byKey.get(key), run.answers[key])).length;
  const flagSet = new Set(run.flags);
  return { total, answered, unanswered: total - answered, flagged: run.questionKeys.filter((k) => flagSet.has(k)).length };
}

/** "3 unanswered · 2 flagged" — the Submit dialog's body. */
export function submitSummary(counts: ExamCounts): string {
  const parts = [
    counts.unanswered ? `${counts.unanswered} unanswered` : 'All answered',
    counts.flagged ? `${counts.flagged} flagged` : '',
  ].filter(Boolean);
  return `${parts.join(' · ')}.`;
}

/** The bank questions for a run's keys, in exam order; keys the open book no longer holds are reported. */
export function examQuestions(bank: QuizQuestion[], keys: string[]): { questions: QuizQuestion[]; missing: string[] } {
  const byKey = new Map<string, QuizQuestion>();
  for (const question of bank) if (question?.source?.question) byKey.set(question.source.question, question);
  const questions: QuizQuestion[] = [];
  const missing: string[] = [];
  for (const key of keys) {
    const question = byKey.get(key);
    if (question) questions.push(question);
    else missing.push(key);
  }
  return { questions, missing };
}

/** Whole % (0 when total is 0). */
export function pctOf(right: number, total: number): number {
  return total > 0 ? Math.round((right / total) * 100) : 0;
}

/** "CLF-C02" for a book exam, "Practice exam" otherwise — the run's caption. */
export function examTitle(blueprint: Pick<ExamBlueprint, 'mode' | 'name'>): string {
  return blueprint.mode === 'exam' && blueprint.name ? blueprint.name : 'Practice exam';
}
