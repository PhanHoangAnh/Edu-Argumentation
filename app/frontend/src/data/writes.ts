// Seam 1b (data/writes) — THE ONLY PLACE THIS APP WRITES TO THE BACKEND. Phase 04.
//
// ⛔ ONE PRIMITIVE, ONE `method: 'POST'` SITE. data/client.ts stays GET-only by construction
//    (its header explains why a generic request(method) is banned there). Every write in the
//    app goes through `postJson` below, so the built bundle carries EXACTLY ONE non-GET
//    fetch literal — and gates/gate-r-ro.mjs R-RO1 asserts that count is exactly one. A second
//    write primitive anywhere is a gate failure, not a style choice.
//
// ⛔ THE ROUTES ARE THE PHASE-02 CONTRACT, MINUS THE THREE RUN ROUTES (ruling R24). The paths below are the legacy's own
//    (app.js), relative to the origin that served the SPA — same-origin by design, and the
//    backend refuses a foreign Origin with 403.
//
// PORTED FROM (by symbol, app.js): postProgress, queuePendingProgress, flushPendingProgress,
// PROGRESS_PENDING_KEY, generationToken, adminToken, rememberAdminToken.

import { bounceToLogin } from './client';
import { askText } from '../shell/dialog';
import type { AddonWriteRoute } from '../shell/screens.meta';
import type { Confidence, QuizQuestion, RunKind, StoredQuestionBody, StudyPrefs } from './types';

export type WriteRoute =
  | '/api/progress'
  | '/api/book/rename'
  | '/api/book/delete'
  | '/api/settings'
  | '/api/quiz'
  | '/api/quiz/fresh'
  | '/api/ask'
  | '/api/exercise/grade'
  // ⚑ Phase 06a (ruling R25): sign-in, the account page, the owner's account admin, wrong answers.
  | '/api/auth/login'
  | '/api/auth/logout'
  | '/api/account/password'
  | '/api/accounts'
  // ⚑ 23-09-26: owner-only per-account Claude access (which 9router combos the account's AI uses).
  | '/api/accounts/claude-access'
  | '/api/wrong-answers'
  // Spaced repetition (21-10-26).
  | '/api/review/seen'
  | '/api/review/grade'
  // exam-recall-suite P1 (22-10-26): add-on router app/backend/addons/study_more.py.
  | '/api/study/prefs'
  | '/api/flags'
  | '/api/answers'
  // exam-recall-suite P3 (22-10-26): add-on router app/backend/addons/exam.py.
  | '/api/exam/start'
  | '/api/exam/answer'
  | '/api/exam/flag'
  | '/api/exam/finish'
  // Add-on screens' own POST routes (study-rooms-qna P1 registry; empty in P1).
  | AddonWriteRoute;
// ⚑ Ruling R24 (23-09-26): /api/run, /api/run/stop, /api/run/reset-kernel are GONE — the code
//   runner was removed. Seven write routes remain.

/** The one write primitive. Returns the raw Response — each caller owns its own error copy,
 *  exactly as each legacy call site did. */
// `signal` (25-09-26): lets the reader CANCEL an AI-Quiz while it is being written. Aborting stops
// the wait in the browser; a model call the server already started still finishes on its side.
export function postJson(route: WriteRoute, body: unknown, headers: Record<string, string> = {}, signal?: AbortSignal): Promise<Response> {
  return fetch(route, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
    signal,
  }).then((response) => {
    // ⚑ Phase 06a: a session that expired mid-read goes to sign-in. The login POST's own 401 is
    //   "wrong password", which the login page shows — never a bounce.
    if (route !== '/api/auth/login') bounceToLogin(response.status);
    return response;
  });
}

// ---------------------------------------------------------------- wrong answers (Phase 06a)
export type QuizKind = 'bank' | 'ai' | 'fresh' | 'exercise';

export interface WrongAnswerBody {
  module: string;
  block: string | null;
  kind: QuizKind;
  question: string;
  options: string[];
  chosen: number;
  correct: number;
  /** Choose-N questions only (21-10-26): the sorted positions picked / the sorted right positions. */
  chosenSet?: number[];
  correctSet?: number[];
  attempt?: string;
}

/**
 * Record ONE wrong answer, full text and options (ruling R25: "store only the wrong answer").
 * Fire-and-forget: a failed record must never interrupt the quiz the reader is in the middle of.
 */
export function recordWrongAnswer(body: WrongAnswerBody): void {
  const sameSingle = !body.correctSet && body.chosen === body.correct;   // a choose-N miss can share its first position
  if (!body.question || !Array.isArray(body.options) || sameSingle) return;
  void postJson('/api/wrong-answers', body).catch(() => undefined);
}

