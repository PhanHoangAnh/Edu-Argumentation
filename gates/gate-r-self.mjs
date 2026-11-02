#!/usr/bin/env node
/**
 * gate-r-self.mjs — THE R- SUITE'S OWN INVARIANT CHECK, and the home of the frozen
 * DOM-contract sha256 pin.
 *
 * edu-replatform Phase 03, checklist E0a / E0b. Runs LAST — it parses the transcripts the
 * R- suites above already produced (R5), so it launches no browser and re-runs nothing.
 *
 * ⛔⛔ WHY THE PIN BELOW IS THE MOST IMPORTANT LINE IN THE PHASE.
 *
 *   gates/selector-contract.json is GENERATED FROM THE GATE SOURCES by
 *   gen-selector-contract.mjs. A React suite that queries fewer things therefore regenerates
 *   a SMALLER contract and then passes against it — green, and meaningless. That is the
 *   A-G17 failure in a new costume (A-G17 passed 21/21 against an unfixed file).
 *
 *   So the React gates read selector-contract.FROZEN.json, never the regenerated file, and
 *   this pin is what stops the frozen copy being quietly re-frozen smaller. Regeneration is
 *   a Phase 04 decision, not a Phase 03 convenience.
 *
 * ⛔ THE PIN WAS TAKEN **AFTER** knownAbsent WAS ADDED, never before. knownAbsent does NOT
 *   exist in selector-contract.json; E1c assertions 2 and 3 read it, and freezing the file
 *   unchanged would leave them red forever — or, worse, "fixed" with `?? []`, which makes
 *   assertion 3 ("each entry genuinely does not resolve") VACUOUS ON AN EMPTY LIST.
 *   ⛔ `?? []` IS BANNED. RS-KNOWNABSENT asserts the list is non-empty and is EXACTLY
 *   ['#home-screen'], so a second phantom cannot be added to dodge a red gate.
 *
 * ⛔ #home-screen IS A GENUINE PHANTOM, NOT A MISSING ELEMENT. Measured 21-09-26: it is in
 *   the contract's `ids`; it is queried by b15probe.mjs:12; and
 *   `grep -c home-screen aws-quiz-app/index.html` = 0. DO NOT CREATE AN ELEMENT TO SATISFY A
 *   TYPO — if #home-screen ever turns out to be load-bearing that is a ruling, not an edit.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const OUT = process.env.R_OUT_DIR || '/var/tmp/p3-react';
const FROZEN = path.join(DIR, 'selector-contract.frozen.json');

// Taken 21-09-26 with `sha256sum selector-contract.frozen.json`, AFTER knownAbsent was added.
const FROZEN_SHA = '5e54f0d033b8f889629ab7bc9da05b163d6b1b4299fbe5c933c632cc98df83c7';

const results = [];
const check = (id, pass, detail) => {
  results.push({ id, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${id}  ${detail}`);
};

// TWO trailing spaces. The one-space form also matches the "FAILED: ..." summary line and
// over-counts a red run.
const countLines = (f) => {
  const p = path.join(OUT, f);
  if (!fs.existsSync(p)) return -1;
  return fs.readFileSync(p, 'utf8').split('\n').filter((l) => /^(PASS|FAIL)  /.test(l)).length;
};

/* ---- RS-COUNT: each R- suite emits exactly the number of result lines it claims ---- */
for (const [tag, file, want] of [
  ['gate-r-sep.mjs', 'rsep.txt', 6],
  ['gate-r-read.mjs', 'rread.txt', 12],
  ['gate-r-contract.mjs', 'rcontract.txt', 7],
  ['gate-r-dom.mjs', 'rdom.txt', 9],
  ['gate-r-ro.mjs', 'rro.txt', 4],   // 3 -> 4 on 30-09-26: R-RO4 no native browser dialogs (defect D)
  // ⚑ ADDED 22-09-26 (EVL cycle 2, gap G-EVL-4). Seven Exit Gate assertions had NO COMMAND
  //    ANYWHERE and were about to be frozen as Phase 04's fence in that state. A suite whose
  //    self-check disagrees with its own registrations is the next vacuous gate, so this row
  //    and run-gates-react.sh's spec list move together, always.
  ['gate-r-trap.mjs', 'rtrap.txt', 8],
  // ⚑ ADDED 22-09-26 (EVL fix 004). The journey suite — the first gate here that finishes a
  //    quiz. D-10 (the run never reached #result-screen) was invisible to all 54 preceding
  //    gates because every one of them measures a SURFACE and stops. This row and
  //    run-gates-react.sh's spec list move together, always: a suite whose self-check
  //    disagrees with its own registrations is the next vacuous gate.
  // ⚑ 4 -> 6 on 22-09-26 (EVL fix 005): R-J5 (D-11, the closed card leaked its explanation)
  //    and R-J6 (D-12, only 2 of 4 cards resolved). Moves WITH run-gates-react.sh's spec row.
  ['gate-r-journey.mjs', 'rjourney.txt', 6],
  // ⛑ THREE ROWS ADDED 22-09-26 (item A / D / E supplement). Each suite closes an Exit
  //    Gate row that NAMED A COMMAND WHICH DID NOT EXIST — the same hole as G-EVL-4, where
  //    seven assertions were neither passing nor failing but ABSENT, and the R- vector was
  //    about to be frozen as Phase 04's fence in that state.
  //    · rtheme  — item A: the Tailwind CDN is gone; the BUILD carries all 10 theme classes.
  //    · rmodal  — item E: the quiz-setup picker has a visible way out, with the D-8 and
  //                 B6/B6b fences asserted so a later layering change cannot undo them.
  //    · rr6     — item D: ruling R6's four-condition placement test, DATA and RENDERED.
  //    ⛔ These rows and run-gates-react.sh's spec list move together, always: a suite whose
  //      self-check disagrees with its own registrations is the next vacuous gate.
  ['gate-r-theme.mjs', 'rtheme.txt', 6],
  ['gate-r-modal.mjs', 'rmodal.txt', 5],
  ['gate-r6-placement.mjs', 'rr6.txt', 3],
  // ⚑ Phase 04 (23-09-26): the write suites — routes at the API, and every write through the UI.
  ['gate-r-writeui.mjs', 'rwriteui.txt', 10],
  ['gate-r-parity.mjs', 'rparity.txt', 9],
  ['gate-r-write.mjs', 'rwrite.txt', 15],
  // ⚑ Phase 06a (23-09-26, ruling R25): sign-in, owner-only admin, per-account progress, wrong
  //   answers, path routing. Moves WITH run-gates-react.sh's R_NO_PRELOAD=1 run_suite line.
  ['gate-r-auth.mjs', 'rauth.txt', 22],
  // 23-09-26 — forwarded-header trust for the nginx public door. Moves WITH run-gates-react.sh's rproxy line.
  ['gate-r-proxy.mjs', 'rproxy.txt', 6],
  // ⚑ 23-09-26 (user ruling): 9router combo per account and per job, incl. the legacy :8767 tutor.
  //   Moves WITH run-gates-react.sh's gate-r-route.mjs run_suite line.
  //   10 -> 12 on 29-09-26 (study-rooms-qna P2): M-QNA-NORMAL / M-QNA-CLAUDE.
  ['gate-r-route.mjs', 'rroute.txt', 12],
  // ⚑ 29-09-26 (study-rooms-qna P2): the Q&A examiner API (parser, pass rule, bucket, budget,
  //   refusal). Moves WITH run-gates-react.sh's gate-r-qna.mjs run_suite line.
  //   28 -> 30 on 30-09-26: QNA-UI-NOLOOP + QNA-UI-LOADING (defects B, C).
  //   30 -> 39 on 30-09-26: P2b setup / pass mark / hint / redo.
  ['gate-r-qna.mjs', 'rqna.txt', 39],
  // ⚑ 30-09-26 (study-rooms-qna P3): live rooms over WebSocket (auth before accept, secrecy, caps,
  //   expiry, scoring). Moves WITH run-gates-react.sh's gate-r-ws.py run_suite line.
  ['gate-r-ws.py', 'rws.txt', 27],
  // ⚑ 23-09-26 (user): style parity of the Account + sign-in pages and the top bar's LOG OUT against
  //   the home page, by getComputedStyle. Moves WITH run-gates-react.sh's R_NO_PRELOAD=1 rstyle line.
  //   14 -> 19 on 23-09-26: LOG OUT became an icon (R-S-NAV-LOGOUT reworked) + R-S-NAV-ORDER,
  //   R-S-HEADER-ALIGN, R-S-NOSHIFT, R-S-TOC-ROW, R-S-TOC-KEYS added.
  ['gate-r-style.mjs', 'rstyle.txt', 19],
]) {
  const n = countLines(file);
  check(`RS-COUNT ${tag} emits exactly ${want} result lines`, n === want,
    n < 0 ? `transcript ${file} MISSING — run via run-gates-react.sh` : `counted=${n} expected=${want}`);
}

