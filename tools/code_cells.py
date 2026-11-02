#!/usr/bin/env python3
"""
code_cells.py — ruling R7: make the book's static python listings runnable.

Sibling of inline_figures.py (ruling R6) and, like it, a ONE-SHOT content
migration on an existing book package rather than a deployed job. It lives here,
next to the reader it feeds, because the R6 transform lives here and because the
carve-out in lakehouse-architecture-standards.md §10 covers exactly this shape:
a script whose OUTPUT is the point, never copied to a box, never scheduled,
never imported by a job.

WHAT IT DOES
------------
Every `card` block whose content is a fenced ```python block becomes a
`code_cells` block **at the same index in blocks[]** (ruling R6: nothing is
re-grouped, floated or sorted), carrying `language: "python"` and an explicit
`ordinal`. Prose that surrounded the fence stays behind in the card, in place,
ahead of the cells.

TWO BEHAVIOURS THAT MUST SURVIVE (aws-quiz-app/js/app.js, frozen)
-----------------------------------------------------------------
1. Cell numbering and the shared kernel are CHAPTER-scoped, not block-scoped.
   `lessonCodeCells()` scans every item of the chapter and keeps the blocks
   whose `lesson` matches. So every code_cells block emitted for one chapter
   carries the SAME `lesson` value — the id of the first code-bearing item in
   that chapter. Scope it to the item instead and `housing.hist()` runs in a
   kernel that never loaded `housing`, dying with NameError.
   ⛔ `lesson` must still match the proxy's BLOCK_ID `^ch\\d{2}-b\\d{2}$`
   (edu_server.py:153,1224) — a bare chapter id like "ch02" is rejected 400.
2. Run order is derived from PAGE order: `runCell` sends `cells.slice(0, upTo+1)`.
   So the emitted ordinal must be the document position within the chapter, and
   the cells must be emitted in that order.

RUNNABILITY IS MEASURED, NEVER GUESSED
--------------------------------------
`--runner-modules FILE` takes the JSON map produced by probing the real runner
venv on .68 (see the report for the exact probe). A listing is runnable only if
  (a) it parses as Python, and
  (b) every top-level module it imports is importable in that venv, and
  (c) every EARLIER listing in the same chapter chain is runnable — the kernel
      is shared and executed in order, so a broken earlier cell stops the chain
      before this one is reached (runner.py run_cells()).
A listing that fails any of the three stays a `card` (so the frozen reader never
paints a Run button on it), and is annotated with a machine-readable
`runnable: false` + `runnableReason`, plus one visible line telling the reader
why. A dead Run button is worse than no button (R7 §4).

IDEMPOTENT BY CONSTRUCTION
--------------------------
Emitted blocks are marked `generated: "R7/code_cells.py"`. A second run finds
them, rebuilds the chain from them plus any remaining python cards in page
order, and re-emits identical ids/ordinals. The reader-visible note on an
un-runnable card is stripped and re-appended rather than appended-if-absent, so
a changed reason converges instead of stacking.

Usage:
    code_cells.py <module.json> --runner-modules mods.json
                  [--out PATH] [--report PATH] [--dry-run]
"""
import argparse
import ast
import json
import os
import re
import sys
from collections import Counter

FENCE = re.compile(r'```([A-Za-z0-9_+-]*)[ \t]*\n(.*?)\n?```', re.S)
GENERATED = 'R7/code_cells.py'
NOTE_MARK = '> ⛔ **Not runnable here**'
NOTE_RE = re.compile(r'\n*' + re.escape(NOTE_MARK) + r'[^\n]*', re.S)
LAB = 'Run it in `ml/study/geron-lab` locally.'

# The runner's own kernel preamble already imports these under the usual aliases,
# but a listing must still be judged on what IT imports. Stdlib names are counted
# like any other module and probed the same way.


def python_fences(content):
    """[(start, end, source)] for every fenced python block, in order."""
    out = []
    for m in FENCE.finditer(content or ''):
        if m.group(1) == 'python':
            out.append((m.start(), m.end(), m.group(2)))
    return out


