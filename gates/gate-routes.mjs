#!/usr/bin/env node
/**
 * gate-routes.mjs — the route-parity gate. Tier 1, OFFLINE, no browser, no server.
 *
 * Phase 02 of the edu-replatform program (checklist items F1/F2).
 *
 * WHAT IT DOES
 *   Statically parses the FROZEN legacy server (aws-quiz-app/edu_server.py) for its API
 *   route inventory, statically parses the new FastAPI app for the routes it declares,
 *   and diffs the two. The result is a burn-down counter that Phases 3 and 4 drive to 0.
 *
 * REQUIRED CWD
 *   ml/study/Edu-Argumentation/      run as:  node gates/gate-routes.mjs
 *                                    or:      npm --prefix gates run gate-routes
 *   (the npm script runs with gates/ as cwd, so it walks up one level; both work)
 *
 * WHY THE SELF-CHECK EXISTS — read this before touching the regexes
 *   "15 missing" and "the regex matched nothing" are the SAME OUTPUT. A differ that
 *   reports a clean burn-down against an empty extraction is worse than no gate at all,
 *   because it is green for the wrong reason and nobody looks again.
 *
 *   So before any diff is printed, the extractor asserts it found EXACTLY 5 GET and
 *   EXACTLY 10 POST routes in the legacy file. Any other count exits non-zero with
 *   EXTRACTOR FAILED and prints NO diff. 5 + 10 = 15 is a measured fact about a file
 *   that is frozen and will never change again:
 *     - 5 GET   : the `route == "/api/..."` branches of do_GET (L1091-1116)
 *     - 7 POST  : the 7-entry allowlist tuple in do_POST
 *   ⚑ RULING R24 (23-09-26): the 3 RUN_ROUTES (/api/run, /api/run/stop,
 *     /api/run/reset-kernel) were REMOVED from the legacy server with the code runner.
 *     The contract was 5 GET + 10 POST = 15; it is now 5 GET + 7 POST = 12, and the
 *     name-list sha below was re-pinned for exactly that one reason. The port must NOT
 *     carry the run routes either (R24 binds :8792 too).
 *
 *   ⚠ The three routinely dropped in a rewrite are /api/run/stop, /api/run/reset-kernel
 *   and /api/general. A port that moves "the 12" silently loses them.
 *
 * ⛔ NO RUNTIME INTROSPECTION ENDPOINT. It would be a 16th route on a frozen 15-route
 *    contract, i.e. the gate would change the thing it measures. The FastAPI side is
 *    parsed statically, from source, for the same reason.
 *
 * FILE-SERVING SURFACE IS NOT PART OF THIS COUNT. It is 2 prefix-dispatched routes plus
 * the static fallthrough (/assets/<moduleId>/<file> at L1087, /book/<id>/... at L1089,
 * then super().do_GET()). Those are tracked in the phase plan's frozen contract table,
 * not here — they are not `/api/` routes and counting them would break the 15.
 */

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Hardcoded, relative to the nested repo root — NOT to process.cwd(), so the gate gives
// the same answer from ml/study/Edu-Argumentation/ and from gates/.
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const LEGACY = join(REPO_ROOT, 'aws-quiz-app', 'edu_server.py');
const FASTAPI_APP = join(REPO_ROOT, 'app', 'backend', 'main.py');
const ADDONS_DIR = join(REPO_ROOT, 'app', 'backend', 'addons');

const EXPECTED_GET = 5;
const EXPECTED_POST = 7;   // was 10 until ruling R24 removed the 3 run routes

// ---------------------------------------------------------------------------
// E0e / Phase-02 FAIL F-4 — THE NAME LIST, NOT ONLY THE COUNTS.
//
// The count self-check above cannot see a RENAME. Rename /api/run/stop to /api/run/halt in
// the (frozen) legacy file and the extractor still finds 5 GET + 10 POST, the burn-down still
// prints "15 missing · 0 extra", and the gate reads as a faithfully tracked contract. That is
// harmless at 15-missing and LOAD-BEARING the moment Phase 3 starts driving the number down:
// a ported route could be matched against a name the legacy server never had.
//
// So the identity of the 15 is pinned too. sha256 over the sorted "METHOD /path" lines,
// newline-joined with a trailing newline. The legacy server is FROZEN and will never change
// again, so this constant can only move if the PARSE broke or someone edited a frozen file —
// both of which are the failure this pin exists to surface.
// Re-pinned 23-09-26 for ruling R24 ONLY: the old list (sha bdd9eef3…) minus the 3 /api/run* routes.
const EXPECTED_LIST_SHA = '7e399903a382eb99ed517d4e487ee8bf2b6cbf21538e9fe38b60fda0584ac142';

