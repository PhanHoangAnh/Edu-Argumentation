// Account page — Phase 06a, ruling R25: "The top bar would get new entry called Account, and
// general-account-info like other study pages should live there."
//
// What lives here: who you are · your own numbers (lessons finished per book, recent assessment
// scores, how many wrong answers were recorded per book) · change password · sign out · and, for
// the OWNER only, the Accounts list and the create-account form ("currently only i can create").
// The server enforces the owner rule too (GET/POST /api/accounts answer 403 otherwise); hiding the
// section here is presentation, not the control.
//
// ⚑ RESTYLED 23-09-26 (user: "Account page button is vastly different, both font, font size, shade
//   of red"). Every class now comes from shell/ui.ts, whose strings are the home page's and the
//   Settings page's VERBATIM: the primary button IS "Continue reading", the secondary IS "Practice",
//   the title IS #welcome-title, section titles ARE #library-heading. No colour, font or size here is
//   new. gates/gate-r-style.mjs measures every pair with getComputedStyle.
import { useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getJson } from '../data/client';
import { postJson, signOut } from '../data/writes';
import { moduleIdFor } from '../data/bookPaths';
import { useModules } from '../data/queries';
import { useAccount } from './AccountContext';
import { ProgressPanel } from './ProgressPanel';
import {
  BODY_MUTED, CAPTION, CARD, EYEBROW, FIELD, LABEL, OUTLINE_BTN, PAGE_TITLE, PRIMARY_BTN, SECTION_TITLE,
} from '../shell/ui';

interface Stats {
  completed: { module: string; lessons: number; lastAt: string }[];
  attempts: { module: string; block: string; score: number; total: number; source: string; at: string }[];
  wrongAnswers: { module: string; count: number }[];
  wrongTotal: number;
}

interface AccountRow {
  id: number;
  username: string;
  displayName: string;
  isOwner: boolean;
  claudeAccess: boolean;
  createdAt: string;
}

interface LibraryBook {
  file: string;
  moduleId?: string;
  title: string;
  lessons?: number;
}

/** The same progress key the library cards use (state/LibraryProvider.tsx). */
function progressKey(book: LibraryBook): string {
  return book.moduleId && !/^t-/.test(book.moduleId) ? book.moduleId : moduleIdFor({} as never, book.file);
}

function lessonLabel(block: string): string {
  const m = /^ch(\d{2})-b(\d{2})$/.exec(block);
  return m ? `Chapter ${Number(m[1])} · lesson ${Number(m[2])}` : block;
}

function when(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function Status({ kind, text }: { kind: 'ok' | 'error' | 'idle'; text: string }) {
  if (!text) return <p className="mt-3 min-h-5 text-sm" />;
  return (
    <p className={`mt-3 min-h-5 text-sm ${kind === 'error' ? 'text-red-300' : 'text-green-400'}`} role={kind === 'error' ? 'alert' : 'status'}>
      {text}
    </p>
  );
}

function Field(props: { id: string; label: string; children: ReactNode }) {
  return (
    <div>
      <label htmlFor={props.id} className={LABEL}>{props.label}</label>
      {props.children}
    </div>
  );
}

function PasswordCard() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ kind: 'ok' | 'error' | 'idle'; text: string }>({ kind: 'idle', text: '' });

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (next !== again) return setStatus({ kind: 'error', text: 'The two new passwords do not match.' });
    if (next.length < 8) return setStatus({ kind: 'error', text: 'The new password must be at least 8 characters.' });
    setBusy(true);
    try {
      const response = await postJson('/api/account/password', { current, new: next });
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) setStatus({ kind: 'error', text: body.error || `Could not change the password (${response.status}).` });
      else {
        setStatus({ kind: 'ok', text: 'Password changed. Other devices have been signed out.' });
        setCurrent(''); setNext(''); setAgain('');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <form id="account-password-form" className={CARD} onSubmit={submit} noValidate>
      <h2 className={SECTION_TITLE}>Change password</h2>
      <p className={`${BODY_MUTED} mb-6`}>At least 8 characters. Changing it signs out your other devices.</p>
      <div className="space-y-5">
        <Field id="account-current-password" label="Current password">
          <input id="account-current-password" className={FIELD} type="password" autoComplete="current-password"
            value={current} onChange={(e) => setCurrent(e.target.value)} />
        </Field>
        <Field id="account-new-password" label="New password">
          <input id="account-new-password" className={FIELD} type="password" autoComplete="new-password"
            value={next} onChange={(e) => setNext(e.target.value)} />
        </Field>
        <Field id="account-new-password-again" label="New password, again">
          <input id="account-new-password-again" className={FIELD} type="password" autoComplete="new-password"
            value={again} onChange={(e) => setAgain(e.target.value)} />
        </Field>
      </div>
      <button type="submit" className={`mt-6 ${PRIMARY_BTN}`} disabled={busy} aria-busy={busy ? 'true' : 'false'}>
        {busy ? 'Saving…' : 'Change password'}
      </button>
      <Status {...status} />
    </form>
  );
}