/* ---- RS-FROZEN-SHA: the frozen DOM contract is byte-identical to what was pinned ---- */
const frozenExists = fs.existsSync(FROZEN);
const frozenSha = frozenExists
  ? createHash('sha256').update(fs.readFileSync(FROZEN)).digest('hex')
  : 'ABSENT';
check('RS-FROZEN-SHA selector-contract.frozen.json matches the pin (it cannot be re-frozen smaller)',
  frozenSha === FROZEN_SHA,
  `got=${frozenSha} pinned=${FROZEN_SHA}`);

/* ---- RS-KNOWNABSENT: exactly one named phantom, and the list is NOT empty ---- */
let ka = null;
let selectors = null;
try {
  const c = JSON.parse(fs.readFileSync(FROZEN, 'utf8'));
  ka = c.knownAbsent;
  selectors = c.counts?.selectors;
} catch { /* leave null */ }
check('RS-KNOWNABSENT knownAbsent is EXACTLY ["#home-screen"] and non-empty (`?? []` is banned)',
  Array.isArray(ka) && ka.length === 1 && ka[0] === '#home-screen' && selectors === 47,
  `knownAbsent=${JSON.stringify(ka)} counts.selectors=${selectors} (an empty list makes "each entry genuinely does not resolve" vacuous)`);