def deprompt(source):
    """Turn a >>> console transcript into a runnable script, or return None.

    Lines starting with `>>> ` / `... ` are code (prompt stripped). A non-prompt
    line is ECHOED OUTPUT only while it is in the contiguous run that follows a
    prompt line; a blank line ENDS that run, so plain code resumed after an
    output block is kept. Without the blank-line reset this silently deleted ten
    lines of real code from ch04-b14 (the LogisticRegression fit) — measured,
    which is why the guard below exists as well.

    GUARD: every line this function drops is re-parsed on its own. Interpreter
    output (`array([...])`, `0.11 sepal length (cm)`) either fails to parse or is
    a bare expression. Anything that parses as an import, assignment, def, class,
    loop or conditional is CODE, and dropping it would be data loss — so the
    whole de-prompt is abandoned and the listing stays a card.
    Returns None when the result does not parse or the guard trips.
    """
    if '>>>' not in source:
        return None
    kept, dropped, in_output = [], [], False
    for line in source.split('\n'):
        stripped = line.lstrip()
        if stripped.startswith('>>> ') or stripped == '>>>':
            in_output = True
            kept.append(stripped[4:])
        elif stripped.startswith('... ') or stripped == '...':
            kept.append(stripped[4:])
        elif not stripped:
            in_output = False
            kept.append('')
        elif in_output:
            dropped.append(line)
        else:
            kept.append(line)
    for line in dropped:
        try:
            tree = ast.parse(line.strip())
        except SyntaxError:
            continue
        if any(not isinstance(node, ast.Expr) for node in tree.body):
            return None
    text = '\n'.join(kept).strip('\n')
    try:
        ast.parse(text)
    except SyntaxError:
        return None
    return text


def top_imports(source):
    """Set of top-level module names imported by `source`; None if it won't parse."""
    try:
        tree = ast.parse(source)
    except SyntaxError:
        return None
    mods = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                mods.add(alias.name.split('.')[0])
        elif isinstance(node, ast.ImportFrom) and node.level == 0 and node.module:
            mods.add(node.module.split('.')[0])
    return mods


def collect_chain(section):
    """Every python listing in one chapter, in document order.

    Yields dicts: item index, block index, source, and whether it came from an
    already-generated code_cells block (second run) or a raw card (first run).
    """
    chain = []
    for ii, item in enumerate(section.get('items', []) or []):
        for bi, block in enumerate(item.get('blocks', []) or []):
            if not isinstance(block, dict):
                continue
            kind = block.get('type')
            if kind == 'code_cells' and block.get('generated') == GENERATED:
                for cell in block.get('cells', []) or []:
                    chain.append(dict(item=ii, block=bi, source=cell.get('source', ''),
                                      origin='generated', raw=None))
            elif kind == 'card':
                for _, _, src in python_fences(block.get('content')):
                    chain.append(dict(item=ii, block=bi, source=src,
                                      origin='card', raw=block))
    return chain


def classify(chain, available, stats, weights=None):
    """Decide runnable/not for every link, in order. Mutates chain entries."""
    chain_broken_by = None
    # Ruling R13 weight gate. `weights` is {"ch<N>": {"<ordinal>": {"status":..,
    # "elapsed_ms":..}}} produced by weight_probe.py running the REAL chain against
    # the REAL runner. It is a MEASUREMENT, never an estimate -- nothing here may
    # guess weight from a name, a library or a line of source (R7's standing rule).
    #   status "timeout"   -> the cell exceeded CELL_TIMEOUT_SECONDS (60 s).
    #   status "restarted" -> its kernel died, which on this unit means the
    #                         cgroup MemoryMax=6G killed it.
    # Both mean: this machine cannot run it. Nothing else in this function changes.
    weights = weights or {}
    for link in chain:
        source = link['source']
        mods = top_imports(source)
        if mods is None:
            fixed = deprompt(source)
            if fixed is None:
                link['runnable'] = False
                link['reason'] = ('this listing is a console transcript mixed with its own '
                                  'printed output, not a standalone script.')
                link['source'] = source
                stats['not_python'] += 1
                if chain_broken_by is None:
                    chain_broken_by = link
                continue
            stats['deprompted'] += 1
            link['deprompted'] = True
            link['source'] = source = fixed
            mods = top_imports(source)
        missing = sorted(m for m in mods if not available.get(m, False))
        if missing:
            link['runnable'] = False
            names = ', '.join('`%s`' % m for m in missing)
            link['reason'] = ('the code runner does not have %s installed.' % names)
            stats['missing_module'] += 1
            if chain_broken_by is None:
                chain_broken_by = link
            continue
        if chain_broken_by is not None:
            link['runnable'] = False
            link['reason'] = ('an earlier listing in this chapter cannot run (%s) and the '
                              'chapter shares one kernel in page order, so this code is '
                              'never reached.' % chain_broken_by['reason'].rstrip('.'))
            stats['chain_blocked'] += 1
            continue
        measured = (weights.get('ch%02d' % link['chapter']) or {}).get(str(link['ordinal'])) \
            if 'chapter' in link and 'ordinal' in link else None
        if measured and measured.get('status') in ('timeout', 'restarted'):
            link['runnable'] = False
            link['reason'] = (
                'measured against the code runner on this machine, this cell %s. '
                'It needs a stronger machine.' % (
                    'took longer than the 60 s limit' if measured['status'] == 'timeout'
                    else 'used more memory than the 6 GB limit and its kernel was killed'))
            stats['too_heavy'] = stats.get('too_heavy', 0) + 1
            if chain_broken_by is None:
                chain_broken_by = link
            continue
        link['runnable'] = True
    return chain