function AccountsAdmin() {
  const queryClient = useQueryClient();
  const accounts = useQuery({ queryKey: ['accounts'], queryFn: () => getJson<{ accounts: AccountRow[] }>('/api/accounts') });
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ kind: 'ok' | 'error' | 'idle'; text: string }>({ kind: 'idle', text: '' });
  const [toggling, setToggling] = useState('');
  const [accessStatus, setAccessStatus] = useState<{ kind: 'ok' | 'error' | 'idle'; text: string }>({ kind: 'idle', text: '' });

  // ⚑ 23-09-26 (user ruling): Claude access per account. ON -> the Claude combos for the tutor and
  //   for quizzes/grading; OFF (the default for every new account) -> the normal combos. The server
  //   reads the flag on every AI call; this button only asks it to change.
  async function toggleClaude(row: AccountRow) {
    setToggling(row.username);
    try {
      const response = await postJson('/api/accounts/claude-access', { username: row.username, on: !row.claudeAccess });
      const body = (await response.json().catch(() => ({}))) as { error?: string; account?: AccountRow };
      if (!response.ok) setAccessStatus({ kind: 'error', text: body.error || `Could not change Claude access (${response.status}).` });
      else {
        setAccessStatus({ kind: 'ok', text: `Claude access for "${row.username}" is now ${body.account?.claudeAccess ? 'on' : 'off'}.` });
        await queryClient.invalidateQueries({ queryKey: ['accounts'] });
      }
    } finally {
      setToggling('');
    }
  }

  async function create(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const response = await postJson('/api/accounts', { username: username.trim(), displayName: displayName.trim(), password });
      const body = (await response.json().catch(() => ({}))) as { error?: string; account?: AccountRow };
      if (!response.ok) setStatus({ kind: 'error', text: body.error || `Could not create the account (${response.status}).` });
      else {
        setStatus({ kind: 'ok', text: `Account "${body.account?.username}" created. Give them the password yourself.` });
        setUsername(''); setDisplayName(''); setPassword('');
        await queryClient.invalidateQueries({ queryKey: ['accounts'] });
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <section id="account-admin" className={CARD} aria-labelledby="account-admin-title">
      <h2 id="account-admin-title" className={SECTION_TITLE}>Accounts</h2>
      <p className={`${BODY_MUTED} mb-6`}>Only you (the owner) can see this or create accounts. There is no sign-up.</p>
      <div className="overflow-x-auto">
        <table id="account-list" className="w-full text-sm text-left">
          <thead className={CAPTION}>
            <tr><th className="py-2 pr-4">Username</th><th className="py-2 pr-4">Name</th><th className="py-2 pr-4">Role</th><th className="py-2 pr-4">Claude access</th><th className="py-2">Created</th></tr>
          </thead>
          <tbody className="text-gray-200">
            {(accounts.data?.accounts ?? []).map((row) => (
              <tr key={row.id} className="border-t border-gray-700" data-account={row.username}>
                <td className="py-2 pr-4 font-medium">{row.username}</td>
                <td className="py-2 pr-4">{row.displayName}</td>
                <td className="py-2 pr-4">{row.isOwner ? 'Owner' : 'Reader'}</td>
                <td className="py-2 pr-4">
                  <button type="button" role="switch" aria-checked={row.claudeAccess ? 'true' : 'false'}
                    aria-label={`Claude access for ${row.username}`} data-claude-toggle={row.username}
                    disabled={toggling === row.username} onClick={() => void toggleClaude(row)}
                    className={row.claudeAccess
                      ? 'inline-flex items-center justify-center min-h-[44px] px-5 rounded-lg border border-brand-600 bg-brand-600/15 text-white font-semibold uppercase tracking-wider text-sm transition-colors active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 disabled:opacity-50 disabled:cursor-not-allowed'
                      : OUTLINE_BTN}>
                    {row.claudeAccess ? 'On' : 'Off'}
                  </button>
                </td>
                <td className="py-2 text-gray-400">{when(row.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {accounts.isError ? <p className="mt-3 text-sm text-red-300" role="alert">Could not load the accounts.</p> : null}
        <p className="mt-3 text-sm text-gray-400">Claude access on: the tutor and quizzes use the Claude models. Off (the default for new accounts): the standard models.</p>
        <Status {...accessStatus} />
      </div>
      <form id="account-create-form" className="mt-8 grid gap-5 sm:grid-cols-3" onSubmit={create} noValidate>
        <Field id="account-create-username" label="Username">
          <input id="account-create-username" className={FIELD} autoComplete="off" autoCapitalize="none" spellCheck={false}
            maxLength={64} value={username} onChange={(e) => setUsername(e.target.value)} />
        </Field>
        <Field id="account-create-name" label="Display name">
          <input id="account-create-name" className={FIELD} autoComplete="off" maxLength={80}
            value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
        </Field>
        <Field id="account-create-password" label="Password (8+ characters)">
          <input id="account-create-password" className={FIELD} type="password" autoComplete="new-password"
            value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <div className="sm:col-span-3">
          <button type="submit" className={PRIMARY_BTN} disabled={busy} aria-busy={busy ? 'true' : 'false'}>
            {busy ? 'Creating…' : 'Create account'}
          </button>
          <Status {...status} />
        </div>
      </form>
    </section>
  );
}

/** `onStartRun` (exam-recall-suite P2): switch to the quiz screen after the Progress panel seeded a run. */
export function AccountScreen({ open, onStartRun }: { open: boolean; onStartRun?: () => void }) {
  const account = useAccount();
  const modules = useModules();
  const stats = useQuery({
    queryKey: ['account-stats'],
    queryFn: () => getJson<Stats>('/api/account/stats'),
    enabled: open,
    refetchOnMount: 'always',
  });
  const books = ((modules.data ?? []) as unknown) as LibraryBook[];
  const titleOf = (module: string) => books.find((b) => progressKey(b) === module)?.title ?? module;
  const lessonsOf = (module: string) => books.find((b) => progressKey(b) === module)?.lessons;
  const wrongFor = (module: string) => stats.data?.wrongAnswers.find((w) => w.module === module)?.count ?? 0;
  const modulesSeen = Array.from(new Set([
    ...(stats.data?.completed ?? []).map((c) => c.module),
    ...(stats.data?.wrongAnswers ?? []).map((w) => w.module),
  ]));

  return (
    <>
      <div className={CARD}>
        <p className={EYEBROW}>Account{account.isOwner ? ' · Owner' : ''}</p>
        <h1 id="account-title" className={PAGE_TITLE}>{account.displayName}</h1>
        <dl className="mt-6 grid gap-4 sm:grid-cols-2 text-sm">
          <div><dt className="text-gray-400">Username</dt><dd id="account-username" className="text-white font-medium mt-1">{account.username}</dd></div>
          <div><dt className="text-gray-400">Wrong answers recorded</dt><dd id="account-wrong-total" className="text-white font-medium mt-1">{stats.data ? stats.data.wrongTotal : '…'}</dd></div>
        </dl>
        <button id="account-signout-btn" type="button" className={`mt-6 gap-2 ${OUTLINE_BTN}`} onClick={() => void signOut()}>
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12H3m0 0l4-4m-4 4l4 4M13 5h5a2 2 0 012 2v10a2 2 0 01-2 2h-5" />
          </svg>
          Sign out
        </button>
      </div>

      <section className={CARD} aria-labelledby="account-progress-title">
        <h2 id="account-progress-title" className={SECTION_TITLE}>Your progress</h2>
        <p className={`${BODY_MUTED} mb-6`}>Finished lessons and recorded wrong answers, per book. Only yours.</p>
        {stats.isError ? <p className="text-sm text-red-300" role="alert">Could not load your numbers.</p> : null}
        {stats.data && !modulesSeen.length ? <p className="text-sm text-gray-400">Nothing finished yet.</p> : null}
        {modulesSeen.length ? (
          <div className="overflow-x-auto">
            <table id="account-progress" className="w-full text-sm text-left">
              <thead className={CAPTION}>
                <tr><th className="py-2 pr-4">Book</th><th className="py-2 pr-4">Lessons finished</th><th className="py-2">Wrong answers</th></tr>
              </thead>
              <tbody className="text-gray-200">
                {modulesSeen.map((module) => {
                  const done = stats.data?.completed.find((c) => c.module === module)?.lessons ?? 0;
                  const total = lessonsOf(module);
                  return (
                    <tr key={module} className="border-t border-gray-700" data-module={module}>
                      <td className="py-2 pr-4 font-medium">{titleOf(module)}</td>
                      <td className="py-2 pr-4" data-cell="lessons">{total ? `${done} of ${total}` : done}</td>
                      <td className="py-2" data-cell="wrong">{wrongFor(module)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}
        <h3 className={`mt-8 mb-3 ${CAPTION}`}>Recent assessments</h3>
        {stats.data && !stats.data.attempts.length ? <p className="text-sm text-gray-400">No assessments finished yet.</p> : null}
        <ul id="account-attempts" className="divide-y divide-gray-700 text-sm">
          {(stats.data?.attempts ?? []).map((a, i) => (
            <li key={`${a.at}-${i}`} className="py-2 flex flex-wrap justify-between gap-2">
              <span className="text-gray-200">{titleOf(a.module)} — {lessonLabel(a.block)}</span>
              <span className={a.score === a.total ? 'text-green-400 font-semibold' : 'text-amber-400 font-semibold'}>
                {a.score} / {a.total}
                <span className="ml-3 font-normal text-gray-400">{when(a.at)}</span>
              </span>
            </li>
          ))}
        </ul>
        {onStartRun ? <ProgressPanel open={open} onStartRun={onStartRun} /> : null}
      </section>

      <PasswordCard />
      {account.isOwner ? <AccountsAdmin /> : null}
    </>
  );
}
