// Seam 2 (data) — the shapes the book packages actually have.
//
// ⛔⛔ CORRECTED BY SLICE A2, 22-09-26 — MEASURED, NOT ASSUMED.
//    Slice A1 modelled a book as `{ chapters: [{ blocks: [...] }] }`. That shape DOES NOT
//    EXIST. Measured on both sides of the wire:
//      · js/app.js `theoryChapters()`  -> tutorialData.sections
//      · js/app.js `theoryBlocks(i)`   -> sections[i].items
//      · js/app.js `loadModuleData`    -> parsedData.tutorialData + parsedData.quizData
//      · app/backend/content.py `_shape()` REFUSES to list a book that has no
//        tutorialData.sections, so every book the library can show has this shape.
//    A provider built on `chapters`/`blocks` renders an empty reader against every real
//    book — type-correct and blank. The names `chapters`/`blocksOf` survive as the
//    PROVIDER's API (state/BookProvider) because they read better; the wire shape is here.
//
// Where a field is optional here it is because it is genuinely absent in at least one live
// book — do not tighten a type to make a component simpler.

/** A visual sub-block: figure, diagram, equation. R6 scope is EVERY visual element. */
export type VisualSubBlockType = 'figure' | 'diagram' | 'equation';

export type SubBlockType =
  | 'text'
  | VisualSubBlockType
  | 'callout'
  | 'deeper'
  | 'code_cells'
  | 'card'
  | 'list';

/**
 * One sub-block inside a theory block. `blocks[]` IS the reading order (ruling R6):
 * a renderer maps it and nothing else. See reader/BlockRenderer.tsx.
 */
export interface SubBlock {
  type: SubBlockType | string;
  title?: string;
  content?: string;
  intro?: string;
  items?: string[];
  bullets?: string[];
  /** Inline SVG markup. Preferred over `src`: no asset file, scales, themeable. */
  svg?: string;
  /** Asset path, resolved relative to the BOOK by data/bookPaths.assetUrl(). */
  src?: string;
  alt?: string;
  caption?: string;
  /** Equation only: the per-symbol explanation rendered under the formula. */
  explain?: string;
  latex?: string;
  /** code_cells only. */
  lesson?: string;
  cells?: CodeCell[];
}

/**
 * R7 (ruling): `language` and `ordinal` are added NOW, in render-only form.
 *
 * No `language` field exists on any of the 4 hand-built cells today. Adding it in
 * Phase 04 would be a migration across 211 cells against a live SQLite store; adding
 * it here is a default. Consumers MUST read `language ?? 'python'` and never assume
 * the field is present on existing data.
 */
export interface CodeCell {
  id: string;
  source: string;
  /** R7: defaults to 'python' when absent. Phase 03 renders; Phase 04 executes. */
  language?: string;
  /** R7: position within the CHAPTER's cell sequence (1-based), not within the block. */
  ordinal?: number;
  /** Ruling R13 — SUPERSEDED by R24 (nothing runs). Kept in the type because the DATA keeps it. */
  runnable?: boolean;
  runnableReason?: string;
}

/** One theory block == one lesson == one screenful in the reader. */
export interface TheoryBlock {
  term?: string;
  blocks?: SubBlock[];
  questions?: QuizQuestion[];
  [key: string]: unknown;
}

/**
 * One chapter. ⛔ Its lessons live under `items`, NOT `blocks` — see the header.
 *
 * ⚠ `items` is heterogeneous: a populated module stores objects ({term, blocks}); older
 * hand-written modules store PLAIN STRINGS. state/BookProvider.blocksOf() wraps the string
 * form, exactly as theoryBlocks() does. Do not assume an object here.
 */
export interface Chapter {
  title: string;
  /** Drives the themed panel-title colour. Resolved by a LOOKUP, never interpolation. */
  themeColor?: string;
  items?: (TheoryBlock | string)[];
  pageStart?: number;
  pageEnd?: number;
  /** "20 theory blocks · pages 70-155" — written by the importer; chapterPages() reads it. */
  note?: string;
  [key: string]: unknown;
}

