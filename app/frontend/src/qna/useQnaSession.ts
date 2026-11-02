// Q&A examiner — session state + server calls (study-rooms-qna P2, 29-09-26).
//
// ⚑ PERSISTED PER ACCOUNT + SCOPE UNTIL "New" (memory in-progress-work-persists-until-new):
//   localStorage `qna:<accountId>:<bookId>:<sortedBlocksHash>` holds the index, the questions
//   already fetched (one model call each, cached here), the answer draft and the last grade.
//   `qna:<accountId>:current` points at the open session so a reload restores it.
// ⛔ Every call goes through data/writes.ts:postJson (gate-r-ro R-RO1: ONE non-GET fetch literal).
// ⛔ Pass is the SERVER's `pass` (raw score > 8). Nothing here rounds or recomputes it, and a pass
//    writes nothing to /api/progress (F23).
import { useCallback, useEffect, useRef, useState } from 'react';
import { postJson } from '../data/writes';

export interface QnaQuestion {
  index: number;
  total: number;
  block: string;
  style?: QnaStyle;
  question: string;
  lessonTitle: string;
}

export interface QnaGrade {
  score: number;
  right: string[];
  almost: string[];
  missing: string[];
  wrong: string[];
  feedback: string;
  pass: boolean;
}

export interface QnaAsk {
  question: string;
  answer: string;
  refused: boolean;
}

// ⚑ P2b (30-09-26, the user's list) ------------------------------------------------------------
export type QnaStyle = 'own' | 'whyhow' | 'compare' | 'apply' | 'mistake';
export type QnaDifficulty = 'easy' | 'normal' | 'hard';

/** The setup. The server builds ONE slot list from it; `seed` is kept here so a reload asks for the
 *  same slot. `passMark`: pass = raw score > passMark, decided by the SERVER. */
export interface QnaOptions {
  perLesson: number;
  count: number;
  styles: QnaStyle[];
  order: 'book' | 'shuffle';
  seed: number;
  difficulty: QnaDifficulty;
  passMark: number;
  hints: boolean;
}

export const DEFAULT_OPTIONS: QnaOptions = {
  perLesson: 1, count: 1, styles: ['own'], order: 'book', seed: 0, difficulty: 'normal', passMark: 8, hints: false,
};

/** A score below this goes on the redo list (user ruling 30-09-26: bad = < 7; pass stays > mark). */
export const WEAK_BELOW = 7;

export interface QnaResult { score: number; pass: boolean }

export interface QnaSession {
  bookId: string;
  /** Sorted theoryBlockId strings. */
  blocks: string[];
  index: number;
  total: number | null;
  questions: Record<string, QnaQuestion>;
  draft: string;
  grade: QnaGrade | null;
  done: boolean;
  askOpen: boolean;
  askDraft: string;
  ask: QnaAsk | null;
  /** P2b. Absent on a session saved before P2b — readSession fills the defaults. */
  options: QnaOptions;
  /** The LATEST graded score per slot index. A retry that reaches >= 7 leaves the redo list. */
  results: Record<string, QnaResult>;
  /** A redo round: the slot indices still to visit AFTER `index`. null = the first round. */
  queue: number[] | null;
  /** Hints already fetched, per slot index (one model call each). */
  hints: Record<string, string>;
}

/** The redo list: slots whose latest score is < WEAK_BELOW, in slot order. */
export function weakSlots(session: QnaSession): number[] {
  return Object.entries(session.results)
    .filter(([, r]) => r.score < WEAK_BELOW)
    .map(([k]) => Number(k))
    .sort((a, b) => a - b);
}

export type QnaBusy = 'question' | 'grade' | 'ask' | 'hint' | null;

/** FNV-1a 32-bit, hex. Stable across reloads; only needs to separate scopes. */
function hash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

export function sortBlocks(blocks: string[]): string[] {
  return [...new Set(blocks)].sort();
}

const pointerKey = (accountId: number) => `qna:${accountId}:current`;
const sessionKey = (accountId: number, bookId: string, blocks: string[]) => `qna:${accountId}:${bookId}:${hash(blocks.join(','))}`;

function readSession(accountId: number): QnaSession | null {
  try {
    const key = localStorage.getItem(pointerKey(accountId));
    if (!key) return null;
    const raw = JSON.parse(localStorage.getItem(key) || 'null');
    if (!raw || typeof raw !== 'object' || typeof raw.bookId !== 'string' || !Array.isArray(raw.blocks)) return null;
    // A session saved before P2b has no options / results / queue / hints.
    return { options: { ...DEFAULT_OPTIONS, count: raw.blocks.length }, results: {}, queue: null, hints: {}, ...raw } as QnaSession;
  } catch {
    return null;
  }
}

function writeSession(accountId: number, session: QnaSession | null, previous: QnaSession | null): void {
  try {
    if (!session) {
      if (previous) localStorage.removeItem(sessionKey(accountId, previous.bookId, previous.blocks));
      localStorage.removeItem(pointerKey(accountId));
      return;
    }
    const key = sessionKey(accountId, session.bookId, session.blocks);
    localStorage.setItem(key, JSON.stringify(session));
    localStorage.setItem(pointerKey(accountId), key);
  } catch {
    /* per-viewer convenience only */
  }
}

