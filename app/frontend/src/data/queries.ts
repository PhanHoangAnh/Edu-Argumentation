// Seam 3 (data/queries) — TanStack Query hooks, one per read route. THE SERVER-CACHE HALF
// OF A2: every global whose value comes from the server lives here, not in a context.
//
// NO STATE LIBRARY (ruling): server state lives here, client-only state becomes a React
// context under state/. The split is the whole reason this file exists — see A2.
//
// The six read routes are the Phase-02 FROZEN contract. Do not add a seventh here; a new
// route is a contract change, and gates/gate-routes.mjs pins the sorted route NAME LIST
// (sha bdd9eef3…), so a rename reads as a ported route without it.
//   GET /api/health · /api/general · /api/modules · /api/progress?module= ·
//   /api/provider · /api/settings
//
// ⛔⛔ CORRECTED BY SLICE A2, 22-09-26 — three wire shapes were wrong in A1 and each one
//    fails SILENTLY (type-correct, empty UI):
//      1. /api/modules returns {"books": [...]}, NOT a bare array (main.py:115). A1 typed it
//         as LibraryBook[], so LibraryProvider's `Array.isArray(data)` was ALWAYS false and
//         the grid rendered empty forever.
//      2. /api/general returns snake_case ai_question_count / fresh_quiz_size /
//         require_access_token (store.py:40-44). A1 named them aiQuestionCount /
//         generatedQuizSize, which no response carries.
//      3. /api/provider returns ready / model / token_required / admin_required
//         (main.py:129). A1 named token_required `requireToken`.
//
// ⛔ libraryOrder IS NOT DERIVED HERE (A2c). It is held by state/LibraryProvider, seeded
//    ONCE from the first successful useModules() result behind a hasSeeded ref. Deriving
//    it in a `select` or a useMemo over query data makes the grid reshuffle under the
//    cursor on every refetch — and `staleTime: Infinity` is NOT the fix, it just hides
//    the reshuffle and blocks the Phase 04 refetch. ⛔ There is no staleTime in this file.

import { useInfiniteQuery, useQueries, useQuery } from '@tanstack/react-query';
import { getJson } from './client';
import type { ExamAreaResult, ExamChoice, ExamPreview, ExamResultData, ExamRun } from '../quiz/examMode';
import type { FlaggedQuestion, HistoryFilter, HistoryItem, HistoryPage, MasteryArea, MasteryPayload, LibraryBook, ModulePayload, ProgressPayload, ReviewStats, StoredQuestionBody, StudyPrefs } from './types';

/** /api/general, verbatim on the wire. Globals #22 GENERATED_QUIZ_SIZE and #23 aiQuestionCount. */
export interface GeneralSettings {
  ai_question_count?: number;
  fresh_quiz_size?: number;
  require_access_token?: boolean;
}

/** /api/provider, verbatim. Globals #24-#27 (providerReady/TokenRequired/Model + unknown). */
export interface ProviderStatus {
  ready?: boolean;
  model?: string | null;
  token_required?: boolean;
  admin_required?: boolean;
}

export interface SettingsPayload {
  api_url?: string;
  model?: string;
  json_mode?: boolean;
  api_key_set?: boolean;
  access_token_set?: boolean;
  ready?: boolean;
  general?: GeneralSettings;
  admin_required?: boolean;
}

/** The legacy defaults, which stand until the server overrides them (app.js:80-81). */
export const GENERAL_DEFAULTS = { aiQuestionCount: 5, generatedQuizSize: 20 } as const;
/** MAX_FRESH_QUIZ_SIZE (app.js:82) — a constant, not state. The server enforces the same cap. */
export const MAX_FRESH_QUIZ_SIZE = 30;

export const queryKeys = {
  modules: ['modules'] as const,
  general: ['general'] as const,
  provider: ['provider'] as const,
  settings: ['settings'] as const,
  progress: (moduleId: string) => ['progress', moduleId] as const,
  book: (file: string) => ['book', file] as const,
};

export function useModules() {
  return useQuery({
    queryKey: queryKeys.modules,
    // ⛔ The envelope is unwrapped HERE, once, so no consumer can forget it.
    queryFn: async ({ signal }) => {
      const payload = await getJson<{ books?: LibraryBook[] }>('/api/modules', signal);
      return Array.isArray(payload?.books) ? payload.books : [];
    },
  });
}

