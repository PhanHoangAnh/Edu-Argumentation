#!/usr/bin/env node
/**
 * gate-r-read.mjs — R-suite: the Phase 03 READ routes and the guarded file surface.
 * Tier 1/2. curl only, no browser.
 *
 * edu-replatform Phase 03, checklist D1-D7c.
 *
 * TARGET: $R_BASE (default http://127.0.0.1:8795 — the LOCAL preview). The remote
 * http://192.168.100.66:8792 is the same assertion set against the deployed stack.
 *
 * ⛔ THE ../ TRAVERSAL FORM IS VACUOUS WITHOUT --path-as-is. RE-PROVEN ON THE WIRE 21-09-26:
 *      curl '<base>/book/geron-homl3/../../etc/passwd'
 *    reports url_effective = '<base>/etc/passwd'. curl COLLAPSES ../ CLIENT-SIDE, so the
 *    server never sees a traversal, returns 404, and the gate reads green whether or not the
 *    guard exists. --path-as-is is MANDATORY on that form and MUST NOT be added to the other
 *    two, which arrive intact without it.
 *
 * ⛔ NON-VACUITY FLOOR. "Everything 404s" is not a security property, it is a broken server.
 *    R-D8 asserts the legitimate files DO serve 200 with a non-zero body, so a refusal is
 *    evidence of a guard rather than evidence of an outage.
 *
 * ⛔ import-report.json: ASSERT IT EXISTS ON DISK BEFORE ASSERTING IT IS NOT SERVABLE (E12).
 *    Measured 21-09-26: present under openintro-statistics-2019-1045f2f5 (233,030 bytes),
 *    ABSENT under geron-homl3. A 404 under geron-homl3 is a NOT-FOUND, not a refusal, so only
 *    the module that actually holds the file is a real gate.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { normalize, join } from 'node:path';

const BASE = process.env.R_BASE || 'http://127.0.0.1:8795';
// E3 / C-5: bind the module ids EXPLICITLY. Never run a command containing a literal <moduleId>.
const MODULE = process.env.R_MODULE || 'geron-homl3';
// The module that actually carries import-report.json. Locally the openintro package is
// mirrored as demo-book; on nn it is openintro-statistics-2019-1045f2f5.
const REPORT_MODULE = process.env.R_REPORT_MODULE || 'demo-book';
const LIB_ROOT = process.env.R_LIB_ROOT || '/var/tmp/edu-smoke/lib';
const ASSET = process.env.R_ASSET || 'eq-1-1.png';

const results = [];
const check = (id, pass, detail) => {
  results.push({ id, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${id}  ${detail}`);
};

function curl(path, { pathAsIs = false } = {}) {
  const args = ['-s', '-m', '20', '-o', '/dev/null', '-w', '%{http_code} %{size_download} %{url_effective}'];
  if (pathAsIs) args.push('--path-as-is');
  args.push(BASE + path);
  try {
    const [code, size, eff] = execFileSync('curl', args, { encoding: 'utf8' }).trim().split(' ');
    return { code: Number(code), size: Number(size), eff };
  } catch (e) {
    return { code: -1, size: 0, eff: `CURL_FAILED ${e.message}` };
  }
}

function getJson(path) {
  try {
    const body = execFileSync('curl', ['-s', '-m', '20', BASE + path], { encoding: 'utf8' });
    return { ok: true, body, json: JSON.parse(body) };
  } catch (e) {
    return { ok: false, body: String(e.message), json: null };
  }
}

/* ---------------- R-D1..R-D5: the five READ routes ---------------- */
const gen = getJson('/api/general');
check('R-D1 GET /api/general returns the three general settings',
  gen.ok && ['ai_question_count', 'fresh_quiz_size', 'require_access_token'].every((k) => k in (gen.json || {})),
  gen.ok ? `keys=${Object.keys(gen.json).join(',')}` : gen.body);

const mods = getJson('/api/modules');
const books = mods.json?.books;
const packaged = Array.isArray(books) ? books.filter((b) => b.book) : [];
check('R-D2 GET /api/modules lists the real packaged books with base/book/moduleId',
  Array.isArray(books) && books.length > 0 && packaged.length === books.filter((b) => b.base).length
    && packaged.every((b) => b.base === `book/${b.file}/` && typeof b.moduleId === 'string' && b.chapters > 0 && b.questions > 0),
  Array.isArray(books)
    ? books.map((b) => `${b.file}(ch=${b.chapters},q=${b.questions},id=${b.moduleId})`).join(' ')
    : mods.body.slice(0, 200));