// Routes the new app is allowed to have that the legacy app never had.
const ALLOWED_EXTRA = new Set([
  'GET /api/health',
  'GET /api/account/stats', // Phase 06a (auth/accounts), allow-listed 29-09-26
  'GET /api/accounts', // Phase 06a (auth/accounts), allow-listed 29-09-26
  'GET /api/auth/me', // Phase 06a (auth/accounts), allow-listed 29-09-26
  'POST /api/account/password', // Phase 06a (auth/accounts), allow-listed 29-09-26
  'POST /api/accounts', // Phase 06a (auth/accounts), allow-listed 29-09-26
  'POST /api/accounts/claude-access', // Phase 06a (auth/accounts), allow-listed 29-09-26
  'POST /api/auth/login', // Phase 06a (auth/accounts), allow-listed 29-09-26
  'POST /api/auth/logout', // Phase 06a (auth/accounts), allow-listed 29-09-26
  'POST /api/book/delete', // Phase 06a (auth/accounts), allow-listed 29-09-26
  'POST /api/wrong-answers', // Phase 06a (auth/accounts), allow-listed 29-09-26
  'POST /api/qna/question', // add-on qna (P2), 29-09-26
  'POST /api/qna/grade', // add-on qna (P2), 29-09-26
  'POST /api/qna/ask', // add-on qna (P2), 29-09-26
  'POST /api/qna/hint', // add-on qna (P2b hint), 30-09-26
  'POST /api/rooms', // add-on live rooms (P3), 30-09-26
  'GET /api/rooms/{code}', // add-on live rooms (P3), 30-09-26
  'WS /api/rooms/{code}/ws', // add-on live rooms (P3), 30-09-26
  'POST /api/review/seen', // spaced repetition (main.py), 21-10-26 — allow-listed late, 22-10-26
  'POST /api/review/grade', // spaced repetition (main.py), 21-10-26 — allow-listed late, 22-10-26
  'GET /api/review/due', // spaced repetition (main.py), 21-10-26 — allow-listed late, 22-10-26
  'GET /api/review/stats', // add-on study_more (exam-recall-suite P1), 22-10-26
  'GET /api/study/prefs', // add-on study_more (exam-recall-suite P1), 22-10-26
  'POST /api/study/prefs', // add-on study_more (exam-recall-suite P1), 22-10-26
  'GET /api/flags', // add-on study_more (exam-recall-suite P1), 22-10-26
  'POST /api/flags', // add-on study_more (exam-recall-suite P1), 22-10-26
  'POST /api/answers', // add-on study_more (exam-recall-suite P1), 22-10-26
  'GET /api/history', // add-on history (exam-recall-suite P2), 22-10-26
  'GET /api/mastery', // add-on history (exam-recall-suite P2), 22-10-26
  'GET /api/exam/open', // add-on exam (exam-recall-suite P3), 22-10-26
  'POST /api/exam/start', // add-on exam (exam-recall-suite P3), 22-10-26
  'POST /api/exam/answer', // add-on exam (exam-recall-suite P3), 22-10-26
  'POST /api/exam/flag', // add-on exam (exam-recall-suite P3), 22-10-26
  'POST /api/exam/finish', // add-on exam (exam-recall-suite P3), 22-10-26
]);
// ⚑ V6 (29-09-26): this gate compares the app's /api/ routes against the frozen legacy list +
//   this allow-list ONLY. Each add-on phase adds its own routes here with a dated comment.

function die(msg) {
  console.error(msg);
  process.exit(1);
}

function read(path, label) {
  if (!existsSync(path)) die(`EXTRACTOR FAILED: ${label} not found at ${path}`);
  return readFileSync(path, 'utf8');
}