export interface QuizQuestion {
  question: string;
  options: string[];
  /**
   * An option position (single answer — every existing book) OR a strictly ascending list of
   * >= 2 positions (choose-N, graded as an exact set; see quiz/multiAnswer.ts). 21-10-26.
   */
  correct: number | number[];
  /**
   * ⛔ PER-OPTION, one entry per option — not one string for the question.
   * Measured: handleAnswerSelect reads `currentQ.explanations[index]`, and
   * exerciseSpec builds `explanation: entry.explanations[index]`. A1 typed this as a
   * single `explanation?: string`, which no live question carries.
   */
  explanations?: (string | null)[] | null;
  /** The per-option form flattened for ONE option — what exerciseSpec emits. */
  explanation?: string;
  asset?: SubBlock;
  /**
   * Where this question came from. ⛔ `source.block` is what `practiceQuestionsFor()` filters
   * on (app.js:3093-3096) — without it the quiz picker cannot select a block's questions.
   * MEASURED on the real bank (`geron-homl3/module.json`, 22-09-26): 1550 questions, ALL 1550
   * carry `source`, across 310 distinct `source.block` values at 5 questions each; shape is
   * `{"chapter":1,"block":"ch01-b01","question":"ch01-b01-q1"}`.
   * ⚠ Optional in the TYPE because an AI-generated question carries none.
   */
  source?: { chapter?: number; block?: string; question?: string };
  /**
   * CLIENT-SIDE ONLY, never in a book (exam-recall-suite P1, 22-10-26): set on the copies a
   * REVIEW run is built from — the card's lapse count, so the quiz can tag a leech (lapses >= 6).
   */
  reviewLapses?: number;
}

// ---------------------------------------------------------------- exam-recall-suite P1 (22-10-26)
/** How sure he was BEFORE the options were shown (review runs). Stored in answer_log only. */
export type Confidence = 'sure' | 'unsure' | 'guess';

/** What kind of run an answer came from (answer_log.run_kind). */
export type RunKind = 'quiz' | 'practice' | 'review' | 'exam' | 'retry';

/** An AI-written question, stored WITH its card / flag (no book holds it). */
export interface StoredQuestionBody {
  question: string;
  options: string[];
  correct: number | number[];
  explanations?: (string | null)[] | null;
}

/** GET /api/review/stats?module= */
export interface ReviewStats {
  dueToday: number;
  /** Cards due on each of the next 7 days (index 0 = tomorrow). Wire: [{day, count}]; normalised in queries.ts. */
  next7: number[];
  /** Right-on-first-try % of reviews in the last 30 days, 0..100 (whole number); null = no reviews yet. */
  retention: number | null;
  reviews30?: number;
  total: number;
  leeches: number;
}

/** GET/POST /api/study/prefs (per account + book). */
export interface StudyPrefs {
  newPerDay: number;
  sessionSize: number;
}

/** One flagged question (GET /api/flags?module=). */
export interface FlaggedQuestion {
  question: string;
  body?: StoredQuestionBody | null;
  flaggedAt?: string;
}

// ---------------------------------------------------------------- exam-recall-suite P2 (22-10-26)
// Client-side, NORMALISED shapes (data/queries.ts maps the wire onto these, once).

/** One mastery area: an exam domain when the book has `exam.domains`, else a chapter. */
export interface MasteryArea {
  /** Stable id: the domain id ("D1") or the chapter number as a string ("7"). */
  id: string;
  /** Display name ("Cloud Concepts", "Ch 7 Ensembles"). */
  name: string;
  /** The chapter numbers this area covers (one for a chapter area). */
  chapters: number[];
  right: number;
  answered: number;
  /** right / answered as a whole %, or null when answered < MASTERY_MIN_ANSWERS ("Not enough yet"). */
  pct: number | null;
}