// module_key falls back to the legacy id rather than 400ing, so a stale bookmark degrades to
// the default book. The gate asserts BOTH directions, or the fallback could swallow everything.
const pGood = getJson(`/api/progress?module=${MODULE}`);
const pBad = getJson('/api/progress?module=../evil');
check('R-D3 GET /api/progress echoes a valid module and falls back for an invalid one',
  pGood.json?.module === MODULE && typeof pGood.json?.completed === 'object'
    && pBad.json?.module === 'geron-homl3',
  `valid->${pGood.json?.module} invalid('../evil')->${pBad.json?.module}`);

const prov = getJson('/api/provider');
check('R-D4 GET /api/provider reports readiness only — no credential field of any kind',
  prov.ok && prov.json?.ready === false
    && !/key|token|secret/i.test(JSON.stringify(Object.entries(prov.json).filter(([, v]) => typeof v === 'string' && v).map(([k]) => k))),
  prov.ok ? prov.body.trim() : prov.body);

const set = getJson('/api/settings');
check('R-D5 GET /api/settings never returns a key — only whether one is set',
  set.ok && set.json?.api_key_set === false && set.json?.access_token_set === false
    && !('api_key' in (set.json || {})) && !('access_token' in (set.json || {}))
    && typeof set.json?.general === 'object',
  set.ok ? set.body.trim().slice(0, 220) : set.body);

/* ---------------- R-D6: import-report.json, with the existence floor ---------------- */
const reportPath = `${LIB_ROOT}/${REPORT_MODULE}/import-report.json`;
const reportExists = existsSync(reportPath);
const reportSize = reportExists ? statSync(reportPath).size : 0;
const rep = curl(`/book/${REPORT_MODULE}/import-report.json`);
check('R-D6 import-report.json EXISTS on disk and is REFUSED by the allowlist (403/404)',
  reportExists && reportSize > 0 && (rep.code === 403 || rep.code === 404),
  reportExists
    ? `on disk ${reportSize} bytes at ${REPORT_MODULE}; HTTP ${rep.code} (a 404 on a module that LACKS the file proves nothing — that is why existence is asserted first)`
    : `⛔ FLOOR FAILED: ${reportPath} does not exist, so the HTTP ${rep.code} is a not-found, not a refusal`);

/* ---------------- R-D7: traversal, three encodings, both prefixes ----------------
 *
 * ⛔ THE PLAN'S OWN TRAVERSAL STRING IS VACUOUS. MEASURED 21-09-26 AGAINST A SERVER WITH THE
 *    CONTAINMENT GUARD FULLY REMOVED:
 *
 *      /book/<id>/../../etc/passwd                     -> 404   (guard REMOVED)
 *      /book/<id>/../../../../../etc/passwd            -> 200, 2914 B of /etc/passwd
 *      /book/<id>/../<other-book>/import-report.json   -> 200, 233030 B
 *
 *    Two ../ climbs only to <LIBRARY_ROOT>/../etc/passwd, which does not exist anywhere —
 *    locally or on nn. The probe therefore returns 404 whether or not a guard exists, which
 *    is the twelfth vacuous gate found in this program and the first one written INTO a plan.
 *
 * ⛔ AN ABSOLUTE-DEPTH TRAVERSAL IS ENVIRONMENT-DEPENDENT and goes silently vacuous the moment
 *    the deploy path changes depth (local lib is 4 levels down, nn's is 6). The PRIMARY probe
 *    is therefore a SIBLING ESCAPE — one ../ into the neighbouring book's import-report.json.
 *    It is a real file, it is a real containment violation, and its reachability does not
 *    depend on how deep the library root sits.
 *
 * ⛔ REACHABILITY FLOOR. Every probe asserts that the path it resolves to EXISTS ON DISK. A
 *    traversal that cannot reach a real file cannot be refused, so a green result would mean
 *    nothing. This floor is what makes the difference above impossible to reintroduce.
 */
const escapeTargets = [
  // { label, rawSuffix, encodedSuffixes, resolvesTo }
  {
    label: 'sibling-book escape',
    raw: `/../${REPORT_MODULE}/import-report.json`,
    encoded: [`/%2e%2e%2f${REPORT_MODULE}%2fimport-report.json`, `/..%2f${REPORT_MODULE}%2fimport-report.json`],
    resolvesTo: join(LIB_ROOT, REPORT_MODULE, 'import-report.json'),
  },
  {
    label: 'absolute /etc/passwd',
    raw: '/' + '../'.repeat(12) + 'etc/passwd',
    encoded: ['/' + '%2e%2e%2f'.repeat(12) + 'etc%2fpasswd', '/' + '..%2f'.repeat(12) + 'etc%2fpasswd'],
    resolvesTo: '/etc/passwd',
  },
];

