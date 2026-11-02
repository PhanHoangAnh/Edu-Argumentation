// structural-parity.mjs — the book still parses and nothing was lost.
//
// Asserts, on ONE module.json:
//   * the structural triple  sections / lessons / questions   (default 19/310/1550)
//   * the seven block-type counts                             (default = the RED fixture)
//   * optionally the code_cells `generated` marker counts     (--markers R7/corr/absent)
// Every row prints got/want; any mismatch is RED and exits 1.
//
// Static and self-contained: no Playwright, no node_modules, no GATE_BASE. Node stdlib.
//
// ⛔ BLIND TO PLACEMENT by construction: 70 cards landing in the wrong chapter pass
// this gate as long as the totals match. Never cite it alone for an insert — pair it
// with a per-chapter / adjacency check.
//
// ⚑ RE-BASELINED 24-09-26 to the live book AFTER the whole-book rewrite + cold-read fix round
// (source: nn library/geron-homl3/module.json, sha256 dd38fb9e97c41c0c..., 8,861,729 B).
// Defaults are now that book:
//   text 1608 · callout 910 · figure 379 · deeper 295 · card 494 · code_cells 158 · equation 90
// Only text/callout/card moved (rewrite: Where-we-are + New-words on every lesson, Full-script
// cards, cold-read splits). The triple and the other four types are UNCHANGED from the RED
// fixture and stay pinned. Report: process/features/ml/active/geron-material-green_22-09-26/
// content-gates-rebaseline_REPORT_24-09-26.md
// The frozen RED fixture (sha256 6712483e..., 22-09-26) keeps its own numbers — select them
// with --baseline red (text 978 · callout 600 · card 259, rest identical).
// Markers are checked ONLY when --markers is given: RED = 153/1/4, live (D1 onward) = 154/0/4.
//
// ⚠ REBUILT 23-09-26 from the Phase-1 spec + report (the original was never pushed).
//
// Usage:
//   node structural-parity.mjs <module.json> [--baseline live|red] [--triple S/L/Q]
//        [--blocks text=1608,callout=910,...] [--markers R7/corr/absent]
// --blocks overrides apply on top of the chosen --baseline, whatever the argument order.
// Exit: 0 GREEN · 1 RED · 2 usage / unreadable input
import fs from 'node:fs';

const TYPES = ['text', 'callout', 'figure', 'deeper', 'card', 'code_cells', 'equation'];
// Named baselines. The triple and figure/deeper/code_cells/equation are the SAME in both —
// the rewrite never had licence to move them.
const BASELINES = {
  // live book after the whole-book rewrite + cold-read fixes, sha256 dd38fb9e..., 24-09-26
  live: { text: 1608, callout: 910, figure: 379, deeper: 295, card: 494, code_cells: 158, equation: 90 },
  // frozen RED fixture module.RED.22-09-26.json, sha256 6712483e..., 22-09-26
  red: { text: 978, callout: 600, figure: 379, deeper: 295, card: 259, code_cells: 158, equation: 90 },
};
const want = {
  triple: [19, 310, 1550],
  blocks: { ...BASELINES.live },
  markers: null,
};
const overrides = {};
const MARK_R7 = 'R7/code_cells.py';
const MARK_CORR = 'ch02-b09-corr-cell 22-09-26';

function usage(msg) {
  if (msg) console.error(`structural-parity: ${msg}`);
  console.error('usage: node structural-parity.mjs <module.json> [--baseline live|red] [--triple S/L/Q] ' +
                '[--blocks type=N,...] [--markers R7/corr/absent]');
  process.exit(2);
}
const ints = (s, n, flag) => {
  const v = String(s ?? '').split('/').map(Number);
  if (v.length !== n || v.some((x) => !Number.isInteger(x) || x < 0)) usage(`${flag} needs ${n} integers joined by /`);
  return v;
};

const args = process.argv.slice(2);
let file = null;
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--baseline') {
    const name = args[++i];
    if (!Object.hasOwn(BASELINES, name)) usage(`--baseline must be one of ${Object.keys(BASELINES).join('|')}`);
    want.blocks = { ...BASELINES[name] };
  } else if (a === '--triple') want.triple = ints(args[++i], 3, '--triple');
  else if (a === '--markers') want.markers = ints(args[++i], 3, '--markers');
  else if (a === '--blocks') {
    for (const kv of String(args[++i] ?? '').split(',')) {
      const [k, v] = kv.split('=');
      if (!TYPES.includes(k) || !Number.isInteger(Number(v))) usage(`bad --blocks entry "${kv}"`);
      overrides[k] = Number(v);
    }
  } else if (!file) file = a;
  else usage(`unexpected argument ${a}`);
}
Object.assign(want.blocks, overrides);
if (!file) usage('no module.json given');

let doc;
try {
  doc = JSON.parse(fs.readFileSync(file, 'utf8'));
} catch (e) {
  usage(`cannot read ${file}: ${e.message}`);
}
const sections = doc?.tutorialData?.sections;
if (!Array.isArray(sections)) usage(`${file}: no tutorialData.sections — not a module.json`);

const got = { blocks: Object.fromEntries(TYPES.map((t) => [t, 0])), R7: 0, corr: 0, absent: 0 };
let lessons = 0;
for (const sec of sections) {
  for (const it of sec?.items || []) {
    lessons++;
    for (const b of it?.blocks || []) {
      if (!b || typeof b !== 'object') continue;
      if (TYPES.includes(b.type)) got.blocks[b.type]++;
      if (b.type === 'code_cells') {
        if (b.generated === MARK_R7) got.R7++;
        else if (b.generated === MARK_CORR) got.corr++;
        else if (b.generated === undefined) got.absent++;
      }
    }
  }
}
const questions = Array.isArray(doc.quizData) ? doc.quizData.length : -1;

const rows = [
  ['sections', sections.length, want.triple[0]],
  ['lessons', lessons, want.triple[1]],
  ['questions', questions, want.triple[2]],
  ...TYPES.map((t) => [`block ${t}`, got.blocks[t], want.blocks[t]]),
];
if (want.markers) {
  rows.push(['marker R7/code_cells.py', got.R7, want.markers[0]],
            ['marker corr-cell', got.corr, want.markers[1]],
            ['marker absent', got.absent, want.markers[2]]);
}

console.log(`structural-parity — ${file}`);
let bad = 0;
for (const [name, g, w] of rows) {
  const ok = g === w;
  if (!ok) bad++;
  console.log(`  ${(ok ? 'ok' : 'FAIL').padEnd(4)} ${name.padEnd(26)} got ${String(g).padStart(5)}  want ${w}`);
}
if (!bad) {
  console.log('  RESULT: GREEN');
  process.exit(0);
}
console.log(`  RESULT: RED — ${bad} mismatch(es)`);
process.exit(1);