/** GET /api/mastery?module= */
export interface MasteryPayload {
  kind: 'domain' | 'chapter';
  areas: MasteryArea[];
  /** Area id of "Next up" (weakest with >= 5 answers, else the least-practised), or null. */
  nextUp: string | null;
  /** The target %, shown as text beside each bar. */
  target: number;
  /** Answers counted per area (the server's window, 200). */
  window: number;
  /** Fewer answers than this = "Not enough yet". */
  minAnswers: number;
}

export type HistoryFilter = 'all' | 'wrong' | 'flagged';

/**
 * One History row (GET /api/history), normalised. Three sources on the wire: `log` (answer_log),
 * `legacy` (pre-v5 wrong_answers: no key, the question rides in `body`) and `flag` (a flagged question
 * with its last answer, if any).
 */
export interface HistoryItem {
  id: string;
  source: 'log' | 'legacy' | 'flag';
  /** The question key, or null for a legacy row. */
  question: string | null;
  /** What to print: the key, or the legacy question's text. */
  label: string;
  chapter: number | null;
  /** null = never answered (a flag without a logged answer). */
  correct: boolean | null;
  runKind: string | null;
  /** Only a `log` row carries a run id that "Retry wrong" can use. */
  runId: string | null;
  at: string | null;
  body?: StoredQuestionBody | null;
}

export interface HistoryPage {
  items: HistoryItem[];
  /** Pass back as `cursor` for the next page; null = no more. */
  nextCursor: string | null;
  counts: { all: number; wrong: number; flagged: number };
  /** Per run on this page: every logged answer of the run (the ORIGINAL denominator). */
  runs: Record<string, { answered: number; right: number }>;
}

/** The reader's half of a book payload. `sections` is the chapter list. */
export interface TutorialData {
  title?: string;
  moduleId?: string;
  sections?: Chapter[];
  [key: string]: unknown;
}

/** A whole module.json / data/*.json payload, as loadModuleData validates it. */
export interface ModulePayload {
  tutorialData?: TutorialData;
  quizData?: QuizQuestion[];
  moduleId?: string;
  [key: string]: unknown;
}

/**
 * One card in the library grid — the shape of an /api/modules entry, measured against
 * app/backend/content.py `_decorate` / `list_packaged_books` / `list_data_books`.
 *
 * ⚠ `book` / `base` are present ONLY on a packaged book. Their absence is how a legacy
 * data/*.json book is identified — see data/bookPaths.bookUrlFor.
 */
export interface LibraryBook {
  file: string;
  title: string;
  chapters: number;
  lessons: number;
  moduleId: string;
  questions?: number;
  /**
   * Lessons complete. ⛔ NOT a server field — `/api/modules` does not emit it (measured
   * 22-09-26 on :8792 and on the legacy :8767). state/LibraryProvider STAMPS it from the
   * per-book `/api/progress` fan-out, exactly as `loadLibrary` does (app.js:394).
   */
  done?: number;
  /** The module id this book's progress is keyed by. Stamped alongside `done`. */
  progressId?: string;
  default?: boolean;
  renamed?: boolean;
  /** Packaged books only: the folder name, and `book/<folder>/`. */
  book?: string;
  base?: string;
  /** Unix seconds. Both drive librarySortKey — recency first, title last. */
  addedAt?: number;
  lastReadAt?: number;
}

/** Server progress. Phase 03 READS this and never writes it. */
export interface ProgressPayload {
  module?: string;
  completed: Record<string, unknown>;
}

/** Where the reader is. Serialized to the hash as #chapter=N&block=N. */
export interface TheoryCursor {
  chapterIndex: number;
  blockIndex: number;
}

/**
 * ⚠ Kept as an alias so slice-A1 imports of `ModuleData` still resolve. It is the
 * PAYLOAD, not the tutorial half — `data` on BookProvider is the tutorial half.
 */
export type ModuleData = ModulePayload;
