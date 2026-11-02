#!/usr/bin/env node
/**
 * gen-selector-contract.mjs — generate gates/selector-contract.json
 *
 * Phase 02 of the edu-replatform program (checklist item A5).
 *
 * WHY THIS EXISTS
 *   The Phase 00 browser gates select on the legacy app's DOM. Phase 3 replaces that DOM
 *   with React output, so every id, class, attribute and TAG NAME the gates query is a
 *   hard contract on the rewrite. Hand-typing that list is how a gate goes green against
 *   the wrong contract: the plan's advisory list says 27 ids and a crude grep of the same
 *   files says 28, with no tiebreak between them.
 *
 *   RULE (plan A5 / execute instruction E8): THIS GENERATOR IS THE SOLE AUTHORITY. Where
 *   it disagrees with a hand-written list, the generator is right and the prose is
 *   corrected. Never tune the generator to match a list.
 *
 * REQUIRED CWD
 *   ml/study/Edu-Argumentation/     run as:  node gates/gen-selector-contract.mjs
 *                                   check:   node gates/gen-selector-contract.mjs --check
 *
 * INPUT   gates/*.mjs  (every gate script except this generator)
 * OUTPUT  gates/selector-contract.json
 *
 * HOW — two independent evidence routes, unioned. Neither alone is sufficient:
 *
 *   Route 1 — STRICT GRAMMAR over every string literal.
 *       Catches selectors that never touch a known call name. gate-a.mjs stringifies a
 *       helper and eval()s it inside page.evaluate, so `pick('#brand-home svg')` is a real
 *       gate selector that no querySelector-call regex can see. Measured: whitelisting
 *       call names silently dropped #brand-home and label[for="custom-data-upload"].
 *       A literal qualifies only if EVERY compound parses as a complete CSS selector and
 *       it carries at least one #id / .class / [attr] — a bare word is not evidence.
 *
 *   Route 2 — CALL-SITE whitelist (querySelector, locator, $$eval, ...).
 *       Catches TAG-ONLY selectors that route 1 must reject: 'ol li button', ':scope > div',
 *       'p', 'header', 'svg'. These are pure prose shapes, so being the argument of a DOM
 *       query call IS the evidence that they are selectors. A5(iii) names 'ol li button'
 *       and ':scope > div' explicitly as structural contracts, so losing them is not an
 *       option — a refactor that wraps a <button> in a <div> breaks them while every id
 *       survives.
 *
 *   COMMENTS ARE STRIPPED FIRST. Measured 21-09-26: the apostrophe in `// ... B6's whole
 *   point ...` (gate-b456.mjs:29) opens a phantom string literal that swallows the rest of
 *   the file, and the contract silently lost #next-btn, #setup-tree, #setup-none-btn,
 *   #restart-btn and #result-retry-wrong-btn. A generator that under-reports is worse than
 *   no generator, because the missing ids look like ids Phase 3 is free to drop.
 */

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const GATES_DIR = 'gates';
const OUT = join(GATES_DIR, 'selector-contract.json');
const SELF = 'gen-selector-contract.mjs';
const EXCLUDE = new Set([SELF]);

// Classes owned by third-party CSS: they survive a rewrite for free *if* the library still
// renders and its CSS is not purged — a different obligation from our own class names.
const THIRD_PARTY_CLASS_PREFIXES = ['katex', 'vlist', 'sqrt', 'mord', 'mrel', 'strut'];