const tRows = [];
let tBad = 0;
let floorBad = 0;
for (const t of escapeTargets) {
  if (!existsSync(t.resolvesTo)) { floorBad += 1; tRows.push(`FLOOR-MISS(${t.label}->${t.resolvesTo})`); continue; }
  for (const prefix of [`/book/${MODULE}`, `/assets/${MODULE}`]) {
    // raw form: --path-as-is MANDATORY. encoded forms: plain curl, they arrive intact.
    const probes = [[t.raw, true], [t.encoded[0], false], [t.encoded[1], false]];
    for (const [suffix, pathAsIs] of probes) {
      const r = curl(prefix + suffix, { pathAsIs });
      const refused = r.code === 403 || r.code === 404;
      if (!refused) tBad += 1;
      tRows.push(`${prefix.split('/')[1]}|${t.label}|${pathAsIs ? 'raw' : suffix.includes('%2e') ? '%2e%2e%2f' : '..%2f'}=${r.code}${refused ? '' : `/${r.size}B <-- SERVED`}`);
    }
  }
}
check('R-D7 path traversal refused (403/404) on /book/ AND /assets/, three encodings, TWO escape targets',
  tBad === 0 && floorBad === 0,
  `${tRows.join(' ')} — RESIDUAL: three encodings, NOT the whole class (no null-byte, no UTF-8 overlong, no backslash form)`);

check('R-D7c FLOOR: every traversal probe resolves to a file that REALLY EXISTS',
  floorBad === 0,
  floorBad === 0
    ? `${escapeTargets.map((t) => `${t.label}->${t.resolvesTo} EXISTS`).join('; ')} — proven 21-09-26: with the guard removed the sibling escape served 233030 B and the 12x-../ form served 2914 B, while the plan's own ../../etc/passwd form returned 404 UNGUARDED`
    : `⛔ ${floorBad} probe target(s) do not exist — those probes cannot go red and prove nothing`);

// The client-side collapse is asserted, so nobody "simplifies" --path-as-is away later.
const naivePath = `/book/${MODULE}/../${REPORT_MODULE}/import-report.json`;
const naive = curl(naivePath, { pathAsIs: false });
// The assertion is that curl REWROTE the URL — i.e. the ../ never left this machine. Testing
// for a particular resulting path is wrong: a single ../ collapses to something that still
// contains /book/, and the gate would false-red on correct behaviour.
check('R-D7b --path-as-is is MANDATORY on the raw ../ form (curl collapses it client-side)',
  naive.eff !== BASE + naivePath,
  `requested ${naivePath} but curl sent url_effective=${naive.eff} — the ../ was resolved CLIENT-SIDE, so that form without the flag tests NOTHING`);

/* ---------------- R-D8: the non-vacuity floor — legitimate files DO serve ---------------- */
const mj = curl(`/book/${MODULE}/module.json`);
const asset = curl(`/book/${MODULE}/assets/${ASSET}`);
const modelVariant = curl(`/book/${MODULE}/assets/${ASSET.replace('.png', '.model.png')}`);
const assetsIndex = curl(`/book/${MODULE}/assets/assets.json`);
check('R-D8 FLOOR: the legitimate book file and asset DO serve 200 with a body',
  mj.code === 200 && mj.size > 1000 && asset.code === 200 && asset.size > 0,
  `module.json=${mj.code}/${mj.size}B asset ${ASSET}=${asset.code}/${asset.size}B (without this floor, a dead server reads as a perfectly guarded one)`);

check('R-D8b the allowlist is NARROW: .model.png and assets.json sit beside a served asset and are refused',
  (modelVariant.code === 403 || modelVariant.code === 404) && (assetsIndex.code === 403 || assetsIndex.code === 404),
  `${ASSET.replace('.png', '.model.png')}=${modelVariant.code} assets.json=${assetsIndex.code} — same directory as the 200 above, so this is the allowlist, not a missing folder`);

/* ---------------- R-D9: HTTP/1.1, never 1.0 ---------------- */
// On the stdlib default of 1.0 the server closed pooled sockets silently and every first
// request failed as a bare "Failed to fetch" with NOTHING in the access log.
let httpVer = 'unknown';
try {
  httpVer = execFileSync('curl', ['-s', '-m', '20', '-o', '/dev/null', '-w', '%{http_version}', `${BASE}/api/health`], { encoding: 'utf8' }).trim();
} catch { /* leave unknown */ }
check('R-D9 the service answers HTTP/1.1 (never 1.0 — silent socket close, empty access log)',
  httpVer === '1.1', `http_version=${httpVer}`);

console.log(`\n${results.filter((r) => r.pass).length}/${results.length} passed`);
const failed = results.filter((r) => !r.pass);
if (failed.length) console.log('FAILED: ' + failed.map((r) => r.id).join(', '));
if (failed.length) process.exit(1);