def chain_lesson(section, section_index):
    """The id of the first code-bearing item in the chapter — the shared kernel key."""
    for ii, item in enumerate(section.get('items', []) or []):
        for block in item.get('blocks', []) or []:
            if not isinstance(block, dict):
                continue
            if block.get('type') == 'code_cells' and block.get('generated') == GENERATED:
                return lesson_id(section_index, ii)
            if block.get('type') == 'card' and python_fences(block.get('content')):
                return lesson_id(section_index, ii)
    return None


def lesson_id(section_index, item_index):
    return 'ch%02d-b%02d' % (section_index + 1, item_index + 1)


def strip_note(content):
    return NOTE_RE.sub('', content or '').rstrip()


def apply_section(section, section_index, available, stats, weights=None):
    chain = collect_chain(section)
    if not chain:
        return
    # ordinals BEFORE classify: R13's weight gate is keyed on (chapter, ordinal),
    # which is how weight_probe.py labels what it measured.
    for n, link in enumerate(chain, start=1):
        link['ordinal'] = n
        link['cell_id'] = 'c%02d' % n
        link['chapter'] = section_index + 1
    classify(chain, available, stats, weights)
    lesson = chain_lesson(section, section_index)

    # rebuild every touched block, in place
    by_block = {}
    for link in chain:
        by_block.setdefault((link['item'], link['block']), []).append(link)

    for ii, item in enumerate(section.get('items', []) or []):
        blocks = item.get('blocks', []) or []
        rebuilt = []
        for bi, block in enumerate(blocks):
            links = by_block.get((ii, bi))
            if not links:
                rebuilt.append(block)
                continue
            rebuilt.extend(rebuild_block(block, links, lesson, stats))
        item['blocks'] = rebuilt


def rebuild_block(block, links, lesson, stats):
    """One source block -> the block(s) that replace it, at the same position."""
    if block.get('type') == 'code_cells':
        # second run: re-emit from the same sources so ids/ordinals converge
        return [code_block(block, links, lesson)]

    runnable = [l for l in links if l['runnable']]
    blocked = [l for l in links if not l['runnable']]
    content = strip_note(block.get('content'))

    if not runnable:
        # stays a card: the frozen reader must not paint a Run button on it
        card = dict(block)
        card['content'] = content + '\n\n' + NOTE_MARK + ' — ' + blocked[0]['reason'] + ' ' + LAB
        card['language'] = 'python'
        card['runnable'] = False
        card['runnableReason'] = blocked[0]['reason']
        card['generated'] = GENERATED
        stats['cards_kept'] += 1
        return [card]

    # strip the python fences out of the card; keep whatever prose remains, in place
    prose = content
    for start, end, _ in reversed(python_fences(content)):
        prose = prose[:start] + prose[end:]
    prose = re.sub(r'\n{3,}', '\n\n', prose).strip()

    out = []
    if prose:
        card = dict(block)
        card['content'] = prose
        card.pop('runnable', None)
        card.pop('runnableReason', None)
        card.pop('language', None)
        card.pop('generated', None)
        out.append(card)
        stats['prose_cards_kept'] += 1
    out.append(code_block(None, runnable, lesson))
    stats['cards_converted'] += 1
    stats['cells_emitted'] += len(runnable)
    return out


def code_block(existing, links, lesson):
    cells = []
    for link in links:
        cells.append({
            'id': link['cell_id'],
            'ordinal': link['ordinal'],
            'language': 'python',
            'runnable': True,
            'source': link['source'],
        })
    block = {
        'type': 'code_cells',
        'lesson': lesson,
        'language': 'python',
        'generated': GENERATED,
        'ordinal': links[0]['ordinal'],
        'cells': cells,
    }
    if existing and existing.get('title'):
        block['title'] = existing['title']
    return block


# ---------------------------------------------------------------- conservation

def inventory(doc):
    """Everything that must be conserved, measured the same way before and after."""
    counts, texts, listings, cards = {}, [], [], []
    for sec in doc.get('tutorialData', {}).get('sections', []) or []:
        for item in sec.get('items', []) or []:
            for block in item.get('blocks', []) or []:
                if not isinstance(block, dict):
                    continue
                kind = block.get('type', '?')
                counts[kind] = counts.get(kind, 0) + 1
                if kind in ('text', 'callout', 'deeper', 'figure', 'equation', 'diagram'):
                    texts.append(json.dumps(block, sort_keys=True, ensure_ascii=False))
                elif kind == 'card':
                    cards.append(strip_note(block.get('content')))
                    for _, _, src in python_fences(block.get('content')):
                        listings.append(src)
                elif kind == 'code_cells':
                    for cell in block.get('cells', []) or []:
                        listings.append(cell.get('source', ''))
    return dict(counts=counts, texts=texts, listings=listings, cards=cards)


