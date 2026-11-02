// no-network-fetch.mjs — Phase-1 C6: no code cell performs a REMOTE fetch.
//
// Why: the runner caps a cell at CELL_TIMEOUT_SECONDS=60. A cell that downloads
// spends its budget on the network and comes back status:"timeout", which reads as
// "this code is too heavy to run" — a false R13 weight verdict about the code,
// caused entirely by the network (ch03-b01 c01: 65.1 s -> timeout before staging).
//
// Static and self-contained: ONE module.json in, counts out. No Playwright, no
// node_modules, no GATE_BASE. Node stdlib only.
//
// What it counts: code_cells cells whose source CALLS a fetch API
// (urlretrieve / urlopen / requests.* / sklearn fetch_* / tfds.load / get_file /
// load_dataset / !wget|curl). A call whose every URL literal in the cell is local
// (localhost / 127.0.0.1 / 0.0.0.0 — e.g. TF-Serving) is a LOCAL SERVICE CALL,
// not a remote fetch: it is printed as excluded, never dropped silently.
//
// ⚠ What it cannot see (stated, not hidden): a fetch reached indirectly — through
// a helper, an exec, a library default such as tfds' implicit download, or a URL
// handed to a reader such as pandas.read_csv("https://..."). Cells that carry a URL
// literal but no matched call are printed as ADVISORY and are not counted.
// On the RED fixture that is ch01-b08 `load`, which reads its CSVs from github
// through read_csv — a real fetch this gate does not count.
//
// ⚠ REBUILT 23-09-26 from the Phase-1 spec + report (the original was never pushed).
//
// ⚑ 29-09-26 (AC-6 offline datasets): the pass condition is a NAMED cache-backed
// allow-list, not a bare count. Every id in ALLOW below was measured as a remote-fetch
// hit on the LIVE box module (158 cells scanned, 29-09-26) AND proven to run offline
// on the .68 book-geron-homl3 runner with its dataset pre-staged in the runner cache —
// see the offline-runner proof in
//   process/features/ml/active/edu-28-09-rulings_29-09-26/edu-28-09-rulings_REPORT_29-09-26.md
// (§Task 1 T1-G2 table: status ok, net=false, cache mtimes unchanged = served from
// cache, not the network). GREEN requires every hit to be in ALLOW; a hit that is NOT
// in ALLOW is a NEW, uncovered fetch cell and turns the gate RED — that is the
// regression this gate exists to catch.
//
// Usage:  node no-network-fetch.mjs <module.json> [--expect N]
// Exit:   0 GREEN (every hit is an ALLOW-listed, cache-backed cell) ·
//         1 RED (a hit is not in ALLOW — a new uncovered fetch cell) ·
//         2 usage / unreadable input
// --expect N (optional, legacy): additionally assert the total hit count equals N.
import fs from 'node:fs';

