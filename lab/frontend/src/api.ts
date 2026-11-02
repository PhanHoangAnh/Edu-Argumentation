// Lab API client. Everything is same-origin under /lab/api; the browser's edu_session
// cookie is what signs the request in (the Lab backend checks it with the study app).

export interface LessonRef {
  id: string;
  n: number;
  title: string;
  source: 'full-script' | 'code_cells' | 'fenced';
}
export interface Chapter {
  n: number;
  title: string;
  lessons: LessonRef[];
}
export interface Book {
  id: string;
  title: string;
  chapters: Chapter[];
}
export interface LessonDetail extends LessonRef {
  code: string;
}
export interface Me {
  account_id: number;
  name: string;
}

export type Output =
  | { kind: 'stream'; name?: string; text: string }
  | { kind: 'text'; data: string }
  | { kind: 'html'; data: string }
  | { kind: 'image'; mime?: string; data: string }
  | { kind: 'error'; ename: string; evalue: string; traceback: string[] };

export interface RunResult {
  status: 'ok' | 'error' | 'timeout' | 'busy' | 'restarted' | 'dead' | string;
  outputs: Output[];
  elapsed_ms?: number;
  heavy?: boolean;
  message?: string;
}

/** A failed call, with the HTTP status so the UI can say the right thing. */
export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

function toLogin(): never {
  const next = window.location.pathname + window.location.search;
  window.location.assign(`/login?next=${encodeURIComponent(next)}`);
  throw new ApiError(401, 'Sign in required.');
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, { credentials: 'same-origin', ...init });
  } catch {
    throw new ApiError(0, 'Lab could not be reached. Check your connection.');
  }
  if (response.status === 401) toLogin();
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  if (!response.ok) {
    const message =
      body && typeof body === 'object' && 'error' in body ? String((body as { error: unknown }).error) : `HTTP ${response.status}`;
    throw new ApiError(response.status, message);
  }
  return body as T;
}

const post = <T>(path: string, payload: unknown) =>
  call<T>(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });

export const api = {
  me: () => call<Me>('/lab/api/me'),
  books: () => call<Book[]>('/lab/api/books'),
  lesson: (book: string, lesson: string) =>
    call<LessonDetail>(`/lab/api/books/${encodeURIComponent(book)}/lessons/${encodeURIComponent(lesson)}`),
  run: (book: string, lesson: string, code: string) => post<RunResult>('/lab/api/run', { book, lesson, code }),
  stop: (book: string, lesson: string) => post<unknown>('/lab/api/run/stop', { book, lesson }),
  resetKernel: (book: string, lesson: string) => post<unknown>('/lab/api/run/reset', { book, lesson }),
};

export const MAX_CODE_BYTES = 64 * 1024;
export const byteLength = (text: string) => new TextEncoder().encode(text).length;
