// gate-self.mjs — THE SUITE'S OWN INVARIANT CHECK.
//
// Why this file exists: both defects P0 fixed survived because nothing watched the
// watchers. gate-q.mjs printed FAILED: and exited 0 for its whole life, so any
// exit-code-based runner was blind to every gate-q regression; and gate-a.mjs's
// A-G18 detail string said "skipped" while the gate was red.
//
// R5 — this gate parses the TRANSCRIPTS run-gates.sh already captured. It does NOT
// grep the source and does NOT re-launch chromium:
//   * grepping source cannot see the template-literal ids inside gate-q.mjs's
//     for-loops, which is exactly the 7-vs-12 confusion PD-3 documented;
//   * a fourth browser launch doubles the run cost for no new signal.
// Therefore run-gates.sh MUST run this LAST.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const OUT = process.env.GATE_OUT_DIR || '/var/tmp/p0-after';
const results = [];
const check = (id, pass, detail) => { results.push({ id, pass }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${id}  ${detail}`); };

// R2: TWO spaces. The one-space form also matches the "FAILED: ..." summary line and
// over-counts a red run (measured: gatea-nobase = 10 with two spaces, 11 with one).
const countLines = f => {
  const p = path.join(OUT, f);
  if (!fs.existsSync(p)) return -1;
  return fs.readFileSync(p, 'utf8').split('\n').filter(l => /^(PASS|FAIL)  /.test(l)).length;
};

// ---- S1-S3: the FROZEN vector, per suite (R1 — new gates never join these) ----
for (const [tag, file, want] of [['gate.mjs','gate.txt',27], ['gate-q.mjs','gateq.txt',12], ['gate-a.mjs','gatea.txt',10]]) {
  const n = countLines(file);
  check(`S-COUNT ${tag} emits exactly ${want} result lines`, n === want,
    n < 0 ? `transcript ${file} MISSING — run via run-gates.sh` : `counted=${n} expected=${want}`);
}

// ---- S4: R4 ban-list. SCOPED, not a blanket "no absolute paths" ----
// /var/tmp/edu-smoke and /var/tmp/p0-* are REQUIRED by run-gates.sh and are real disk
// on both of the user's machines, so a blanket ban would false-red on correct code.
// A gate that bans a string cannot contain that string. Written as one literal this
// line matches ITSELF (observed 21-09-26: 2 false hits in this very file). Two defences,
// both deliberate: the pattern is assembled from fragments, and any line carrying the
// EXEMPT marker is skipped. ⚠ The marker is line-scoped, NOT file-scoped — every other
// line of gate-self.mjs is still scanned, so a real hardcode here is still caught.
const EXEMPT = 'self-ban' + '-exempt';
const BAN = new RegExp(['/home/' + 'daniel', '/Use' + 'rs/', '/var/tmp/' + 'edu-verify',
                        'chromium' + '-12[0-9][0-9]'].join('|'));
const scan = [];
for (const f of fs.readdirSync(DIR)) {
  if (!/\.(mjs|sh|json|py)$/.test(f) || f === 'package-lock.json') continue;
  const hits = fs.readFileSync(path.join(DIR, f), 'utf8').split('\n')
    .map((l, i) => (BAN.test(l) && !l.includes(EXEMPT)) ? `${f}:${i + 1}` : null).filter(Boolean);
  scan.push(...hits);
}
check('S-PORTABLE no machine-local path or pinned chromium revision under gates/',
  scan.length === 0, scan.length ? `hits=${scan.join(' ')}` : 'ban-list clean: home dir, Mac home, edu-verify, pinned chromium rev');

// ---- S5: the A-G18 baseline must be SET and must EXIST ----
// Without it gate-a.mjs reports 9/10 and the vector diff fails for the wrong reason.
const base = process.env.A_G18_BASELINE;
check('S-BASELINE A_G18_BASELINE is set and the file it names exists',
  !!base && fs.existsSync(base), base ? `path=${base} exists=${fs.existsSync(base)}` : 'A_G18_BASELINE is UNSET');

// ---- S6: the exit-code net that did not exist before P0 ----
const q = fs.readFileSync(path.join(DIR, 'gate-q.mjs'), 'utf8');
check('S-EXITCODE gate-q.mjs fails the run when red (process.exit(1) present)',
  /process\.exit\(1\)/.test(q), 'a red gate-q exited 0 before P0 — any exit-code runner was blind to it');

console.log(`\n${results.filter(r => r.pass).length}/${results.length} passed`);
const failed = results.filter(r => !r.pass);
if (failed.length) console.log('FAILED: ' + failed.map(r => r.id).join(', '));
if (failed.length) process.exit(1);
