#!/usr/bin/env python3
"""
inline_figures.py — ruling R6: move every NAMED visual to its point of mention.

Transforms a book package's module.json in place (with a mandatory external backup
taken by the caller). For every figure/equation block that carries a numbered asset
(fig-2-6, eq-2-1, fig-1.3 ...), search the prose of the SAME item for a reference to
that number ("Figure 2-6", "Equation 2-1", separator-agnostic, case-insensitive).
If found: split the text block at the end of the paragraph containing the reference
and splice the visual in immediately after. If NOT found by number: leave the visual
exactly where it is. Never guess from captions, proximity or ordering.

Idempotent by construction: a visual already sitting after its naming paragraph is
re-assigned to the same split point, which is the end of that text piece, producing
byte-identical output.

Usage:
    inline_figures.py <module.json> [--out PATH] [--report PATH] [--dry-run]
"""
import argparse
import json
import re
import sys

# assets look like fig-2-6 / eq-2-1 / fig-1.3 (bare id) or assets/fig-2-6.png (src)
ASSET_ID = re.compile(r'^(fig|eq)-(\d{1,3})[-.](\d{1,3})$')
ASSET_FILE = re.compile(r'^(?:.*/)?(fig|eq)-(\d{1,3})[-.](\d{1,3})\.png$')

# separators seen in prose: hyphen, dot, unicode dashes, minus sign
SEP = r'[-.‐‑‒–—―−]'
LABEL = {'fig': r'(?:figures?|figs?\.?)', 'eq': r'(?:equations?|eqs?\.?)'}

VISUAL_TYPES = ('figure', 'equation')


def visual_number(block):
    """Return (kind, chapter, num) for a numbered visual, else None."""
    for key, rx in (('asset', ASSET_ID), ('src', ASSET_FILE), ('asset', ASSET_FILE)):
        val = block.get(key)
        if isinstance(val, str):
            m = rx.match(val)
            if m:
                return (m.group(1), int(m.group(2)), int(m.group(3)))
    return None


def ref_regex(kind, chapter, num):
    return re.compile(
        r'(?<![\w-])' + LABEL[kind] + r'\s*0*' + str(chapter) +
        r'\s*' + SEP + r'\s*0*' + str(num) + r'(?![\d\w])',
        re.IGNORECASE)


SENT_END = re.compile(r'(?<=[.!?\u2026])["\u201d\')\]]*(?=\s)')


def paragraph_spans(content):
    """(start, end) of each blank-line-delimited chunk, fence/math aware."""
    spans = []
    pos = start = 0
    in_fence = in_math = False
    for line in content.splitlines(keepends=True):
        st = line.strip()
        if st.startswith('```'):
            in_fence = not in_fence
        elif not in_fence and st == '$$':
            in_math = not in_math
        elif not in_fence and not in_math and st == '':
            if content[start:pos].strip():
                spans.append((start, pos))
            start = pos + len(line)
        pos += len(line)
    if content[start:].strip():
        spans.append((start, len(content)))
    return spans


def same_sentence(content, a, b):
    """True when no sentence terminator separates offsets a and b."""
    return SENT_END.search(content, a, b) is None


def legal_split_offsets(content):
    """Char offsets of paragraph boundaries that are OUTSIDE code fences and $$ math."""
    offsets = []
    pos = 0
    in_fence = False
    in_math = False
    for line in content.splitlines(keepends=True):
        stripped = line.strip()
        if stripped.startswith('```'):
            in_fence = not in_fence
        elif not in_fence and stripped == '$$':
            in_math = not in_math
        elif not in_fence and not in_math and stripped == '':
            offsets.append(pos)
        pos += len(line)
    offsets.append(len(content))  # end of block is always a legal boundary
    return offsets


def split_text_block(block, split_points):
    """split_points: sorted list of (offset, [visual blocks]). Returns new block list."""
    content = block.get('content', '')
    out = []
    cursor = 0
    for offset, visuals in split_points:
        head = content[cursor:offset].strip('\n')
        if head.strip():
            piece = dict(block)
            piece['content'] = head
            out.append(piece)
        out.extend(visuals)
        cursor = offset
    tail = content[cursor:].strip('\n')
    if tail.strip():
        piece = dict(block)
        piece['content'] = tail
        out.append(piece)
    if not out:                       # degenerate: nothing survived, keep original
        return [block]
    return out


