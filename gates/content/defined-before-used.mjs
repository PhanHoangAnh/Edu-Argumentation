// defined-before-used.mjs — a beginner can read ch02 in order without meeting an undefined word.
//
// Why (user, 23-09-26, on ch02-b11): "i dont even understand what is the split ... what is
// predictor, what the fuck is label ... i have to stop writing to fucking ask chatbot". He
// started the book at ch02, so every word ch01 would have taught him must be taught in ch02,
// at or before the lesson that first uses it.
//
// Asserts, on ONE module.json, for the chapter named in the registry (default ch02):
//   S1  every lesson opens with a "Where we are" text block naming the whole project flow
//   S2  the next block is the "New words in this lesson" callout (no `items`, so the
//       exercise form — which grabs the first callout WITH items — can never take it)
//   S3  every lesson carries a "For example, in our data" worked-example text block
//   S4  a "Full script" card, where one exists, is still the LAST block of its lesson
//   T1  no registered term appears in the rendered text of any lesson BEFORE its defining lesson
//   T2  the defining lesson's New-words box has an entry for the term
//   T3  every New-words entry is a registered term, defined in THIS lesson — or a recap
//       marked "(from bNN)" where bNN is the registered defining lesson
//   Q1  (advisory unless --quiz-strict) a quiz question for lesson bNN uses only terms
//       defined at or before bNN
//
// "Rendered text" = what the reader sees: text blocks, callout title/content/items, exercise
// prompts, card title+content (EXCEPT the "Full script" card, which is code), figure/equation
// title+caption, equation `explain`, and `deeper` items. NOT figure `description` (it is never
// rendered — app.js uses alt/caption only) and NOT code_cells. Fenced code is dropped;
// markdown emphasis, backticks, headings, table pipes and HTML tags are stripped; inline-code
// words are KEPT, because the reader sees `fit()` and has to know what it means.
//
// Registry: ch02-term-registry.json beside this file (term, match regexes, exclude regexes,
// defining lesson, one-sentence definition). Node stdlib only.
//
// Usage:  node defined-before-used.mjs <module.json> [--registry file] [--first-use]
//              [--quiz-strict] [--lessons A-B]
//         --chapter N  = --registry chNN-term-registry.json beside this file (per-chapter gate).
//         A registry may list `known: ["ch02-term-registry.json"]`: those terms count as already
//         taught (every chapter may assume ch02's words); a box may recap one as "(from ch02)".
//         --lessons limits every check to lessons A-B (1-based): S1-S4 and T3 on those lessons,
//         T1/T2 on terms whose defining lesson is in A-B, Q1 on their questions. Used to prove a
//         partial write; the full-chapter run (no --lessons) is the real verdict.
// Exit:   0 GREEN · 1 RED · 2 usage / unreadable input
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
let file = null;
let regFile = path.join(HERE, 'ch02-term-registry.json');
let firstUse = false;
let quizStrict = false;
let range = null;
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--registry') regFile = args[++i];
  else if (a === '--chapter') regFile = path.join(HERE, `ch${String(args[++i]).padStart(2, '0')}-term-registry.json`);
  else if (a === '--first-use') firstUse = true;
  else if (a === '--quiz-strict') quizStrict = true;
  else if (a === '--lessons') {
    const m = /^(\d+)-(\d+)$/.exec(args[++i] || '');
    if (!m) usage('--lessons needs A-B');
    range = [Number(m[1]), Number(m[2])];
  } else if (!file) file = a;
  else usage(`unexpected argument ${a}`);
}
function usage(msg) {
  if (msg) console.error(`defined-before-used: ${msg}`);
  console.error('usage: node defined-before-used.mjs <module.json> [--registry f] [--first-use] [--quiz-strict] [--lessons A-B]');
  process.exit(2);
}
if (!file) usage('no module.json given');

