#!/usr/bin/env python3
"""
check_code_cells.py — the gate for ruling R7's card -> code_cells transform.

Sibling of check_inline_figures.py (R6). Read-only. Run it against the BEFORE
file too: it must go RED there, or it is not measuring anything (R6's first
placement gate was vacuous and passed on the exact shape it existed to reject).

Assertions
----------
A1 R6 ordering survives: every generated code_cells block sits at the index its
   card occupied — the per-item block-type sequence, with generated code_cells
   mapped back to `card`, must equal the sequence in the BEFORE file.
A2 Every generated code_cells block carries `language: "python"`, a `lesson`
   matching the proxy's BLOCK_ID `^ch\\d{2}-b\\d{2}$`, and cells whose ids match
   the proxy's RUN_CELL_ID `^[a-z0-9_-]{1,32}$`.
A3 Chapter-scoped run order: within one chapter every generated block carries
   the SAME lesson, cell ids are unique in that group, and ordinals are
   1..N in document order — because runCell sends cells.slice(0, upTo+1).
A4 The group never exceeds the proxy's 50-cell request cap.
A5 Every emitted cell source parses as Python.
A6 Every `runnable: false` card carries a reason and exactly one reader-visible
   note line, and holds a python fence still (the code was not deleted).

Usage:
    check_code_cells.py <after.json> [--before BEFORE.json] [--fault ordering|ids|ordinals]
"""
import argparse
import ast
import json
import re
import sys

BLOCK_ID = re.compile(r'^ch\d{2}-b\d{2}$')
CELL_ID = re.compile(r'^[a-z0-9_-]{1,32}$')
FENCE = re.compile(r'```([A-Za-z0-9_+-]*)[ \t]*\n(.*?)\n?```', re.S)
GENERATED = 'R7/code_cells.py'
NOTE_MARK = '> ⛔ **Not runnable here**'
MAX_CELLS = 50


def sections(doc):
    return doc.get('tutorialData', {}).get('sections', []) or []


def type_sequence(doc, collapse_generated):
    seq = []
    for si, sec in enumerate(sections(doc)):
        for ii, item in enumerate(sec.get('items', []) or []):
            kinds = []
            for block in item.get('blocks', []) or []:
                kind = block.get('type')
                if collapse_generated and kind == 'code_cells' and block.get('generated') == GENERATED:
                    kind = 'card'
                kinds.append(kind)
            seq.append(('ch%02d-b%02d' % (si + 1, ii + 1), tuple(kinds)))
    return seq


def check(after, before, failures):
    if before is not None:
        a = type_sequence(after, True)
        b = type_sequence(before, False)
        if len(a) != len(b):
            failures.append('A1 item count %d != %d' % (len(a), len(b)))
        else:
            for (lid, ka), (_, kb) in zip(a, b):
                if ka != kb:
                    failures.append('A1 %s block order changed: %s != %s' % (lid, ka, kb))

    for si, sec in enumerate(sections(after)):
        chain, lessons = [], set()
        for ii, item in enumerate(sec.get('items', []) or []):
            lid = 'ch%02d-b%02d' % (si + 1, ii + 1)
            for block in item.get('blocks', []) or []:
                kind = block.get('type')
                if kind == 'code_cells' and block.get('generated') == GENERATED:
                    if block.get('language') != 'python':
                        failures.append('A2 %s missing language' % lid)
                    if not BLOCK_ID.match(str(block.get('lesson', ''))):
                        failures.append('A2 %s lesson %r fails BLOCK_ID' % (lid, block.get('lesson')))
                    lessons.add(block.get('lesson'))
                    for cell in block.get('cells', []) or []:
                        if not CELL_ID.match(str(cell.get('id', ''))):
                            failures.append('A2 %s cell id %r fails RUN_CELL_ID' % (lid, cell.get('id')))
                        if cell.get('language') != 'python' or cell.get('runnable') is not True:
                            failures.append('A2 %s cell %s missing language/runnable' % (lid, cell.get('id')))
                        try:
                            ast.parse(cell.get('source', ''))
                        except SyntaxError as error:
                            failures.append('A5 %s cell %s does not parse: %s' % (lid, cell.get('id'), error))
                        chain.append((cell.get('id'), cell.get('ordinal')))
                elif kind == 'card' and block.get('runnable') is False:
                    if not block.get('runnableReason'):
                        failures.append('A6 %s runnable:false with no reason' % lid)
                    content = block.get('content') or ''
                    if content.count(NOTE_MARK) != 1:
                        failures.append('A6 %s has %d reader notes' % (lid, content.count(NOTE_MARK)))
                    if not any(m.group(1) == 'python' for m in FENCE.finditer(content)):
                        failures.append('A6 %s lost its python fence' % lid)
        if not chain:
            continue
        if len(lessons) != 1:
            failures.append('A3 chapter %d spans %d lesson keys %s' % (si + 1, len(lessons), sorted(lessons)))
        ids = [c for c, _ in chain]
        if len(set(ids)) != len(ids):
            failures.append('A3 chapter %d has duplicate cell ids' % (si + 1))
        if [o for _, o in chain] != list(range(1, len(chain) + 1)):
            failures.append('A3 chapter %d ordinals are not 1..N in page order: %s'
                            % (si + 1, [o for _, o in chain]))
        if len(chain) > MAX_CELLS:
            failures.append('A4 chapter %d emits %d cells, over the %d-cell request cap'
                            % (si + 1, len(chain), MAX_CELLS))


def inject(doc, mode):
    for sec in sections(doc):
        for item in sec.get('items', []) or []:
            blocks = item.get('blocks', []) or []
            for bi, block in enumerate(blocks):
                if block.get('type') != 'code_cells' or block.get('generated') != GENERATED:
                    continue
                if mode == 'ordering' and bi + 1 < len(blocks):
                    blocks[bi], blocks[bi + 1] = blocks[bi + 1], blocks[bi]
                    return True
                if mode == 'ids':
                    block['cells'][0]['id'] = 'NOT A VALID ID'
                    return True
                if mode == 'ordinals':
                    block['cells'][0]['ordinal'] = 999
                    return True
    return False


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('after')
    ap.add_argument('--before')
    ap.add_argument('--fault', choices=['ordering', 'ids', 'ordinals'])
    args = ap.parse_args()

    after = json.load(open(args.after, encoding='utf-8'))
    before = json.load(open(args.before, encoding='utf-8')) if args.before else None
    if args.fault and not inject(after, args.fault):
        print('FAULT INJECTION FOUND NO TARGET', file=sys.stderr)
        sys.exit(3)

    failures = []
    check(after, before, failures)
    for line in failures[:25]:
        print('FAIL ' + line)
    print('checked %s%s -> %s (%d failures)'
          % (args.after, ' vs ' + args.before if args.before else '',
             'RED' if failures else 'GREEN', len(failures)))
    if args.fault and not failures:
        print('VACUOUS: fault injection produced NO failures', file=sys.stderr)
        sys.exit(3)
    sys.exit(1 if failures and not args.fault else 0)


if __name__ == '__main__':
    main()