/** /api/review/due — the cards due now for this account in one module (spaced repetition, 21-10-26). */
export interface ReviewDue {
  /** `body` (22-10-26): present only on an AI-written card — the question itself, stored with it. */
  due: { question: string; dueAt: string; reps: number; lapses: number; body?: StoredQuestionBody | null }[];
  dueCount: number;
  total: number;
}

/** Session size bounds (exam-recall-suite A4): 10..50, step 5, default 20. */
export const SESSION_SIZE = { min: 10, max: 50, step: 5, fallback: 20 } as const;
/** New cards per day per book (A2/D2): 0..200, default 20. */
export const NEW_PER_DAY = { min: 0, max: 200, step: 5, fallback: 20 } as const;

export function clampStep(value: unknown, bounds: { min: number; max: number; step: number; fallback: number }): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return bounds.fallback;
  const stepped = bounds.min + Math.round((n - bounds.min) / bounds.step) * bounds.step;
  return Math.min(bounds.max, Math.max(bounds.min, stepped));
}

export function useReviewDue(moduleId: string, enabled: boolean, limit: number = SESSION_SIZE.fallback) {
  const size = clampStep(limit, SESSION_SIZE);
  return useQuery({
    queryKey: ['review-due', moduleId, size] as const,
    enabled: enabled && Boolean(moduleId),
    staleTime: 0,
    retry: 0,
    queryFn: ({ signal }) => getJson<ReviewDue>(`/api/review/due?module=${encodeURIComponent(moduleId)}&limit=${size}`, signal),
  });
}

/** /api/review/due-blocks (01-11-26): cards due now per block; "other" = cards with no book key. */
export interface ReviewDueBlocks {
  blocks: { block: string; due: number }[];
  dueCount: number;
  total: number;
}

export function useReviewDueBlocks(moduleId: string, enabled: boolean, refetchMs?: number) {
  return useQuery({
    queryKey: ['review-due-blocks', moduleId] as const,
    enabled: enabled && Boolean(moduleId),
    staleTime: 0,
    retry: 0,
    refetchInterval: refetchMs,
    queryFn: ({ signal }) => getJson<ReviewDueBlocks>(`/api/review/due-blocks?module=${encodeURIComponent(moduleId)}`, signal),
  });
}

/** /api/review/due-in (01-11-26): the due cards of some blocks (one chapter), oldest first, at most
 *  `limit` — the number he typed (1..500 on the server), not the 10-50 run size. */
export function fetchReviewDueIn(moduleId: string, blocks: string[], limit: number): Promise<ReviewDue> {
  const query = `module=${encodeURIComponent(moduleId)}&blocks=${encodeURIComponent(blocks.join(','))}&limit=${Math.max(1, Math.round(limit))}`;
  return getJson<ReviewDue>(`/api/review/due-in?${query}`);
}

// ---------------------------------------------------------------- exam-recall-suite P1 (22-10-26)
// Each read below is OPTIONAL to the screen that uses it: a failed call (or a server that predates
// it) hides the panel — it never blocks Practice. retry: 0 for the same reason as useReviewDue.

/** GET /api/review/stats — due today, the next 7 days, retention, cards, leeches. */
export function useReviewStats(moduleId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['review-stats', moduleId] as const,
    enabled: enabled && Boolean(moduleId),
    staleTime: 0,
    retry: 0,
    queryFn: async ({ signal }): Promise<ReviewStats> => {
      // Wire (addons/study_more.py -> store.review_stats): next7 = [{day, count}] x 7, retention = whole %.
      const raw = await getJson<Omit<Partial<ReviewStats>, 'next7'> & { next7?: unknown[] }>(
        `/api/review/stats?module=${encodeURIComponent(moduleId)}`,
        signal,
      );
      const next7 = Array.isArray(raw?.next7)
        ? raw.next7.slice(0, 7).map((d) => Math.max(0, Number(typeof d === 'object' && d ? (d as { count?: unknown }).count : d) || 0))
        : [];
      while (next7.length < 7) next7.push(0);
      const r = raw?.retention;
      const retention = r === null || r === undefined || !Number.isFinite(Number(r)) ? null : Math.min(100, Math.max(0, Math.round(Number(r))));
      return {
        dueToday: Math.max(0, Number(raw?.dueToday) || 0),
        next7,
        retention,
        reviews30: Number(raw?.reviews30) || 0,
        total: Math.max(0, Number(raw?.total) || 0),
        leeches: Math.max(0, Number(raw?.leeches) || 0),
      };
    },
  });
}

