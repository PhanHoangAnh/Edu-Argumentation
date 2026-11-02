// gates/lib/auth-preload.mjs — SIGN THE R- SUITES IN, WITHOUT EDITING EVERY SUITE. Phase 06a.
//
// ⚑ WHY: ruling R25 put every page and API route of the new stack behind a session. The existing
//   R- suites (115 checks) were written against an open server; ~40 browser contexts and ~25 curl
//   calls would each need a login step. Instead run-gates-react.sh starts each suite as
//     node --import ./lib/auth-preload.mjs <suite>
//   with R_SESSION = a session minted for a throwaway gate account in the ISOLATED `edu_study_gate`
//   database. This module then attaches that session cookie to exactly three kinds of traffic,
//   and ONLY toward the local harness origins (R_BASE / R_WRITE_BASE — loopback):
//     · every Playwright browser context (browser.newContext / browser.newPage)
//     · global fetch()
//     · `curl` run through child_process.execFileSync
//   Traffic to the live :8767 (the parity/contract comparisons) or the live :8792 is untouched.
// ⛔ It does NOT bypass authentication — the server still checks a real session row. A suite that
//    is ABOUT authentication (gate-r-auth.mjs) is run WITHOUT this preload.
// ⛔ No R_SESSION -> the module does nothing, so a suite run by hand against an open server works.
import { createRequire, syncBuiltinESMExports } from 'node:module';
import { chromium } from 'playwright';

const TOKEN = process.env.R_SESSION || '';
const ORIGINS = [process.env.R_BASE, process.env.R_WRITE_BASE].filter(Boolean).map((u) => new URL(u).origin);
// ⚑ The LIVE :8792 (R_REMOTE) gets its OWN short-lived machine session (R_REMOTE_SESSION, minted on
//   nn by the runner and revoked after) — used only by suites that must READ the live corpus
//   (gate-r6-placement). ⛔ Every NON-GET request to the live origin is BLOCKED below, in the browser
//   and in fetch: a gate signed in on live must never be able to write into a real person's account.
const REMOTE_TOKEN = process.env.R_REMOTE_SESSION || '';
const REMOTE = process.env.R_REMOTE ? new URL(process.env.R_REMOTE).origin : '';
const targets = (url) => ORIGINS.some((o) => String(url).startsWith(o));
const remote = (url) => Boolean(REMOTE) && String(url).startsWith(REMOTE);

if ((TOKEN && ORIGINS.length) || (REMOTE_TOKEN && REMOTE)) {
  const cookies = TOKEN ? ORIGINS.map((url) => ({ name: 'edu_session', value: TOKEN, url, httpOnly: true, sameSite: 'Lax' })) : [];
  if (REMOTE_TOKEN && REMOTE) cookies.push({ name: 'edu_session', value: REMOTE_TOKEN, url: REMOTE, httpOnly: true, sameSite: 'Lax' });
  const guard = async (ctx) => {
    await ctx.addCookies(cookies);
    if (REMOTE) {
      await ctx.route(`${REMOTE}/**`, (route) => (route.request().method() === 'GET' ? route.continue() : route.abort()));
    }
  };

  // --- Playwright --------------------------------------------------------------------------
  const launch = chromium.launch.bind(chromium);
  chromium.launch = async (...args) => {
    const browser = await launch(...args);
    const newContext = browser.newContext.bind(browser);
    browser.newContext = async (...a) => {
      const ctx = await newContext(...a);
      await guard(ctx);
      return ctx;
    };
    const newPage = browser.newPage.bind(browser);
    browser.newPage = async (...a) => {
      const page = await newPage(...a);
      await guard(page.context());
      return page;
    };
    return browser;
  };

  // --- fetch -------------------------------------------------------------------------------
  const realFetch = globalThis.fetch;
  globalThis.fetch = (input, init = {}) => {
    const url = typeof input === 'string' ? input : input?.url;
    const isRemote = remote(url);
    if (isRemote && String(init.method || 'GET').toUpperCase() !== 'GET') {
      return Promise.reject(new Error(`auth-preload: refused a ${init.method} to the LIVE service (${url})`));
    }
    const token = isRemote ? REMOTE_TOKEN : targets(url) ? TOKEN : '';
    if (!token) return realFetch(input, init);
    const headers = new Headers(init.headers || (typeof input === 'object' ? input.headers : undefined));
    if (!headers.has('cookie')) headers.set('cookie', `edu_session=${token}`);
    return realFetch(input, { ...init, headers });
  };

  // --- curl via execFileSync ----------------------------------------------------------------
  const cp = createRequire(import.meta.url)('node:child_process');
  const realExec = cp.execFileSync;
  cp.execFileSync = (file, args, options) => {
    if (file === 'curl' && Array.isArray(args) && args.some((a) => targets(a)) && !args.includes('--no-gate-session')) {
      return realExec(file, ['-H', `Cookie: edu_session=${TOKEN}`, ...args], options);
    }
    if (file === 'curl' && Array.isArray(args)) return realExec(file, args.filter((a) => a !== '--no-gate-session'), options);
    return realExec(file, args, options);
  };
  syncBuiltinESMExports();
}