const FETCH_CALLS = [
  ['urllib.request.urlretrieve', /\burlretrieve\s*\(/],
  ['urllib.request.urlopen', /\burlopen\s*\(/],
  ['requests', /\brequests\.(?:get|post|put|patch|delete|head|request)\s*\(/],
  ['sklearn.datasets.fetch_*', /\bfetch_[a-z0-9_]+\s*\(/],
  ['tfds.load', /\btfds\.load\s*\(/],
  ['keras get_file', /\bget_file\s*\(/],
  ['load_dataset', /\bload_dataset\s*\(/],
  ['wget/curl', /^\s*!\s*(?:wget|curl)\b/m],
];
const URL_RE = /https?:\/\/[^\s"'`)]+/g;
const LOCAL = /^https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0)(?:[:/]|$)/;

// The 11 cache-backed remote-fetch cells. Key = `${lid} ${cellId}`. Each was measured
// as a hit on the box module AND proven offline on the .68 runner (report cited above).
// A hit not in this set is a NEW uncovered fetch cell -> RED.
const ALLOW = new Set([
  'ch02-b04 c01', // urllib.urlretrieve housing.tgz -> ~/datasets/housing/ (pre-cached)
  'ch03-b01 c01', // sklearn fetch_openml MNIST      -> ~/scikit_learn_data/openml (pre-cached)
  'ch07-b11 c08', // urllib.urlretrieve housing.tgz  -> ~/datasets/housing/ (pre-cached)
  'ch08-b06 c03', // sklearn fetch_openml MNIST      -> ~/scikit_learn_data/openml (pre-cached)
  'ch09-b10 c05', // urllib.urlretrieve ladybug.png  -> ~/datasets/ladybug.png (staged 29-09-26)
  'ch10-b05 c02', // sklearn fetch_california_housing -> ~/scikit_learn_data (pre-cached)
  'ch10-b12 c08', // sklearn fetch_california_housing -> ~/scikit_learn_data (pre-cached; cell trains, compute-heavy)
  'ch12-b11 c10', // sklearn fetch_california_housing -> ~/scikit_learn_data (pre-cached)
  'ch13-b03 c03', // sklearn fetch_california_housing -> ~/scikit_learn_data (pre-cached)
  'ch15-b03 c01', // keras get_file ridership.tgz    -> ~/datasets/ridership.tgz (staged 29-09-26)
  'ch16-b01 c01', // keras get_file shakespeare.txt  -> ~/datasets/shakespeare.txt (staged 29-09-26)
]);

function usage(msg) {
  if (msg) console.error(`no-network-fetch: ${msg}`);
  console.error('usage: node no-network-fetch.mjs <module.json> [--expect N]');
  process.exit(2);
}

const args = process.argv.slice(2);
let file = null;
let expect = 0;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--expect') {
    const n = Number(args[++i]);
    if (!Number.isInteger(n) || n < 0) usage('--expect needs a non-negative integer');
    expect = n;
  } else if (!file) file = args[i];
  else usage(`unexpected argument ${args[i]}`);
}
if (!file) usage('no module.json given');

let doc;
try {
  doc = JSON.parse(fs.readFileSync(file, 'utf8'));
} catch (e) {
  usage(`cannot read ${file}: ${e.message}`);
}
const sections = doc?.tutorialData?.sections;
if (!Array.isArray(sections)) usage(`${file}: no tutorialData.sections — not a module.json`);

const hits = [];
const local = [];
const advisory = [];
let scanned = 0;
sections.forEach((sec, si) => {
  (sec?.items || []).forEach((it, ii) => {
    const lid = `ch${String(si + 1).padStart(2, '0')}-b${String(ii + 1).padStart(2, '0')}`;
    for (const b of it?.blocks || []) {
      if (!b || b.type !== 'code_cells') continue;
      for (const c of b.cells || []) {
        scanned++;
        const src = String(c?.source ?? '');
        const calls = FETCH_CALLS.filter(([, re]) => re.test(src)).map(([label]) => label);
        const urls = src.match(URL_RE) || [];
        const row = { lid, id: String(c?.id ?? '?'), term: String(it?.term ?? ''), calls };
        if (calls.length) {
          if (urls.length && urls.every((u) => LOCAL.test(u))) local.push(row);
          else hits.push(row);
        } else if (urls.length) advisory.push(row);
      }
    }
  });
});

const key = (r) => `${r.lid} ${r.id}`;
const line = (r) => `    ${r.lid} cell ${r.id} — ${r.calls.join(', ') || 'URL literal only'}   [${r.term}]`;
console.log(`no-network-fetch — ${file}`);
console.log(`  cells scanned: ${scanned}`);
console.log(`  REMOTE FETCH hits: ${hits.length}`);
hits.forEach((r) => console.log(line(r)));
if (local.length) {
  console.log(`  excluded — local service call, not a remote fetch: ${local.length}`);
  local.forEach((r) => console.log(line(r)));
}
if (advisory.length) {
  console.log(`  advisory — URL literal but no matched call (NOT counted): ${advisory.length}`);
  advisory.forEach((r) => console.log(line(r)));
}

// Allow-list decision: every hit must be a known cache-backed cell.
const unexpected = hits.filter((r) => !ALLOW.has(key(r)));
const seen = new Set(hits.map(key));
const missing = [...ALLOW].filter((k) => !seen.has(k));
if (missing.length) {
  console.log(`  note — allow-listed cells absent from this module (not an error): ${missing.length}`);
  missing.forEach((k) => console.log(`    ${k}`));
}
const argExpect = args.includes('--expect');
if (argExpect && hits.length !== expect) {
  console.log(`  RESULT: RED — ${hits.length} remote-fetch cell(s), --expect ${expect}`);
  process.exit(1);
}
if (unexpected.length) {
  console.log(`  RESULT: RED — ${unexpected.length} NEW uncovered fetch cell(s) not in the cache-backed allow-list:`);
  unexpected.forEach((r) => console.log(line(r)));
  process.exit(1);
}
console.log(`  RESULT: GREEN — all ${hits.length} remote-fetch cell(s) are cache-backed (allow-listed)`);
process.exit(0);