/** Plain copy for a failed call. 429 carries the wait. */
async function errorText(response: Response | null, fallback: string): Promise<string> {
  if (!response) return 'Could not reach the server — try again.';
  let body: { error?: string; retryAfter?: number } = {};
  try {
    body = await response.json();
  } catch {
    /* not json */
  }
  if (response.status === 429) {
    const minutes = Math.max(1, Math.ceil((Number(body.retryAfter) || 60) / 60));
    return `Too many requests. Try again in ${minutes} min.`;
  }
  if (response.status === 502 || response.status === 504) return fallback;
  return body.error || fallback;
}

/** null = network error OR cancelled (the caller tells them apart by its AbortSignal). */
async function call(route: '/api/qna/question' | '/api/qna/grade' | '/api/qna/ask' | '/api/qna/hint', body: unknown, signal?: AbortSignal): Promise<Response | null> {
  try {
    return await postJson(route, body, {}, signal);
  } catch {
    return null;
  }
}

const CANCELLED = 'Cancelled.';

/** Which question a failure belongs to: the same scope + index is never auto-fetched again. */
const questionKey = (s: QnaSession) => `${s.bookId}|${s.blocks.join(',')}|${s.options.seed}|${s.index}`;

/** The setup fields every /question call carries (the server rebuilds the same slot list). */
function setupBody(s: QnaSession) {
  const o = s.options;
  return {
    bookId: s.bookId, blocks: s.blocks, index: s.index, count: o.count, perLesson: o.perLesson, styles: o.styles,
    order: o.order, difficulty: o.difficulty, ...(o.order === 'shuffle' ? { seed: o.seed } : {}),
  };
}