let doc, reg;
try { doc = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { usage(`cannot read ${file}: ${e.message}`); }
try { reg = JSON.parse(fs.readFileSync(regFile, 'utf8')); } catch (e) { usage(`cannot read registry ${regFile}: ${e.message}`); }

const CH = reg.chapter;
const known = new Map(); // term name -> chapter tag, for terms taught in another chapter's registry
for (const kf of reg.known || []) {
  const kp = path.isAbsolute(kf) ? kf : [path.join(path.dirname(regFile), kf), path.join(HERE, kf)].find((p) => fs.existsSync(p)) || kf;
  const kr = JSON.parse(fs.readFileSync(kp, 'utf8'));
  const tag = `ch${String(kr.chapter).padStart(2, '0')}`;
  for (const t of kr.terms) for (const nm of [t.term, ...(t.aliases || [])]) if (!known.has(nm.toLowerCase())) known.set(nm.toLowerCase(), tag);
}
const sec = doc?.tutorialData?.sections?.[CH - 1];
if (!sec || !Array.isArray(sec.items)) usage(`no chapter ${CH} in ${file}`);
const lessons = sec.items;
const bid = (n) => `b${String(n).padStart(2, '0')}`;
const NEW_WORDS_TITLE = 'New words in this lesson';
const isFullScript = (b) => b && b.type === 'card' && /^full script/i.test(String(b.title || ''));

function clean(s) {
  return String(s ?? '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/<\/?[a-zA-Z][^>]*>/g, ' ')   // real HTML tags only: `<1H OCEAN` is data, not a tag
    .replace(/\*\*|__|`|^#+\s*/gm, '')
    .replace(/\|/g, ' ')
    .replace(/\s+/g, ' ');
}
function blockText(b) {
  if (!b || typeof b !== 'object' || b.type === 'code_cells' || isFullScript(b)) return '';
  const parts = [];
  if (b.type === 'figure') parts.push(b.title, b.caption);
  else if (b.type === 'equation') parts.push(b.title, b.caption, b.explain);
  else if (b.type === 'deeper') for (const it of b.items || []) parts.push(it?.term, it?.text);
  else {
    parts.push(b.title, b.content, b.intro);
    for (const it of b.items || b.bullets || []) parts.push(it);
    for (const ex of b.exercises || []) parts.push(ex?.prompt);
  }
  return clean(parts.filter(Boolean).join(' \n '));
}
const lessonText = lessons.map((it) => (it.blocks || []).map(blockText).join(' \n '));

const terms = reg.terms.map((t) => ({
  ...t,
  re: t.match.map((m) => new RegExp(m, 'i')),
  ex: (t.exclude || []).map((m) => new RegExp(m, 'gi')),
}));
function uses(t, text) {
  let s = text;
  for (const e of t.ex) s = s.replace(e, ' ');
  for (const r of t.re) { const m = r.exec(s); if (m) return m[0]; }
  return null;
}

if (firstUse) {
  console.log(`first use of each registered term in ch${String(CH).padStart(2, '0')} (rendered text):`);
  for (const t of terms) {
    const i = lessonText.findIndex((s) => uses(t, s));
    console.log(`  ${(i < 0 ? '—' : bid(i + 1)).padEnd(4)} ${t.term.padEnd(34)} registered ${t.lesson ? bid(t.lesson) : '?'}${i >= 0 && t.lesson && i + 1 !== t.lesson ? '   <-- differs' : ''}`);
  }
  process.exit(0);
}

const fails = [];
const warns = [];
const inRange = (n) => !range || (n >= range[0] && n <= range[1]);

// New-words boxes, parsed.
function parseBox(b) {
  const out = [];
  const re = /^\s*[-*]\s+\*\*(.+?)\*\*\s*(\(from (b\d{2}|ch\d{2})\))?\s*[—-]/gm;
  let m;
  while ((m = re.exec(String(b.content || '')))) out.push({ name: m[1].trim().toLowerCase(), from: m[3] || null });
  return out;
}
const boxes = lessons.map((it) => {
  const b = (it.blocks || []).find((x) => x && x.type === 'callout' && x.title === NEW_WORDS_TITLE);
  return b ? parseBox(b) : null;
});

// S1-S4
lessons.forEach((it, i) => {
  const n = i + 1;
  if (!inRange(n)) return;
  const B = it.blocks || [];
  const b0 = B[0];
  const flowOk = b0 && b0.type === 'text' && /^\*\*Where we are/.test(String(b0.content || '')) &&
    reg.flow.every((stage, k) => { const at = String(b0.content).indexOf(stage); return at >= 0 && (k === 0 || at > String(b0.content).indexOf(reg.flow[k - 1])); });
  if (!flowOk) fails.push(`S1 ${bid(n)} "${it.term}": first block is not a "Where we are" text block naming the full flow in order`);
  const b1 = B[1];
  if (!(b1 && b1.type === 'callout' && b1.title === NEW_WORDS_TITLE && !Array.isArray(b1.items)))
    fails.push(`S2 ${bid(n)}: second block is not the "${NEW_WORDS_TITLE}" callout (content only, no items)`);
  if (!B.some((x) => x && x.type === 'text' && /###\s*For example, in our data/.test(String(x.content || ''))))
    fails.push(`S3 ${bid(n)}: no "For example, in our data" worked-example block`);
  const fi = B.findIndex(isFullScript);
  if (fi >= 0 && fi !== B.length - 1) fails.push(`S4 ${bid(n)}: Full script card is block ${fi}, not last (${B.length - 1})`);
});

// T1-T3
const byName = new Map();
for (const t of terms) for (const nm of [t.term, ...(t.aliases || [])]) byName.set(nm.toLowerCase(), t);
for (const t of terms) {
  const D = t.lesson;
  if (!inRange(D)) continue;
  for (let i = 0; i < D - 1 && i < lessonText.length; i++) {
    const hit = uses(t, lessonText[i]);
    if (hit) fails.push(`T1 ${bid(i + 1)} uses "${hit}" (term "${t.term}") before its definition in ${bid(D)}`);
  }
  const box = boxes[D - 1];
  if (!box || !box.some((e) => !e.from && byName.get(e.name) === t))
    fails.push(`T2 ${bid(D)} New-words box has no entry defining "${t.term}"`);
}
boxes.forEach((box, i) => {
  if (!box || !inRange(i + 1)) return;
  for (const e of box) {
    const t = byName.get(e.name);
    if (!t && e.from && known.get(e.name) === e.from) continue; // recap of another chapter's word
    if (!t) { fails.push(`T3 ${bid(i + 1)} New-words entry "${e.name}" is not in the registry${known.has(e.name) ? ` (it is a ${known.get(e.name)} word: recap it as "(from ${known.get(e.name)})")` : ''}`); continue; }
    if (e.from) { if (e.from !== bid(t.lesson)) fails.push(`T3 ${bid(i + 1)} recap "${e.name}" says (from ${e.from}) but it is defined in ${bid(t.lesson)}`); }
    else if (t.lesson !== i + 1) fails.push(`T3 ${bid(i + 1)} defines "${e.name}" but the registry puts its definition in ${bid(t.lesson)}`);
  }
});

// Q1
const blockNo = (s) => { const m = /-b(\d+)/.exec(String(s || '')); return m ? Number(m[1]) : null; };
for (const q of doc.quizData || []) {
  if (q?.source?.chapter !== CH) continue;
  const n = blockNo(q.source.block);
  if (!n || !inRange(n)) continue;
  const text = clean([q.question, ...(q.options || [])].join(' \n '));
  for (const t of terms) {
    if (t.lesson <= n) continue;
    const hit = uses(t, text);
    if (hit) (quizStrict ? fails : warns).push(`Q1 ${q.source.question}: uses "${hit}" (term "${t.term}", defined ${bid(t.lesson)})`);
  }
}

console.log(`defined-before-used — ${file}  (ch${String(CH).padStart(2, '0')}, ${lessons.length} lessons, ${terms.length} registered terms${range ? `, structure checked for b${range[0]}-b${range[1]}` : ''})`);
for (const w of warns) console.log(`  WARN ${w}`);
for (const f of fails) console.log(`  FAIL ${f}`);
if (!fails.length) { console.log(`  RESULT: GREEN${warns.length ? ` (${warns.length} advisory)` : ''}`); process.exit(0); }
console.log(`  RESULT: RED — ${fails.length} failure(s)`);
process.exit(1);