def transform_item(blocks, stats):
    text_idx = [i for i, b in enumerate(blocks) if b.get('type') == 'text']
    card_idx = [i for i, b in enumerate(blocks) if b.get('type') == 'card']

    assignments = {}   # text block index -> list of (split_offset, fig_order, block)
    moved = set()

    for j, b in enumerate(blocks):
        if b.get('type') not in VISUAL_TYPES:
            continue
        stats['visuals'] += 1
        num = visual_number(b)
        if num is None:
            stats['no_number'] += 1
            continue
        stats['numbered'] += 1
        rx = ref_regex(*num)

        hit = None
        for ti in text_idx:                       # FIRST naming text block, in order
            m = rx.search(blocks[ti].get('content', ''))
            if m:
                hit = (ti, m.end())
                break
        if hit is None:
            if any(rx.search(blocks[ci].get('content', '') or '') for ci in card_idx):
                stats['named_only_in_card'] += 1
            else:
                stats['not_named'] += 1
            continue

        ti, end = hit
        content = blocks[ti].get('content', '') or ''
        bounds = legal_split_offsets(content)
        offset = next((o for o in bounds if o >= end), None)
        if offset is None:
            stats['no_legal_split'] += 1
            continue

        # Sentence-level fallback: when this paragraph also names ANOTHER asset in a
        # DIFFERENT sentence, a paragraph-level cut would silently re-batch the two.
        # Cut at the end of this visual's own sentence instead.
        para = next((sp for sp in paragraph_spans(content)
                     if sp[0] <= hit[1] - 1 < sp[1]), None)
        if para is not None:
            others = []
            for ob in blocks:
                if ob is b or ob.get('type') not in VISUAL_TYPES:
                    continue
                onum = visual_number(ob)
                if onum is None or onum == num:
                    continue
                om = ref_regex(*onum).search(content, end, para[1])
                if om:
                    others.append(om.start())
            far = [o for o in others if not same_sentence(content, end, o)]
            if far:
                sm = SENT_END.search(content, end, min(far))
                if sm and sm.end() < offset:
                    offset = sm.end()
                    stats['sentence_cut'] += 1
        assignments.setdefault(ti, []).append((offset, end, j, b))
        moved.add(j)
        stats['spliced'] += 1

    if not assignments:
        return blocks

    out = []
    for i, b in enumerate(blocks):
        if i in moved:
            continue                                   # emitted at its splice point
        if i in assignments:
            groups = {}
            for offset, mention, order, vb in sorted(assignments[i]):
                groups.setdefault(offset, []).append(vb)
            out.extend(split_text_block(b, sorted(groups.items())))
        else:
            out.append(b)
    return out


def transform(doc, stats):
    for sec in doc.get('tutorialData', {}).get('sections', []) or []:
        for item in sec.get('items', []) or []:
            item['blocks'] = transform_item(item.get('blocks', []) or [], stats)
    return doc


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
    ap.add_argument('--out')
    ap.add_argument('--report')
    ap.add_argument('--dry-run', action='store_true')
    args = ap.parse_args()

    with open(args.path, encoding='utf-8') as fh:
        raw = fh.read()
    doc = json.loads(raw)
    indent = detect_indent(raw)
    trailing_nl = raw.endswith('\n')

    roundtrip = dump(doc, indent, trailing_nl)
    if roundtrip != raw:
        print(f'WARN: round-trip is not byte-identical for {args.path} '
              f'(indent={indent}); diff will not be placement-only', file=sys.stderr)

    stats = dict(visuals=0, numbered=0, no_number=0, spliced=0, not_named=0,
                 named_only_in_card=0, no_legal_split=0, sentence_cut=0)
    transform(doc, stats)
    out_text = dump(doc, indent, trailing_nl)

    target = args.out or args.path
    if not args.dry_run:
        with open(target, 'w', encoding='utf-8') as fh:
            fh.write(out_text)
    if args.report:
        with open(args.report, 'w', encoding='utf-8') as fh:
            json.dump(stats, fh, indent=2)
    print(json.dumps(stats, indent=2))


if __name__ == '__main__':
    main()