export function useQnaSession(accountId: number) {
  const [session, setSessionState] = useState<QnaSession | null>(() => readSession(accountId));
  const [busy, setBusy] = useState<QnaBusy>(null);
  const [error, setError] = useState<string | null>(null);
  const sessionRef = useRef(session);
  sessionRef.current = session;
  // ⚑ 30-09-26 (defect B): the question that last FAILED. The auto-fetch effect below skips it, so
  //   a failure is never retried on its own — only retryQuestion() clears it. Before this, the
  //   hook cleared `busy` and THEN awaited the error text: in that gap busy===null && error===null,
  //   the effect fired again (~2 requests/s) and one Start burned the whole 30-call bucket.
  const failedRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const setSession = useCallback(
    (next: QnaSession | null) => {
      writeSession(accountId, next, sessionRef.current);
      sessionRef.current = next;
      setSessionState(next);
    },
    [accountId],
  );
  const patch = useCallback((change: Partial<QnaSession>) => {
    const current = sessionRef.current;
    if (current) setSession({ ...current, ...change });
  }, [setSession]);

  const loadQuestion = useCallback(async () => {
    const current = sessionRef.current;
    if (!current || current.done || current.questions[String(current.index)]) return;
    setBusy('question');
    setError(null);
    const controller = new AbortController();
    abortRef.current = controller;
    const response = await call('/api/qna/question', setupBody(current), controller.signal);
    abortRef.current = null;
    if (!response || !response.ok) {
      // Error text FIRST, then error + busy in ONE batch — never a render with neither set.
      const text = controller.signal.aborted ? CANCELLED : await errorText(response, 'Could not get a question — try again.');
      failedRef.current = questionKey(current);
      setError(text);
      setBusy(null);
      return;
    }
    setBusy(null);
    const body = (await response.json()) as QnaQuestion & { done?: boolean };
    const latest = sessionRef.current;
    if (!latest || latest.bookId !== current.bookId || latest.index !== current.index) return;
    if (body.done) {
      setSession({ ...latest, done: true, total: body.total });
      return;
    }
    setSession({ ...latest, total: body.total, questions: { ...latest.questions, [String(body.index)]: body } });
  }, [setSession]);

  // Fetch the current question when it is not cached yet (fresh session, Proceed, reload mid-fetch).
  useEffect(() => {
    if (session && !session.done && !session.questions[String(session.index)] && busy === null && error === null
        && failedRef.current !== questionKey(session)) void loadQuestion();
  }, [session, busy, error, loadQuestion]);

  const start = (bookId: string, blocks: string[], options: QnaOptions) => {
    failedRef.current = null;
    setError(null);
    const seed = options.order === 'shuffle' ? Math.floor(Math.random() * 2 ** 31) : 0;
    setSession({
      bookId, blocks: sortBlocks(blocks), index: 0, total: null, questions: {}, draft: '', grade: null,
      done: false, askOpen: false, askDraft: '', ask: null,
      options: { ...options, seed }, results: {}, queue: null, hints: {},
    });
  };

  const submit = async () => {
    const current = sessionRef.current;
    const question = current?.questions[String(current.index)];
    if (!current || !question || !current.draft.trim() || busy) return;
    setBusy('grade');
    setError(null);
    const controller = new AbortController();
    abortRef.current = controller;
    const response = await call('/api/qna/grade', {
      bookId: current.bookId, block: question.block, question: question.question, answer: current.draft, passMark: current.options.passMark,
    }, controller.signal);
    abortRef.current = null;
    if (!response || !response.ok) {
      const text = controller.signal.aborted ? CANCELLED : await errorText(response, 'Grading failed — try again.');
      setError(text);                                                       // the draft is kept
      setBusy(null);
      return;
    }
    setBusy(null);
    const grade = (await response.json()) as QnaGrade;
    const latest = sessionRef.current;
    if (!latest || latest.index !== current.index) return;
    setSession({ ...latest, grade, results: { ...latest.results, [String(current.index)]: { score: grade.score, pass: grade.pass } } });
  };

  const tryAgain = () => {
    setError(null);
    patch({ grade: null, draft: '', askOpen: false, ask: null, askDraft: '' });
  };

  /** Proceed (after a pass) and Next (after a fail) both move on; the score is already recorded. */
  const proceed = () => {
    const current = sessionRef.current;
    if (!current) return;
    setError(null);
    const clear = { grade: null, draft: '', askOpen: false, ask: null, askDraft: '' };
    if (current.queue !== null) {                         // a redo round: the next weak slot, or done
      const [next, ...rest] = current.queue;
      setSession(next === undefined ? { ...current, ...clear, queue: null, done: true } : { ...current, ...clear, index: next, queue: rest });
      return;
    }
    const next = current.index + 1;
    const done = current.total !== null && next >= current.total;
    setSession({ ...current, ...clear, index: next, done });
  };

  /** Redo ONLY the slots scoring < 7 (their cached questions: no new question call). */
  const redoWeak = () => {
    const current = sessionRef.current;
    if (!current) return;
    const weak = weakSlots(current);
    if (!weak.length) return;
    failedRef.current = null;
    setError(null);
    setSession({ ...current, index: weak[0], queue: weak.slice(1), done: false, grade: null, draft: '', askOpen: false, ask: null, askDraft: '' });
  };

  /** Everything again, same setup and same questions; the scores start over. */
  const restart = () => {
    const current = sessionRef.current;
    if (!current) return;
    failedRef.current = null;
    setError(null);
    setSession({ ...current, index: 0, queue: null, done: false, results: {}, grade: null, draft: '', askOpen: false, ask: null, askDraft: '' });
  };

  /** P2b: one hint for the current question — one model call, counted in the qna bucket. */
  const hint = async () => {
    const current = sessionRef.current;
    const question = current?.questions[String(current.index)];
    if (!current || !question || busy || current.hints[String(current.index)]) return;
    setBusy('hint');
    setError(null);
    const controller = new AbortController();
    abortRef.current = controller;
    const response = await call('/api/qna/hint', { bookId: current.bookId, block: question.block, question: question.question }, controller.signal);
    abortRef.current = null;
    if (!response || !response.ok) {
      const text = controller.signal.aborted ? CANCELLED : await errorText(response, 'No hint — try again.');
      setError(text);
      setBusy(null);
      return;
    }
    setBusy(null);
    const body = (await response.json()) as { hint: string };
    const latest = sessionRef.current;
    if (!latest) return;
    setSession({ ...latest, hints: { ...latest.hints, [String(current.index)]: body.hint } });
  };

  const ask = async () => {
    const current = sessionRef.current;
    const question = current?.questions[String(current.index)];
    if (!current || !question || !current.askDraft.trim() || busy) return;
    setBusy('ask');
    setError(null);
    const controller = new AbortController();
    abortRef.current = controller;
    const response = await call('/api/qna/ask', { bookId: current.bookId, block: question.block, question: current.askDraft }, controller.signal);
    abortRef.current = null;
    if (!response || !response.ok) {
      const text = controller.signal.aborted ? CANCELLED : await errorText(response, 'No answer — try again.');
      setError(text);
      setBusy(null);
      return;
    }
    setBusy(null);
    const body = (await response.json()) as { answer: string; refused: boolean };
    patch({ ask: { question: current.askDraft, answer: body.answer, refused: Boolean(body.refused) } });
  };

  const reset = () => {
    abortRef.current?.abort();
    failedRef.current = null;
    setError(null);
    setBusy(null);
    setSession(null);
  };

  /** The loading panel's Cancel: stop waiting. A call the server already started still finishes there. */
  const cancel = () => abortRef.current?.abort();

  return {
    session, busy, error, start, submit, tryAgain, proceed, ask, reset, cancel, redoWeak, restart, hint,
    // The ONLY way a failed question is fetched again: an explicit click.
    retryQuestion: () => { failedRef.current = null; setError(null); },
    setDraft: (draft: string) => patch({ draft }),
    setAskDraft: (askDraft: string) => patch({ askDraft }),
    openAsk: () => patch({ askOpen: true }),
  };
}