/** GET /api/study/prefs — new-card cap and session size for this book. Defaults stand on failure. */
export function usePrefs(moduleId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['study-prefs', moduleId] as const,
    enabled: enabled && Boolean(moduleId),
    retry: 0,
    queryFn: async ({ signal }): Promise<StudyPrefs> => {
      const raw = await getJson<Partial<StudyPrefs>>(`/api/study/prefs?module=${encodeURIComponent(moduleId)}`, signal);
      return { newPerDay: clampStep(raw?.newPerDay, NEW_PER_DAY), sessionSize: clampStep(raw?.sessionSize, SESSION_SIZE) };
    },
  });
}

export const flagsKey = (moduleId: string) => ['flags', moduleId] as const;

/** GET /api/flags — this book's flagged questions (key, plus the body for an AI-written one). */
export function useFlags(moduleId: string, enabled: boolean) {
  return useQuery({
    queryKey: flagsKey(moduleId),
    enabled: enabled && Boolean(moduleId),
    retry: 0,
    queryFn: async ({ signal }): Promise<FlaggedQuestion[]> => {
      const raw = await getJson<{ flags?: FlaggedQuestion[] }>(`/api/flags?module=${encodeURIComponent(moduleId)}`, signal);
      return Array.isArray(raw?.flags) ? raw.flags.filter((f) => f && typeof f.question === 'string') : [];
    },
  });
}

// ---------------------------------------------------------------- exam-recall-suite P2 (22-10-26)
// Wire: addons/history.py (store.history_page / store.mastery). Mapped onto the client shapes in
// data/types.ts HERE, once. A failed read shows an error line in the panel; it never blocks a screen.

const num = (v: unknown, fallback = 0) => (Number.isFinite(Number(v)) ? Number(v) : fallback);
const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

/** GET /api/mastery?module= — per-area mastery + "Next up". */
export function useMastery(moduleId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['mastery', moduleId] as const,
    enabled: enabled && Boolean(moduleId),
    staleTime: 0,
    retry: 0,
    queryFn: async ({ signal }): Promise<MasteryPayload> => {
      const raw = await getJson<Record<string, unknown>>(`/api/mastery?module=${encodeURIComponent(moduleId)}`, signal);
      const minAnswers = Math.max(1, num(raw?.minAnswers, 5));
      const areas: MasteryArea[] = (Array.isArray(raw?.areas) ? raw.areas : [])
        .filter((a): a is Record<string, unknown> => Boolean(a) && typeof a === 'object' && a.id != null)
        .map((a) => {
          const answered = Math.max(0, num(a.answered));
          const enough = a.enough === undefined ? answered >= minAnswers : Boolean(a.enough);
          const pct = enough && a.pct !== null && a.pct !== undefined ? Math.min(100, Math.max(0, Math.round(num(a.pct)))) : null;
          return {
            id: String(a.id),
            name: str(a.name) ?? String(a.id),
            chapters: (Array.isArray(a.chapters) ? a.chapters : []).map((c) => num(c, NaN)).filter(Number.isInteger),
            right: Math.max(0, num(a.right)),
            answered,
            pct,
          };
        });
      const next = raw?.nextUp as { id?: unknown } | null | undefined;
      return {
        kind: raw?.areaKind === 'domain' ? 'domain' : 'chapter',
        areas,
        nextUp: next && next.id != null ? String(next.id) : null,
        target: num(raw?.target, 80),
        window: num(raw?.window, 200),
        minAnswers,
      };
    },
  });
}