// ---------------------------------------------------------------- spaced repetition (21-10-26)
export type ReviewGrade = 'again' | 'hard' | 'good' | 'easy';

/**
 * Enrol a question after an ORDINARY quiz answer, so it comes back for review. Fire-and-forget:
 * a failed call must never interrupt the quiz.
 * ⚑ 22-10-26 (exam-recall-suite A3): an AI-written question has no `source.question`, so it is
 *   keyed by its content (`aiReviewKey`) and its `body` travels with it — no other copy exists.
 *   A body over MAX_BODY_CHARS is not sent (the server caps it at 8 KB too).
 */
export function recordReviewSeen(body: {
  module: string;
  question: string | undefined;
  correct: boolean;
  body?: StoredQuestionBody;
}): void {
  if (!body.question) return;
  const payload = body.body && !bodyFits(body.body) ? { ...body, body: undefined } : body;
  if (body.question.startsWith('ai-') && !payload.body) return;   // an AI card without its body cannot be reviewed
  void postJson('/api/review/seen', payload).catch(() => undefined);
}

// ---------------------------------------------------------------- exam-recall-suite P1 (22-10-26)
/** The server refuses a stored question body over 8 KB; stay under it on this side. */
export const MAX_BODY_CHARS = 8000;
const bodyFits = (body: StoredQuestionBody) => JSON.stringify(body).length <= MAX_BODY_CHARS;

/**
 * SHA-1 of a string's UTF-8 bytes, hex. Pure JS on purpose: `crypto.subtle` exists only in a
 * secure context, and the VPN door (http://192.168.100.66:8767) is plain HTTP.
 */
function sha1Hex(text: string): string {
  const bytes = new TextEncoder().encode(text);
  const bitLength = bytes.length * 8;
  const padded = new Uint8Array((((bytes.length + 9) >> 6) + 1) << 6);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 4, bitLength >>> 0);
  view.setUint32(padded.length - 8, Math.floor(bitLength / 0x100000000));
  let h0 = 0x67452301, h1 = 0xefcdab89, h2 = 0x98badcfe, h3 = 0x10325476, h4 = 0xc3d2e1f0;
  const w = new Uint32Array(80);
  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let i = 0; i < 16; i += 1) w[i] = view.getUint32(offset + i * 4);
    for (let i = 16; i < 80; i += 1) {
      const x = w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16];
      w[i] = (x << 1) | (x >>> 31);
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4;
    for (let i = 0; i < 80; i += 1) {
      const [f, k] =
        i < 20 ? [(b & c) | (~b & d), 0x5a827999]
        : i < 40 ? [b ^ c ^ d, 0x6ed9eba1]
        : i < 60 ? [(b & c) | (b & d) | (c & d), 0x8f1bbcdc]
        : [b ^ c ^ d, 0xca62c1d6];
      const t = (((a << 5) | (a >>> 27)) + f + e + k + w[i]) >>> 0;
      e = d; d = c; c = (b << 30) | (b >>> 2); b = a; a = t;
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0; h4 = (h4 + e) >>> 0;
  }
  return [h0, h1, h2, h3, h4].map((h) => (h >>> 0).toString(16).padStart(8, '0')).join('');
}

/**
 * The review / flag key of an AI-written question (A3): `ai-` + the first 12 hex of
 * sha1(question.trim() + "\n" + each option trimmed, joined by "\n"), UTF-8. Same question +
 * options -> same key; any option changed -> a different card.
 * ⛔ MUST equal the backend's `store.ai_review_key` byte for byte: the server derives the key
 *    itself whenever a body is sent, and this side's key is what grading / flags / the log use.
 */
export function aiReviewKey(question: { question: string; options: string[] }): string {
  const text = `${question.question.trim()}\n${(question.options ?? []).map((o) => String(o).trim()).join('\n')}`;
  return `ai-${sha1Hex(text).slice(0, 12)}`;
}

/** A book question's own key, else the AI content key. */
export function reviewKeyOf(question: QuizQuestion | undefined): string | undefined {
  if (!question) return undefined;
  if (question.source?.question) return question.source.question;
  if (!question.question || !Array.isArray(question.options)) return undefined;
  return aiReviewKey(question);
}

/** The body stored with an AI card or flag; undefined for a book question (the book holds it). */
export function storedBodyOf(question: QuizQuestion | undefined): StoredQuestionBody | undefined {
  // A question rebuilt from a stored body carries its `ai-` key as source.question — still AI.
  if (!question || (question.source?.question && !question.source.question.startsWith('ai-'))) return undefined;
  return { question: question.question, options: question.options, correct: question.correct, explanations: question.explanations ?? null };
}