def detect_indent(raw):
    for line in raw.split('\n')[1:]:
        if line.strip():
            return len(line) - len(line.lstrip(' '))
    return 2


def dump(doc, indent, trailing_nl):
    return json.dumps(doc, indent=indent, ensure_ascii=False) + ('\n' if trailing_nl else '')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('path')
    ap.add_argument('--runner-modules', required=True,
                    help='JSON {module: bool} measured against the real runner venv')
    ap.add_argument('--out')
    ap.add_argument('--report')
    ap.add_argument('--measured-weights',
                    help='JSON from weight_probe.py: measured status/elapsed per cell. '
                         'R13: a cell is disabled on weight ONLY when it was measured '
                         'to time out or to be OOM-killed -- never by estimate.')
    ap.add_argument('--dry-run', action='store_true')
    args = ap.parse_args()

    with open(args.runner_modules, encoding='utf-8') as fh:
        available = json.load(fh)
    weights = {}
    if args.measured_weights:
        with open(args.measured_weights, encoding='utf-8') as fh:
            weights = json.load(fh)
    with open(args.path, encoding='utf-8') as fh:
        raw = fh.read()
    doc = json.loads(raw)
    indent = detect_indent(raw)
    trailing_nl = raw.endswith('\n')
    if dump(doc, indent, trailing_nl) != raw:
        print('WARN: round-trip is not byte-identical; the diff will not be transform-only',
              file=sys.stderr)

    before = inventory(doc)
    stats = dict(cards_converted=0, cells_emitted=0, cards_kept=0, prose_cards_kept=0,
                 not_python=0, missing_module=0, chain_blocked=0, deprompted=0)
    detail = []
    for si, sec in enumerate(doc.get('tutorialData', {}).get('sections', []) or []):
        apply_section(sec, si, available, stats, weights)
    after = inventory(doc)

    # ---- conservation assertions: trip and STOP, never warn and continue
    problems = []
    if before['texts'] != after['texts']:
        problems.append('non-card prose blocks changed')
    if len(before['listings']) != len(after['listings']):
        problems.append('python listing count %d -> %d' % (len(before['listings']), len(after['listings'])))
    lost = Counter(before['listings']) - Counter(after['listings'])
    if sum(lost.values()) > stats['deprompted']:
        problems.append('%d listings changed but only %d de-prompts were recorded'
                        % (sum(lost.values()), stats['deprompted']))
    detail.extend(sorted(lost.elements()))
    before_prose = sum(len(c) for c in before['cards'])
    after_prose = sum(len(c) for c in after['cards'])
    for kind in ('text', 'callout', 'deeper', 'figure', 'equation'):
        if before['counts'].get(kind, 0) != after['counts'].get(kind, 0):
            problems.append('%s block count %d -> %d' % (kind, before['counts'].get(kind, 0),
                                                         after['counts'].get(kind, 0)))
    expected_cards = before['counts'].get('card', 0) - stats['cards_converted'] + stats['prose_cards_kept']
    if after['counts'].get('card', 0) != expected_cards:
        problems.append('card count %d, expected %d' % (after['counts'].get('card', 0), expected_cards))

    report = dict(stats=stats,
                  counts_before=before['counts'], counts_after=after['counts'],
                  card_prose_chars_before=before_prose, card_prose_chars_after=after_prose,
                  listings_before=len(before['listings']), listings_after=len(after['listings']),
                  problems=problems, deprompted_originals=detail)
    out_text = dump(doc, indent, trailing_nl)

    if problems:
        print(json.dumps(report, indent=2))
        print('ABORT: conservation assertion failed; nothing written.', file=sys.stderr)
        sys.exit(2)

    target = args.out or args.path
    if not args.dry_run:
        # write-then-rename: the study app serves this file live, and a partial
        # read would take the reader's whole book away mid-session.
        temp = target + '.tmp'
        with open(temp, 'w', encoding='utf-8') as fh:
            fh.write(out_text)
        os.replace(temp, target)
    if args.report:
        with open(args.report, 'w', encoding='utf-8') as fh:
            json.dump(report, fh, indent=2, ensure_ascii=False)
    print(json.dumps(report, indent=2, ensure_ascii=False))


if __name__ == '__main__':
    main()