function historyItem(r: Record<string, unknown>): HistoryItem {
  const source = r.source === 'legacy' || r.source === 'flag' ? r.source : 'log';
  const body = r.body && typeof r.body === 'object' ? (r.body as StoredQuestionBody) : null;
  const key = str(r.question);
  const correct = source === 'flag' ? (typeof r.lastCorrect === 'boolean' ? r.lastCorrect : null) : typeof r.correct === 'boolean' ? r.correct : null;
  return {
    id: String(r.id ?? ''),
    source,
    question: key,
    label: key ?? (typeof body?.question === 'string' ? body.question : '(question)'),
    chapter: Number.isInteger(Number(r.chapter)) && r.chapter !== null ? Number(r.chapter) : null,
    correct,
    runKind: source === 'flag' ? 'flag' : str(r.runKind),
    runId: source === 'log' ? str(r.runId) : null,
    at: str(source === 'flag' ? r.lastAt ?? r.flaggedAt : r.at),
    body,
  };
}

/** One History page. `area` = {chapter} or {domain}; `cursor` from the previous page's nextCursor. */
export async function fetchHistoryPage(
  moduleId: string,
  filter: HistoryFilter,
  area: { chapter?: number; domain?: string } | null,
  cursor: string | null,
  signal?: AbortSignal,
): Promise<HistoryPage> {
  const q = new URLSearchParams({ module: moduleId, filter });
  if (area?.domain) q.set('domain', area.domain);
  else if (area?.chapter !== undefined) q.set('chapter', String(area.chapter));
  if (cursor) q.set('cursor', cursor);
  const raw = await getJson<Record<string, unknown>>(`/api/history?${q.toString()}`, signal);
  const counts = (raw?.counts ?? {}) as Record<string, unknown>;
  const runsRaw = (raw?.runs && typeof raw.runs === 'object' ? raw.runs : {}) as Record<string, { answered?: unknown; right?: unknown }>;
  const runs: HistoryPage['runs'] = {};
  for (const [id, r] of Object.entries(runsRaw)) runs[id] = { answered: Math.max(0, num(r?.answered)), right: Math.max(0, num(r?.right)) };
  return {
    items: (Array.isArray(raw?.items) ? raw.items : [])
      .filter((r): r is Record<string, unknown> => Boolean(r) && typeof r === 'object')
      .map(historyItem),
    nextCursor: str(raw?.nextCursor),
    counts: { all: num(counts.all), wrong: num(counts.wrong), flagged: num(counts.flagged) },
    runs,
  };
}

/** GET /api/history, paged ("Show more" appends the next page). */
export function useHistory(moduleId: string, filter: HistoryFilter, area: { chapter?: number; domain?: string } | null, enabled: boolean) {
  return useInfiniteQuery({
    queryKey: ['history', moduleId, filter, area?.domain ?? '', area?.chapter ?? ''] as const,
    enabled: enabled && Boolean(moduleId),
    staleTime: 0,
    retry: 0,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) => fetchHistoryPage(moduleId, filter, area, pageParam, signal),
    getNextPageParam: (last) => last.nextCursor,
  });
}

// ---------------------------------------------------------------- exam-recall-suite P3 (22-10-26)
// Wire: addons/exam.py (header = the contract). Normalised HERE, once, onto quiz/examMode.ts shapes.

const isObj = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === 'object' && !Array.isArray(v);

function examChoice(v: unknown): ExamChoice | undefined {
  if (Number.isInteger(v)) return v as number;
  if (Array.isArray(v) && v.length && v.every(Number.isInteger)) return [...(v as number[])].sort((x, y) => x - y);
  return undefined;
}