/* ---- RS-FROZEN-SOURCE: no R- gate may read the REGENERATED contract ---- */
// A gate that reads selector-contract.json passes against whatever the current gate sources
// happen to query — which is the whole failure this freeze exists to prevent.
// Scanned LINE-WISE with comment lines skipped. A file-wide regex flags this very file,
// whose prose necessarily names the regenerated contract in order to ban it — a gate that
// cannot describe what it forbids is a gate nobody will keep.
const rFiles = fs.readdirSync(DIR).filter((f) => /^gate-r-.*\.mjs$/.test(f));
const offenders = [];
for (const f of rFiles) {
  const lines = fs.readFileSync(path.join(DIR, f), 'utf8').split('\n');
  lines.forEach((l, i) => {
    const t = l.trim();
    if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return;   // prose
    const code = l.replace(/selector-contract\.frozen\.json/g, '');
    if (/selector-contract\.json/.test(code)) offenders.push(`${f}:${i + 1}`);
  });
}
// Assembled from fragments for the same reason gate-self.mjs assembles its ban list: a gate
// that forbids a string cannot contain that string, or it matches ITSELF.
const GENERATED = 'selector-contract' + '.json';
check(`RS-FROZEN-SOURCE no gate-r-*.mjs reads the REGENERATED ${GENERATED}`,
  offenders.length === 0,
  offenders.length ? `offenders (non-comment lines)=${offenders.join(' ')}` : `scanned ${rFiles.length} R- gate file(s): ${rFiles.join(' ')}`);

/* ---- RS-PORTABLE: the ban-list, scoped, same rule as gate-self.mjs ---- */
// /var/tmp/edu-smoke and /var/tmp/p3-* are REQUIRED by the runners and are real disk on both
// of the user's machines, so a blanket "no absolute paths" ban would false-red on correct code.
// The pattern is assembled from fragments so this line cannot match ITSELF.
const EXEMPT = 'self-ban' + '-exempt';
const BAN = new RegExp(['/home/' + 'daniel', '/Use' + 'rs/', '/var/tmp/' + 'edu-verify',
                        'chromium' + '-12[0-9][0-9]'].join('|'));
const scan = [];
for (const f of [...rFiles, 'run-gates-react.sh', 'selector-contract.frozen.json']) {
  const p = path.join(DIR, f);
  if (!fs.existsSync(p)) continue;
  fs.readFileSync(p, 'utf8').split('\n').forEach((l, i) => {
    if (BAN.test(l) && !l.includes(EXEMPT)) scan.push(`${f}:${i + 1}`);
  });
}
check('RS-PORTABLE no machine-local path or pinned chromium revision in the R- suite',
  scan.length === 0,
  scan.length ? `hits=${scan.join(' ')}` : 'ban-list clean: home dir, Mac home, edu-verify, pinned chromium rev');

console.log(`\n${results.filter((r) => r.pass).length}/${results.length} passed`);
const failed = results.filter((r) => !r.pass);
if (failed.length) console.log('FAILED: ' + failed.map((r) => r.id).join(', '));
if (failed.length) process.exit(1);