/**
 * Flag / unflag one question. Sends the WANTED state (`flagged`), so a retried call cannot undo
 * itself. Resolves true when the server took it — the caller shows "Flagged" / "Not saved".
 */
export async function toggleFlag(body: {
  module: string;
  question: string;
  flagged: boolean;
  body?: StoredQuestionBody;
}): Promise<boolean> {
  const payload = body.body && !bodyFits(body.body) ? { ...body, body: undefined } : body;
  try {
    const response = await postJson('/api/flags', payload);
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * A v4 UUID (the server requires a uuid). crypto.randomUUID needs a secure context and the VPN
 * door is plain HTTP; crypto.getRandomValues works on both.
 */
export function clientId(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const hex = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export interface AnswerLogBody {
  module: string;
  question: string;
  chapter?: number | null;
  runKind: RunKind;
  runId: string;
  correct: boolean;
  confidence?: Confidence | null;
  /** The position picked, or the sorted set for choose-N. */
  chosen: number | number[];
}

/**
 * Log ONE answer (answer_log feeds stats, history, mastery). Fire-and-forget, like the other
 * quiz writes. `clientId` makes a retried POST land once (server: UNIQUE account + client_id).
 */
export function logAnswer(body: AnswerLogBody): void {
  if (!body.question) return;
  void postJson('/api/answers', { ...body, clientId: clientId() }).catch(() => undefined);
}

/** Save this book's new-card cap / session size. Resolves true when the server took it. */
export async function savePrefs(body: { module: string } & Partial<StudyPrefs>): Promise<boolean> {
  try {
    const response = await postJson('/api/study/prefs', body);
    return response.ok;
  } catch {
    return false;
  }
}

/** Grade one card in a review run (wrong = again; right = hard / good / easy, his choice). */
export function gradeReview(body: { module: string; question: string | undefined; grade: ReviewGrade }): void {
  if (!body.question) return;
  void postJson('/api/review/grade', body).catch(() => undefined);
}

// ---------------------------------------------------------------- exam-recall-suite P3 (22-10-26)
/**
 * One exam POST. NOT fire-and-forget (unlike the quiz writes): an exam answer that did not land must
 * say so, and a 409 carries the finished run's result (the deadline passed, or it was already
 * submitted), which the screen shows instead of the question.
 *   ok      -> the parsed reply
 *   closed  -> 409: `result` is the server's Result (raw, normalised by the caller)
 *   failed  -> anything else (network, 4xx/5xx): `error` is the server's message or a short one of ours
 */
export type ExamPostOutcome =
  | { kind: 'ok'; status: number; data: Record<string, unknown> }
  | { kind: 'closed'; code: string; result: unknown; error: string }
  | { kind: 'failed'; status: number; error: string };

export async function examPost(
  route: '/api/exam/start' | '/api/exam/answer' | '/api/exam/flag' | '/api/exam/finish',
  body: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<ExamPostOutcome> {
  let response: Response;
  try {
    response = await postJson(route, body, {}, signal);
  } catch (error) {
    if ((error as Error)?.name === 'AbortError') return { kind: 'failed', status: 0, error: 'Cancelled.' };
    return { kind: 'failed', status: 0, error: 'No connection — not saved.' };
  }
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  const error = typeof data.error === 'string' && data.error ? data.error : `Request failed (${response.status}).`;
  if (response.status === 409 && data.result && typeof data.result === 'object') {
    return { kind: 'closed', code: String(data.code ?? 'finished'), result: data.result, error };
  }
  if (!response.ok) return { kind: 'failed', status: response.status, error };
  return { kind: 'ok', status: response.status, data };
}

// ---------------------------------------------------------------- progress
export interface ProgressBody {
  module: string;
  block: string;
  score: number;
  total: number;
  source: string;
}

export interface ProgressReply {
  module?: string;
  completed?: Record<string, unknown>;
  marked?: boolean;
}

export const PROGRESS_PENDING_KEY = 'eduPendingProgress';

/**
 * postProgress (app.js:1150) — one POST with retries. The network to this box spikes, and a
 * dropped write used to be swallowed silently.
 *   returns the reply        -> reached the server
 *   returns null             -> 4xx, our fault, retrying will not help
 *   returns undefined        -> never reached the server (queue it)
 */
export async function postProgress(body: ProgressBody, attempts = 3): Promise<ProgressReply | null | undefined> {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await postJson('/api/progress', body);
      if (response.ok) return (await response.json()) as ProgressReply;
      if (response.status >= 400 && response.status < 500) return null;
    } catch {
      /* network: fall through to the retry */
    }
    if (attempt < attempts) await new Promise((done) => setTimeout(done, 400 * attempt));
  }
  return undefined;
}

/** queuePendingProgress (app.js:1140) — keep the last 10 unsent completions for the next load. */
export function queuePendingProgress(body: ProgressBody): void {
  try {
    const queued = JSON.parse(localStorage.getItem(PROGRESS_PENDING_KEY) || '[]') as ProgressBody[];
    localStorage.setItem(PROGRESS_PENDING_KEY, JSON.stringify([...queued.slice(-9), body]));
  } catch {
    /* storage blocked: the retry was the only chance */
  }
}

/**
 * flushPendingProgress (app.js:1167) — re-sends anything a previous session could not save.
 * Returns the replies that landed, so the caller can refresh the progress cache.
 * ⛔ Runs ONCE per page load (the legacy's DOMContentLoaded). An empty queue sends nothing —
 *    gate R-RO2 asserts an unseeded browse makes ZERO non-GET requests.
 */
export async function flushPendingProgress(): Promise<ProgressReply[]> {
  let queued: ProgressBody[] = [];
  try {
    queued = JSON.parse(localStorage.getItem(PROGRESS_PENDING_KEY) || '[]') as ProgressBody[];
  } catch {
    return [];
  }
  if (!Array.isArray(queued) || !queued.length) return [];
  const left: ProgressBody[] = [];
  const landed: ProgressReply[] = [];
  for (const body of queued) {
    const data = await postProgress(body, 2);
    if (data === undefined) left.push(body);
    else if (data && data.completed) landed.push(data);
  }
  try {
    if (left.length) localStorage.setItem(PROGRESS_PENDING_KEY, JSON.stringify(left));
    else localStorage.removeItem(PROGRESS_PENDING_KEY);
  } catch {
    /* storage blocked */
  }
  return landed;
}

// ---------------------------------------------------------------- tokens
/**
 * generationToken (app.js:3024). `null` means the reader cancelled the prompt — abort.
 * `''` means no token is needed. The provider's token_required flag decides.
 */
// ⚑ 30-09-26 (defect D): asked through the IN-APP dialog (shell/dialog.tsx askText) — async now.
export async function generationToken(tokenRequired: boolean): Promise<string | null> {
  if (!tokenRequired) return '';
  return (await askText({ title: 'Generation access token', label: 'Token', confirmLabel: 'Continue', secret: true })) || null;
}

/** The admin token lives in sessionStorage only: it dies with the tab (app.js:3426). */
export function adminToken(): string {
  try {
    return sessionStorage.getItem('eduAdminToken') || '';
  } catch {
    return '';
  }
}

export function rememberAdminToken(token: string): void {
  try {
    sessionStorage.setItem('eduAdminToken', token);
  } catch {
    /* private mode */
  }
}

// ---------------------------------------------------------------- sign out (23-09-26)
/**
 * Sign out, from the top bar's LOG OUT entry or the Account page. ONE implementation for both.
 *
 * Order, each step deliberate:
 *   1. Flush any unsent lesson completions WHILE the session still exists — after step 2 they
 *      would either 401 or, worse, be sent later under the NEXT account to sign in on this browser.
 *   2. POST /api/auth/logout — the server deletes the session row and clears the cookie.
 *   3. Clear what this browser holds FOR THIS PERSON: the admin token (sessionStorage), the tutor
 *      conversation, any still-unsent completions, and exercise drafts. None of these is keyed by
 *      account, so leaving them would show one person's work to the next.
 *      ⚠ `eduActiveBook` (which book was open) is a UI preference, not personal work — kept.
 *   4. A FULL navigation to /login, which also drops the in-memory query cache.
 * A failed network call never blocks the navigation: the reader asked to leave, so they leave.
 */
export async function signOut(): Promise<void> {
  await flushPendingProgress().catch(() => undefined);
  await postJson('/api/auth/logout', {}).catch(() => undefined);
  try {
    sessionStorage.removeItem('eduAdminToken');
  } catch {
    /* private mode */
  }
  try {
    const drop = [PROGRESS_PENDING_KEY, 'eduAskConversation'];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key && key.startsWith('eduExercises.')) drop.push(key);
    }
    for (const key of drop) localStorage.removeItem(key);
  } catch {
    /* storage blocked */
  }
  window.location.assign('/login');
}