/** Run -> ExamRun. `receivedAt` = this browser's clock when the reply arrived (the offset's other half). */
export function normaliseExamRun(raw: unknown, receivedAt: number = Date.now()): ExamRun | null {
  if (!isObj(raw) || typeof raw.id !== 'string') return null;
  const deadline = Date.parse(String(raw.deadlineAt ?? ''));
  const serverNow = Date.parse(String(raw.serverNow ?? ''));
  const remaining = num(raw.remainingSeconds, NaN);
  // The server is the clock: deadline vs serverNow; else remainingSeconds counted from arrival.
  let deadlineAt: number;
  let clockOffsetMs: number;
  if (Number.isFinite(deadline) && Number.isFinite(serverNow)) {
    deadlineAt = deadline;
    clockOffsetMs = serverNow - receivedAt;
  } else if (Number.isFinite(remaining)) {
    deadlineAt = receivedAt + remaining * 1000;
    clockOffsetMs = 0;
  } else {
    return null;
  }
  const keys = (Array.isArray(raw.questions) ? raw.questions : [])
    .map((q) => (isObj(q) ? str(q.key) : null))
    .filter((k): k is string => Boolean(k));
  const answers: Record<string, ExamChoice> = {};
  if (isObj(raw.answers)) {
    for (const [key, value] of Object.entries(raw.answers)) {
      const choice = examChoice(value);
      if (choice !== undefined) answers[key] = choice;
    }
  }
  return {
    id: raw.id,
    moduleId: str(raw.module) ?? '',
    deadlineAt,
    clockOffsetMs,
    questionKeys: keys,
    answers,
    flags: (Array.isArray(raw.flags) ? raw.flags : []).filter((k): k is string => typeof k === 'string'),
    finished: false,
    result: null,
    blueprint: {
      mode: raw.mode === 'exam' ? 'exam' : 'practice',
      name: str(raw.name),
      questions: Math.max(0, num(raw.total, keys.length)),
      minutes: Math.max(0, num(raw.minutes)),
    },
  };
}

/** Result -> ExamResultData. ⛔ `scaled` is taken ONLY from the server (never computed here). */
export function normaliseExamResult(raw: unknown): ExamResultData | null {
  if (!isObj(raw)) return null;
  const total = Math.max(0, num(raw.total));
  const questions = (Array.isArray(raw.questions) ? raw.questions : []).filter(isObj);
  const missed: string[] = [];
  const unanswered: string[] = [];
  for (const q of questions) {
    const key = str(q.key);
    if (!key || q.right === true) continue;
    missed.push(key);
    if (q.chosen === null || q.chosen === undefined) unanswered.push(key);
  }
  const areas: ExamAreaResult[] = (Array.isArray(raw.areas) ? raw.areas : [])
    .filter(isObj)
    .filter((a) => a.id !== undefined && a.id !== null)
    .map((a) => ({ id: String(a.id), name: str(a.name) ?? String(a.id), right: Math.max(0, num(a.right)), total: Math.max(0, num(a.total)) }));
  const sc = isObj(raw.scaled) ? raw.scaled : null;
  const estimate = sc ? num(sc.estimate, NaN) : NaN;
  const hasScaled = sc !== null && Number.isFinite(estimate);
  const lo = sc ? num(sc.scaleMin, NaN) : NaN;
  const hi = sc ? num(sc.scaleMax, NaN) : NaN;
  const pass = sc ? num(sc.passScaled, NaN) : NaN;
  return {
    right: Math.max(0, num(raw.right)),
    total,
    scaled: hasScaled ? Math.round(estimate) : null,
    passScaled: hasScaled && Number.isFinite(pass) ? pass : null,
    scale: hasScaled && Number.isFinite(lo) && Number.isFinite(hi) ? [lo, hi] : null,
    passed: hasScaled && typeof sc?.passedEstimate === 'boolean' ? sc.passedEstimate : null,
    areas,
    missed,
    unanswered,
  };
}

/** A finished Result as an ExamRun (to show a past result: "Last result", a 409, Submit's reply). */
export function examRunFromResult(raw: unknown): ExamRun | null {
  const result = normaliseExamResult(raw);
  if (!result || !isObj(raw) || typeof raw.id !== 'string') return null;
  const questions = (Array.isArray(raw.questions) ? raw.questions : []).filter(isObj);
  const answers: Record<string, ExamChoice> = {};
  const flags: string[] = [];
  for (const q of questions) {
    const key = str(q.key);
    if (!key) continue;
    const choice = examChoice(q.chosen);
    if (choice !== undefined) answers[key] = choice;
    if (q.flagged === true) flags.push(key);
  }
  return {
    id: raw.id,
    moduleId: str(raw.module) ?? '',
    deadlineAt: Date.parse(String(raw.deadlineAt ?? '')) || 0,
    clockOffsetMs: 0,
    questionKeys: questions.map((q) => str(q.key)).filter((k): k is string => Boolean(k)),
    answers,
    flags,
    finished: true,
    result,
    blueprint: { mode: raw.mode === 'exam' ? 'exam' : 'practice', name: str(raw.name), questions: result.total, minutes: 0 },
  };
}

