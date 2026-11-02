// Sign-in page — Phase 06a, ruling R25 ("Similar shape as the login screen of the CoreX").
//
// ⚑ THE SHAPE IS CoreX's (platform/console/frontend/src/pages/LoginPage.tsx); THE LOOK IS THIS APP'S.
//   CoreX's skeleton, top to bottom: one centred card capped at 430px · the wordmark · a 32px spacer ·
//   the heading · one line of copy · labelled fields · the submit · one status line.
// ⚑ RESTYLED 23-09-26 (user: "Even the sign in screen is also off compare to the rest of the UI").
//   It used to carry its own vocabulary (bg-red-700 button, 10px radius, 3px red-400 ring, a 30px
//   tight-tracked heading, xs bold labels). Every class is now shell/ui.ts — the home page's and the
//   Settings page's strings, verbatim: the card IS #welcome-screen, the heading IS #welcome-title,
//   the fields ARE Settings', the submit IS "Continue reading". The mark IS the header's brand.
//   gates/gate-r-style.mjs measures every pair. There is no sign-up and no bootstrap mode: accounts
//   are created by the owner only (admin CLI or the Account page).
//
// ACCESSIBILITY (the brief's list, each one deliberate):
//   · labels are real <label htmlFor>, never placeholder-only
//   · autocomplete="username" / "current-password" and NO paste blocking, so a password manager works
//   · a field's own error sits under it and is linked with aria-describedby + aria-invalid
//   · a failed sign-in announces ONE generic sentence in role="alert" — it never says which of the
//     two was wrong
//   · Enter submits (a real <form>), the button shows a spinner + "Signing in…" and aria-busy
//   · every control is ≥44px tall; a focused field gets a brand-red border AND ring, the submit the
//     home page's white focus ring
//   · ⚠ CONTRAST, stated rather than hidden: the submit is now the app's brand red #ef5b5b with white
//     14px bold text ≈ 3.3:1 — under WCAG AA's 4.5:1 for text that size. It is the SAME button as
//     "Continue reading" by user ruling (23-09-26: that shade "is the correct red"), so the fix, if
//     wanted, is a brand decision for the whole app, not a one-off darker red on this page.
//     Errors red-300 on gray-800 ≈ 8:1. The app has one (dark) theme, like :8767.
import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { postJson } from '../data/writes';
import { BODY_MUTED, CARD, FIELD, FIELD_INVALID, LABEL, PAGE_TITLE, PRIMARY_BTN } from '../shell/ui';

const GENERIC_ERROR = 'Username or password is incorrect.';

/** Only a same-site PATH may be a post-login target (the server applies the same rule). */
function nextTarget(): string {
  const raw = new URLSearchParams(window.location.search).get('next') || '/';
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\') || raw.startsWith('/login')) return '/';
  // A server redirect keeps the page's #hash on the /login URL itself; carry it on.
  return raw.includes('#') ? raw : `${raw}${window.location.hash}`;
}

function Mark() {
  return (
    <div className="flex items-center gap-3 text-white" aria-hidden="true">
      <svg className="w-8 h-8 shrink-0" viewBox="0 0 40 40">
        <rect x="2" y="2" width="36" height="36" rx="9" fill="none" stroke="currentColor" strokeWidth="2.5" />
        <g fill="currentColor">
          <rect x="13" y="11" width="4.5" height="18" rx="1" />
          <rect x="13" y="11" width="14" height="4.5" rx="1" />
          <rect x="13" y="24.5" width="14" height="4.5" rx="1" />
        </g>
        <rect x="13" y="17.75" width="10" height="4.5" rx="1" fill="#ef5b5b" />
      </svg>
      <span className="text-2xl font-bold tracking-widest uppercase">Edu-Arg</span>
    </div>
  );
}

export function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<{ username?: string; password?: string }>({});
  const userRef = useRef<HTMLInputElement>(null);
  const passRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    userRef.current?.focus();
  }, []);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const missing = {
      username: username.trim() ? undefined : 'Enter your username.',
      password: password ? undefined : 'Enter your password.',
    };
    setFieldErrors(missing);
    setError('');
    if (missing.username) return userRef.current?.focus();
    if (missing.password) return passRef.current?.focus();
    setBusy(true);
    try {
      const response = await postJson('/api/auth/login', { username: username.trim(), password });
      if (response.ok) {
        window.location.assign(nextTarget());
        return;
      }
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      // 401 is ALWAYS the generic sentence. 429 (too many attempts) and 503 say what they are.
      setError(response.status === 401 ? GENERIC_ERROR : body.error || `Sign-in failed (${response.status}).`);
      setPassword('');
      passRef.current?.focus();
    } catch {
      setError('The study service could not be reached. Check the connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main id="login-screen" className="flex-grow flex items-center justify-center px-4 py-10 bg-gray-900">
      <section id="login-card" className={`w-[min(100%,430px)] box-border ${CARD}`} aria-labelledby="login-title">
        <Mark />
        <div aria-hidden="true" className="h-8" />
        <h1 id="login-title" className={PAGE_TITLE}>
          Sign in
        </h1>
        <p id="login-copy" className={`${BODY_MUTED} mb-6`}>
          Sign in to continue studying. Need an account? Ask the owner.
        </p>
        <form id="login-form" className="space-y-5" noValidate onSubmit={onSubmit}>
          <div>
            <label className={LABEL} htmlFor="login-username">
              Username
            </label>
            <input
              ref={userRef}
              className={fieldErrors.username ? FIELD_INVALID : FIELD}
              id="login-username"
              name="username"
              type="text"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              maxLength={64}
              required
              value={username}
              aria-invalid={fieldErrors.username ? 'true' : 'false'}
              aria-describedby={fieldErrors.username ? 'login-username-error' : undefined}
              onChange={(e) => {
                setUsername(e.target.value);
                if (fieldErrors.username) setFieldErrors((f) => ({ ...f, username: undefined }));
              }}
            />
            {fieldErrors.username ? (
              <p id="login-username-error" className="mt-2 text-sm text-red-300">{fieldErrors.username}</p>
            ) : null}
          </div>
          <div>
            <label className={LABEL} htmlFor="login-password">
              Password
            </label>
            <input
              ref={passRef}
              className={fieldErrors.password ? FIELD_INVALID : FIELD}
              id="login-password"
              name="password"
              type="password"
              autoComplete="current-password"
              maxLength={256}
              required
              value={password}
              aria-invalid={fieldErrors.password ? 'true' : 'false'}
              aria-describedby={fieldErrors.password ? 'login-password-error' : undefined}
              onChange={(e) => {
                setPassword(e.target.value);
                if (fieldErrors.password) setFieldErrors((f) => ({ ...f, password: undefined }));
              }}
            />
            {fieldErrors.password ? (
              <p id="login-password-error" className="mt-2 text-sm text-red-300">{fieldErrors.password}</p>
            ) : null}
          </div>
          <button
            id="login-submit"
            type="submit"
            disabled={busy}
            aria-busy={busy ? 'true' : 'false'}
            className={`w-full inline-flex items-center justify-center gap-2 ${PRIMARY_BTN}`}
          >
            {busy ? (
              <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" opacity="0.3" />
                <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
              </svg>
            ) : null}
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
        <p id="login-status" className="min-h-5 mt-4 text-sm text-red-300" role="alert">
          {error}
        </p>
      </section>
    </main>
  );
}