/* -------------------------------------------------------------------------- */
/* Legacy extraction                                                          */
/* -------------------------------------------------------------------------- */
function extractLegacy(src) {
  // GET: the do_GET body dispatches on `route == "/api/..."`. Scope to do_GET so a
  // same-shaped comparison elsewhere in the file cannot inflate the count.
  const doGet = /def do_GET\(self\)[\s\S]*?(?=\n    def |\ndef |$)/.exec(src);
  if (!doGet) die('EXTRACTOR FAILED: could not locate do_GET in the legacy server');
  const gets = [...doGet[0].matchAll(/route == "(\/api\/[^"]+)"/g)].map((m) => m[1]);

  // POST: the allowlist tuple in do_POST. (Until R24 the 3 RUN_ROUTES were spliced onto it
  // with `+`; a leftover `+ RUN_ROUTES` now fails the parse on purpose.)
  const doPost = /def do_POST\(self\)[\s\S]*?(?=\n    def |\ndef |$)/.exec(src);
  if (!doPost) die('EXTRACTOR FAILED: could not locate do_POST in the legacy server');
  const guard = /route not in \(([\s\S]*?)\):/.exec(doPost[0]);
  if (!guard) die('EXTRACTOR FAILED: could not locate the do_POST allowlist tuple');
  const allow = [...guard[1].matchAll(/"(\/api\/[^"]+)"/g)].map((m) => m[1]);
  if (/RUN_ROUTES/.test(src)) die('EXTRACTOR FAILED: RUN_ROUTES is back in the legacy server (ruling R24 removed it)');

  return {
    get: [...new Set(gets)].sort(),
    post: [...new Set(allow)].sort(),
  };
}