function normaliseExamPreview(raw: unknown): ExamPreview | null {
  if (!isObj(raw)) return null;
  const questions = num(raw.questions, NaN);
  const minutes = num(raw.minutes, NaN);
  if (!Number.isFinite(questions) || !Number.isFinite(minutes)) return null;
  const maxQ = num(raw.maxQuestions, NaN);
  const maxM = num(raw.maxMinutes, NaN);
  return {
    mode: raw.mode === 'exam' ? 'exam' : 'practice',
    name: str(raw.name),
    questions,
    minutes,
    isDefault: raw.isDefault !== false,
    poolSize: Math.max(0, num(raw.poolSize)),
    maxQuestions: Number.isFinite(maxQ) ? maxQ : null,
    maxMinutes: Number.isFinite(maxM) ? maxM : null,
    hasScaled: isObj(raw.scaled),
  };
}

export interface ExamOpenState {
  preview: ExamPreview | null;
  run: ExamRun | null;
  /** The newest finished run of this book, as a finished ExamRun (result attached). */
  last: ExamRun | null;
  /** This read found the open run past its deadline and submitted it (`last` is that run). */
  expiredNow: boolean;
}

export const examOpenKey = (moduleId: string) => ['exam-open', moduleId] as const;

/** GET /api/exam/open — the Exam row's preview, the open run (resume) and the last result. */
export function useExamOpen(moduleId: string, enabled: boolean) {
  return useQuery({
    queryKey: examOpenKey(moduleId),
    enabled: enabled && Boolean(moduleId),
    staleTime: 0,
    retry: 0,
    queryFn: async ({ signal }): Promise<ExamOpenState> => {
      const raw = await getJson<Record<string, unknown>>(`/api/exam/open?module=${encodeURIComponent(moduleId)}`, signal);
      const receivedAt = Date.now();
      return {
        preview: normaliseExamPreview(raw?.preview),
        run: raw?.run ? normaliseExamRun(raw.run, receivedAt) : null,
        last: raw?.last ? examRunFromResult(raw.last) : null,
        expiredNow: raw?.expiredNow === true,
      };
    },
  });
}

export function useGeneralSettings() {
  return useQuery({
    queryKey: queryKeys.general,
    queryFn: ({ signal }) => getJson<GeneralSettings>('/api/general', signal),
  });
}

export function useProviderStatus() {
  return useQuery({
    queryKey: queryKeys.provider,
    queryFn: ({ signal }) => getJson<ProviderStatus>('/api/provider', signal),
  });
}

export function useSettings() {
  return useQuery({
    queryKey: queryKeys.settings,
    queryFn: ({ signal }) => getJson<SettingsPayload>('/api/settings', signal),
  });
}

/**
 * Globals #22/#23, DERIVED — never stored.
 * ⚠ Only a POSITIVE number overrides the default (app.js:3481-3482). A server that answers
 * 0 or null keeps the default, which is why this is not a `??`.
 */
export function useQuizSizing() {
  const { data } = useGeneralSettings();
  const fresh = Number(data?.fresh_quiz_size);
  const ai = Number(data?.ai_question_count);
  return {
    generatedQuizSize: fresh > 0 ? fresh : GENERAL_DEFAULTS.generatedQuizSize,
    aiQuestionCount: ai > 0 ? ai : GENERAL_DEFAULTS.aiQuestionCount,
    maxFreshQuizSize: MAX_FRESH_QUIZ_SIZE,
  };
}

/**
 * Globals #24-#27, DERIVED — never stored.
 *
 * ⛔ `statusUnknown` is the ERROR state, and it is NOT the same as "not ready": the legacy
 * code sets providerReady=false AND providerStatusUnknown=true only in the catch
 * (app.js:3350-3353). Collapsing the two tells the reader "no model is connected" when the
 * truth is "we could not ask". ⚠ Phase 03 is expected to read ready=false honestly —
 * :8792 carries no credential by construction (R-SEP4).
 */
