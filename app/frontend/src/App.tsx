// The application root.
//
// ⚑ PHASE 06a (ruling R25) — SIGN-IN FIRST. `/login` renders the sign-in page; every other path
//   asks GET /api/auth/me and renders the app only for a signed-in account. The server enforces
//   the same rule on every page and API route (main.py require_session) — this is the page-side
//   half, so a reader whose cookie expired lands on the form instead of a wall of failed panels.
import { useQuery } from '@tanstack/react-query';
import { AppProviders, AppShell } from './shell/AppShell';
import { AccountContext } from './account/AccountContext';
import type { SignedInAccount } from './account/AccountContext';
import { LoginPage } from './account/LoginPage';
import { loginUrl } from './data/client';

async function fetchMe(): Promise<SignedInAccount | null> {
  const response = await fetch('/api/auth/me', { cache: 'no-store' });
  if (response.status === 401) return null;
  if (!response.ok) throw new Error(`/api/auth/me returned ${response.status}`);
  const body = (await response.json()) as { account: SignedInAccount };
  return body.account;
}

export default function App() {
  const onLoginPage = window.location.pathname === '/login';
  const me = useQuery({ queryKey: ['auth-me'], queryFn: fetchMe, enabled: !onLoginPage, retry: 1, staleTime: Infinity });

  if (onLoginPage) return <LoginPage />;
  if (me.isPending) return null;
  if (me.isError) {
    return (
      <main className="flex-grow flex items-center justify-center px-4 py-16 text-center">
        <p className="text-gray-300" role="alert">The study service could not be reached. Refresh the page to try again.</p>
      </main>
    );
  }
  if (!me.data) {
    window.location.replace(loginUrl());
    return null;
  }
  return (
    <AccountContext.Provider value={me.data}>
      <AppProviders>
        <AppShell />
      </AppProviders>
    </AccountContext.Provider>
  );
}