/* -------------------------------------------------------------------------- */
/* New app extraction                                                         */
/* -------------------------------------------------------------------------- */
// Returns { api, nonApi }. The diff is scoped to /api/ routes ONLY, because the frozen
// contract is a 15-route API contract. The legacy app's "/" is not a route at all — it is
// the stdlib static fallthrough (row 3 of the plan's file-serving table) — so comparing the
// new app's SPA index route against it would report a permanent phantom "extra" and train
// whoever runs this gate to ignore the extra counter. Non-API routes are printed for
// visibility instead, which is the honest place for them.
function extractFastapi(src) {
  const routes = [...src.matchAll(/@app\.(get|post|put|patch|delete)\(\s*["']([^"']+)["']/g)]
    .map((m) => `${m[1].toUpperCase()} ${m[2]}`);
  const uniq = [...new Set(routes)].sort();
  return {
    api: uniq.filter((r) => r.split(' ')[1].startsWith('/api/')),
    nonApi: uniq.filter((r) => !r.split(' ')[1].startsWith('/api/')),
  };
}

/* -------------------------------------------------------------------------- */
/* Add-on routers (study-rooms-qna P1): app/backend/addons/*.py               */
/* -------------------------------------------------------------------------- */
// APIRouter(prefix="…") + @router.(get|post|put|patch|delete|websocket)("…") -> "METHOD prefix+path"
// (WS for websocket). SELF-CHECK: if addons/__init__.py lists > 0 routers in ADDON_ROUTERS and
// 0 add-on routes parse, the parse broke — exit 1, never a silent "0 extra".
function extractAddons() {
  if (!existsSync(ADDONS_DIR)) return { routes: [], listed: 0 };
  const init = read(join(ADDONS_DIR, '__init__.py'), 'addons/__init__.py');
  const lit = /ADDON_ROUTERS\s*(?::[^=]*)?=\s*\[([\s\S]*?)\]/.exec(init);
  if (!lit) die('EXTRACTOR FAILED: could not locate the ADDON_ROUTERS list literal in addons/__init__.py');
  const listed = [...lit[1].matchAll(/\b[A-Za-z_]\w*\.router\b/g)].length;
  const routes = [];
  for (const f of readdirSync(ADDONS_DIR).filter((n) => n.endsWith('.py') && n !== '__init__.py').sort()) {
    const src = read(join(ADDONS_DIR, f), `addons/${f}`);
    const pm = /APIRouter\(\s*prefix\s*=\s*["']([^"']*)["']/.exec(src);
    const prefix = pm ? pm[1] : '';
    for (const m of src.matchAll(/@router\.(get|post|put|patch|delete|websocket)\(\s*["']([^"']*)["']/g)) {
      routes.push(`${m[1] === 'websocket' ? 'WS' : m[1].toUpperCase()} ${prefix}${m[2]}`);
    }
  }
  if (listed > 0 && routes.length === 0) {
    die(`EXTRACTOR FAILED: ADDON_ROUTERS lists ${listed} router(s) but 0 add-on routes parsed`);
  }
  return { routes: [...new Set(routes)].sort(), listed };
}

/* -------------------------------------------------------------------------- */
const legacySrc = read(LEGACY, 'legacy server');
const legacy = extractLegacy(legacySrc);

// ---- SELF-CHECK. Runs BEFORE any diff is computed or printed. ----
if (legacy.get.length !== EXPECTED_GET || legacy.post.length !== EXPECTED_POST) {
  console.error(
    `EXTRACTOR FAILED: expected ${EXPECTED_GET} GET + ${EXPECTED_POST} POST in the frozen ` +
      `legacy server, found ${legacy.get.length} GET + ${legacy.post.length} POST.`,
  );
  console.error(`  GET  found: ${JSON.stringify(legacy.get)}`);
  console.error(`  POST found: ${JSON.stringify(legacy.post)}`);
  console.error('  The legacy file is FROZEN. A count change means the parse broke, not that');
  console.error('  the contract changed. Fix the extractor; do NOT print a burn-down.');
  process.exit(1);
}
console.log(`EXTRACTOR OK: ${legacy.get.length} GET + ${legacy.post.length} POST`);

const legacyList = [
  ...legacy.get.map((r) => `GET ${r}`),
  ...legacy.post.map((r) => `POST ${r}`),
].sort();
const legacyListSha = createHash('sha256').update(legacyList.join('\n') + '\n').digest('hex');
if (legacyListSha !== EXPECTED_LIST_SHA) {
  console.error('EXTRACTOR FAILED: the route NAME LIST moved (a rename keeps the counts intact).');
  console.error(`  expected sha256 ${EXPECTED_LIST_SHA}`);
  console.error(`  actual   sha256 ${legacyListSha}`);
  console.error('  list:');
  for (const r of legacyList) console.error(`    ${r}`);
  console.error('  The legacy server is FROZEN. Fix the parse or revert the edit; do NOT re-pin.');
  process.exit(1);
}
console.log(`NAME LIST OK: sha256 ${legacyListSha} over ${legacyList.length} sorted routes`);

const expected = new Set([
  ...legacy.get.map((r) => `GET ${r}`),
  ...legacy.post.map((r) => `POST ${r}`),
]);

const fastapi = extractFastapi(read(FASTAPI_APP, 'FastAPI app'));
const addons = extractAddons();
console.log(`ADDONS OK: ${addons.listed} router(s) listed · ${addons.routes.length} route(s) parsed`);
const actual = new Set([...fastapi.api, ...addons.routes.filter((r) => r.split(' ')[1].startsWith('/api/'))]);

const missing = [...expected].filter((r) => !actual.has(r)).sort();
const extra = [...actual].filter((r) => !expected.has(r) && !ALLOWED_EXTRA.has(r)).sort();
const allowed = [...actual].filter((r) => ALLOWED_EXTRA.has(r)).sort();

console.log(`${missing.length} missing · ${extra.length} extra · 0 unexpected`);
if (allowed.length) console.log(`allowed extras: ${allowed.join(', ')}`);
if (fastapi.nonApi.length)
  console.log(`non-API routes (outside the 15-route contract): ${fastapi.nonApi.join(', ')}`);
if (missing.length) {
  console.log('\nnot yet ported:');
  for (const r of missing) console.log(`  - ${r}`);
}
if (extra.length) {
  console.error('\nUNDECLARED ROUTES (not in the frozen contract, not allow-listed):');
  for (const r of extra) console.error(`  - ${r}`);
  process.exit(1);
}