export function useProviderReadiness() {
  const { data, isError } = useProviderStatus();
  return {
    ready: !isError && Boolean(data?.ready),
    statusUnknown: isError,
    tokenRequired: isError ? true : Boolean(data?.token_required),
    model: data?.model ?? '',
  };
}

/** Progress is READ-ONLY in Phase 03. The write lands in Phase 04, in its own module. */
export function useProgress(moduleId: string) {
  return useQuery({
    queryKey: queryKeys.progress(moduleId),
    queryFn: ({ signal }) =>
      getJson<ProgressPayload>(`/api/progress?module=${encodeURIComponent(moduleId)}`, signal),
    enabled: Boolean(moduleId),
  });
}

/**
 * EVERY book's completion count, one request per book — `loadLibrary`'s progress fan-out
 * (app.js:387-396), ported 22-09-26 (EVL fix 003).
 *
 * ⛔⛔ THIS WAS NEVER PORTED, AND THAT IS WHY THE HOME KPIs CONTRADICTED THE ROWS BENEATH THEM.
 *     MEASURED on the live server 22-09-26: `/api/modules` carries `file/title/chapters/
 *     lessons/questions/addedAt/lastReadAt` and **NO `done` KEY AT ALL** — on `:8792` and on
 *     the legacy `:8767` alike. `renderHomeKpis` reads `Number(book.done) || 0`, so without
 *     this fan-out every book scores 0 and the panel reported
 *         LESSONS DONE 0 · of 414 · 0%   ·   BOOKS 2 — none started yet
 *     while the current-book line two elements above said `18 / 310 lessons done` and the
 *     card below said `18/310 lessons · 6%`. Both of those read LIVE progress for the OPEN
 *     book; only the KPI panel needs every book, and only it was missing its source.
 *     ⛔ The KPI arithmetic (now library/LibraryScreen HomeKpis) was ported VERBATIM and is CORRECT. Do not
 *        "fix" the KPIs by changing that maths — the input was empty, not the formula.
 *
 * ⛔ READ-ONLY. GET only, no body, no write. Phase 03's whole claim is that `progress.json`
 *    is byte-identical across a full browse, and N more GETs cannot threaten that.
 * ⚠ The id rule is the legacy's, verbatim: a book's own `moduleId` UNLESS it is a transient
 *   `t-` id, in which case fall back to the filename. A `t-` id is not a progress key.
 * ⚠ The query key is `queryKeys.progress(id)` — deliberately the SAME key `useProgress` uses
 *   for the open book, so the two share one cache entry instead of racing two.
 */
export function useLibraryProgressCounts(moduleIds: string[]): Record<string, number> {
  const results = useQueries({
    queries: moduleIds.map((id) => ({
      queryKey: queryKeys.progress(id),
      queryFn: ({ signal }: { signal?: AbortSignal }) =>
        getJson<ProgressPayload>(`/api/progress?module=${encodeURIComponent(id)}`, signal),
      enabled: Boolean(id),
    })),
    // ⛔ The combine result must be a PLAIN OBJECT keyed by module id, not the results array:
    //    useQueries returns a NEW array identity on every render, and handing that to a
    //    useMemo dependency list re-runs the library reconcile on every paint.
    combine: (queries: { data?: ProgressPayload }[]) => {
      const counts: Record<string, number> = {};
      queries.forEach((query, index) => {
        const completed = query.data?.completed;
        counts[moduleIds[index]] = completed ? Object.keys(completed).length : 0;
      });
      return counts;
    },
  });
  return results;
}

/**
 * One book's payload — module.json for a packaged book, data/<name>.json for a legacy one.
 * The URL is built by data/bookPaths.bookLocationFor, which knows the difference.
 *
 * ⚠ geron-homl3's module.json is 5.5 MB. Anything that gates on this must wait for real
 * content, never on a fixed timeout — that is how a gate ended up "browsing both books"
 * while one contributed zero chapters.
 */
export function useBook(url: string | null) {
  return useQuery({
    queryKey: queryKeys.book(url ?? ''),
    queryFn: ({ signal }) => getJson<ModulePayload>(url as string, signal),
    enabled: Boolean(url),
  });
}
