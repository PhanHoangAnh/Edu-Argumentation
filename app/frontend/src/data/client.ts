// Seam 1 (data/client) — THE ONLY PLACE THIS APP TALKS TO THE BACKEND.
//
// ⛔ GET-ONLY BY CONSTRUCTION. This is not a style rule, it is the Phase 03 exit gate:
//    the built bundle must contain ZERO non-GET fetch call sites, and the gate greps the
//    bundle for a named, closed pattern set —
//        fetch( carrying method:"POST"|'POST'|`POST` (and the same 3 quotings for
//        PUT|DELETE|PATCH) · XMLHttpRequest · navigator.sendBeacon · api/progress
//    The gate is fault-proved: a copy of the bundle with one method:"POST" spliced in
//    must go RED. Adding a write here does not "fail a lint" — it fails the phase.
//
// ⛔ Do not add a `method` option to getJson(). A single generic request() with a method
//    parameter is exactly the shape the gate cannot distinguish from a write path.
//    Phase 04 adds writes; it adds them in a NEW module, and it re-baselines the gate.
//
// Same-origin by design: the SPA is served by the FastAPI app that answers the API, so
// there is no base URL, no CORS and no host to configure.

export class ApiError extends Error {
  readonly status: number;
  constructor(path: string, status: number) {
    super(`${path} returned ${status}`);
    this.name = 'ApiError';
    this.status = status;
  }
}

/**
 * ⚑ Phase 06a — WHERE A SIGNED-OUT READER IS SENT. The current page (path, query AND hash — a
 * server redirect cannot carry the hash, so it rides in `next`) comes back after sign-in.
 */
export function loginUrl(): string {
  const here = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  return `/login?next=${encodeURIComponent(here)}`;
}

/** A session that expired mid-read: go to the sign-in page once, instead of failing every panel. */
export function bounceToLogin(status: number): void {
  if (status === 401 && window.location.pathname !== '/login') window.location.assign(loginUrl());
}

/** The one primitive. No method argument, deliberately — see the header. */
export async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, { signal });
  if (!response.ok) {
    if (path !== '/api/auth/me') bounceToLogin(response.status);
    throw new ApiError(path, response.status);
  }
  return (await response.json()) as T;
}

export interface HealthPayload {
  status: string;
  service: string;
  phase: string;
  /**
   * Exactly the seven EDU_* STORE PATHS, and nothing else.
   * ⛔ Never a token, key, model, provider URL or admin flag under any key name:
   * :8792 is unauthenticated and ufw rule #1 blanket-allows the whole LAN.
   */
  paths: Record<string, string>;
}

export function fetchHealth(signal?: AbortSignal): Promise<HealthPayload> {
  return getJson<HealthPayload>('/api/health', signal);
}

/**
 * loadSettings (app.js:3456) — GET /api/settings WITH the admin token header, no-store.
 * ⛔ Still a GET: no `method` option exists on this path either. The token is the one the
 *    reader typed into the lock card this tab (sessionStorage), never a stored credential.
 * Returns the parsed body AND the status, because a 401 carries the message the lock card shows.
 */
export async function getSettingsWithToken<T>(token: string): Promise<{ ok: boolean; status: number; body: T }> {
  const response = await fetch('/api/settings', { headers: { 'X-Edu-Admin-Token': token }, cache: 'no-store' });
  const body = (await response.json().catch(() => ({}))) as T;
  return { ok: response.ok, status: response.status, body };
}