const STRING_LITERAL = /(['"`])((?:\\.|(?!\1)[\s\S])*?)\1/g;
const QUERY_CALL =
  /(?:querySelectorAll|querySelector|waitForSelector|locator|\$\$eval|\$eval|\$\$|\$)\(\s*(['"`])((?:\\.|(?!\1)[\s\S])*?)\1/g;

// One compound selector: optional tag, then any run of #id / .class / [attr] / :pseudo / *
const COMPOUND =
  /^(?:[a-zA-Z][a-zA-Z0-9]*(?:-[a-zA-Z0-9]+)*)?(?:#[A-Za-z][\w-]*|\.[A-Za-z][\w-]*|\[[^\]]+\]|::?[a-z-]+(?:\([^)]*\))?|\*)*$/;

// Filenames parse as `tag.class` ("gate-a.mjs"), so they must be excluded explicitly.
const FILE_EXT = /\.(mjs|js|cjs|json|png|jpe?g|gif|svg|ico|css|html?|sh|py|txt|md|log|ya?ml)$/i;

/** Remove // line comments and block comments so apostrophes in prose cannot open a literal. */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/** Replace ${...} interpolations with a stable placeholder so the static skeleton survives. */
function staticSkeleton(raw) {
  return raw.replace(/\$\{[^}]*\}/g, '*');
}

/** Split a selector list/chain into its combinator-free compound units. */
function compounds(sel) {
  return sel
    .split(/\s*,\s*/)
    .flatMap((part) => part.split(/\s*[>+~]\s*|\s+/))
    .map((c) => c.trim())
    .filter(Boolean);
}

function parsesAsSelector(sel) {
  if (!sel || sel.length > 160) return false;
  // '>' is a legitimate child combinator (':scope > div'), so it must NOT be banned here —
  // banning it silently dropped that selector, which A5(iii) names as a structural contract.
  if (/[\/\\<{}|!?;&=]/.test(sel.replace(/\[[^\]]*\]/g, ''))) return false; // paths, URLs, prose
  if (FILE_EXT.test(sel.trim())) return false;
  const parts = compounds(sel);
  return parts.length > 0 && parts.every((c) => COMPOUND.test(c));
}

/** Route 1 additionally demands a #id / .class / [attr] — a bare word proves nothing. */
function isSelfEvidentSelector(sel) {
  return /[#.\[]/.test(sel) && parsesAsSelector(sel);
}

function add(map, key, file) {
  if (!map[key]) map[key] = [];
  if (!map[key].includes(file)) map[key].push(file);
}

function sortedMap(map) {
  return Object.fromEntries(Object.keys(map).sort().map((k) => [k, map[k].slice().sort()]));
}

function tokenize(sel, acc, file) {
  for (const c of compounds(sel)) {
    const tagMatch = /^([a-zA-Z][a-zA-Z0-9]*(?:-[a-zA-Z0-9]+)*)/.exec(c);
    if (tagMatch && !/^[#.\[:*]/.test(c)) add(acc.tags, tagMatch[1], file);
    for (const m of c.matchAll(/#([A-Za-z][\w-]*)/g)) add(acc.ids, '#' + m[1], file);
    for (const m of c.matchAll(/\.([A-Za-z][\w-]*)/g)) add(acc.classes, '.' + m[1], file);
    for (const m of c.matchAll(/\[([^\]]*)\]/g)) {
      const name = /^\s*([A-Za-z][\w-]*)/.exec(m[1]);
      if (name) add(acc.attributes, name[1], file);
      add(acc.attributeExpressions, '[' + m[1] + ']', file);
    }
    for (const m of c.matchAll(/(::?[a-z-]+)/g)) add(acc.pseudo, m[1], file);
  }
}

function build() {
  if (!existsSync(GATES_DIR)) {
    console.error(`FAILED: '${GATES_DIR}/' not found. Run from ml/study/Edu-Argumentation/.`);
    process.exit(1);
  }
  const files = readdirSync(GATES_DIR)
    .filter((f) => f.endsWith('.mjs') && !EXCLUDE.has(f))
    .sort();
  if (files.length === 0) {
    console.error('FAILED: no gate .mjs files found — refusing to emit an empty contract.');
    process.exit(1);
  }

  const acc = { ids: {}, classes: {}, attributes: {}, attributeExpressions: {}, tags: {}, pseudo: {} };
  const selectors = {};
  const hashRoutes = {};
  let route1 = 0;
  let route2 = 0;

  for (const f of files) {
    const src = stripComments(readFileSync(join(GATES_DIR, f), 'utf8'));

    // The app's deep-link contract is a location hash, not a selector: #chapter=N&block=N.
    // It constrains routing rather than DOM shape, so it gets its own section.
    for (const m of src.matchAll(/#(chapter=[A-Za-z0-9&=_-]*)/g)) {
      add(hashRoutes, '#' + m[1].replace(/\d+/g, 'N'), f);
    }

    for (const m of src.matchAll(STRING_LITERAL)) {
      const raw = staticSkeleton(m[2]).trim();
      if (!isSelfEvidentSelector(raw)) continue;
      route1 += 1;
      add(selectors, raw, f);
      tokenize(raw, acc, f);
    }

    for (const m of src.matchAll(QUERY_CALL)) {
      const raw = staticSkeleton(m[2]).trim();
      if (!parsesAsSelector(raw)) continue;
      route2 += 1;
      add(selectors, raw, f);
      tokenize(raw, acc, f);
    }
  }

  const classKeys = Object.keys(acc.classes);
  const thirdParty = classKeys.filter((c) =>
    THIRD_PARTY_CLASS_PREFIXES.some((p) => c.slice(1).startsWith(p)));
  const ours = classKeys.filter((c) => !thirdParty.includes(c));

  const contract = {
    $comment: [
      'GENERATED by gates/gen-selector-contract.mjs — DO NOT HAND-EDIT.',
      'Regenerate: node gates/gen-selector-contract.mjs   (from ml/study/Edu-Argumentation/)',
      'Verify:     node gates/gen-selector-contract.mjs --check',
      '',
      'This is the DOM contract the Phase-3 React rewrite must reproduce. Three kinds of',
      'obligation, and they are NOT the same job:',
      '  ids / classes.ours  — we must emit these names ourselves.',
      '  classes.thirdParty  — survive for free IF KaTeX still renders and its CSS is not purged.',
      '  tags / attributes / attributeExpressions / pseudo — these constrain DOM SHAPE, not',
      '    just names. Wrapping a <button> in a <div> breaks "ol li button" while every id',
      '    survives, and the cause is not obvious from the failure.',
      '',
      'TAGS MATTER AS MUCH AS IDS: rich-text-viewer is a CUSTOM ELEMENT queried by tag name.',
      'A React rewrite naturally replaces a custom element with a component, the tag vanishes,',
      'every id is still present, and the gate goes red for a non-obvious reason. Phase 3 must',
      'keep a real element literally named <rich-text-viewer> in the rendered DOM.',
    ],
    generatedBy: SELF,
    sourceFiles: files,
    counts: {
      ids: Object.keys(acc.ids).length,
      classesOurs: ours.length,
      classesThirdParty: thirdParty.length,
      attributes: Object.keys(acc.attributes).length,
      tags: Object.keys(acc.tags).length,
      pseudo: Object.keys(acc.pseudo).length,
      hashRoutes: Object.keys(hashRoutes).length,
      selectors: Object.keys(selectors).length,
      extractionHits: { selfEvidentGrammar: route1, domQueryCallSite: route2 },
    },
    ids: sortedMap(acc.ids),
    classes: {
      ours: sortedMap(Object.fromEntries(ours.map((c) => [c, acc.classes[c]]))),
      thirdParty: sortedMap(Object.fromEntries(thirdParty.map((c) => [c, acc.classes[c]]))),
    },
    attributes: sortedMap(acc.attributes),
    attributeExpressions: sortedMap(acc.attributeExpressions),
    tags: sortedMap(acc.tags),
    pseudo: sortedMap(acc.pseudo),
    hashRoutes: sortedMap(hashRoutes),
    selectors: sortedMap(selectors),
  };

  return JSON.stringify(contract, null, 2) + '\n';
}

const json = build();

if (process.argv.includes('--check')) {
  if (!existsSync(OUT)) {
    console.error(`FAILED: ${OUT} does not exist — nothing to check against.`);
    process.exit(1);
  }
  const onDisk = readFileSync(OUT, 'utf8');
  if (onDisk === json) {
    console.log(`PASS: ${OUT} is byte-identical to freshly generated output.`);
    process.exit(0);
  }
  console.error(`FAILED: ${OUT} DRIFTED from generator output (${onDisk.length} on disk vs ${json.length} generated).`);
  process.exit(1);
}

writeFileSync(OUT, json);
const c = JSON.parse(json).counts;
console.log(`WROTE ${OUT}`);
console.log(`  ids=${c.ids}  classes(ours)=${c.classesOurs}  classes(3rd-party)=${c.classesThirdParty}`);
console.log(`  attributes=${c.attributes}  tags=${c.tags}  pseudo=${c.pseudo}  hashRoutes=${c.hashRoutes}`);
console.log(`  selectors=${c.selectors}  (grammar hits=${c.extractionHits.selfEvidentGrammar}, call-site hits=${c.extractionHits.domQueryCallSite})`);
