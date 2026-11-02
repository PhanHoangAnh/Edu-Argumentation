#!/usr/bin/env python3
r"""
inline_cards.py — ruling R6 extended to CARD blocks.

R6 moved every NAMED visual (figure/equation) to its point of mention. Cards were
never in R6's scope, so a card the prose introduces with "the card below" can sit
hundreds of characters -- or several blocks -- past the paragraph that names it.

This transform does for cards what inline_figures.py did for visuals:

  For every "card below" reference in an item's prose, claim the FIRST not-yet-claimed
  card block that appears AFTER the referring text block, and splice that card in at
  the referring paragraph (paragraph-first, with a sentence sub-cut). A card the prose
  never references is left EXACTLY where it is.

Rules that are load-bearing, each measured against the two live books:

  * Only the explicit directional form "card below" / "cards below" anchors a move.
    A bare "the card" is ambiguous and matches real false positives (credit card,
    graphics card / CUDA_VISIBLE_DEVICES, "card 0").
  * "code card below" and "python card below" mean the code_cells block, NOT a card
    block -- measured: ch02-b04, ch07-b03 and ch07-b05 carry that phrasing and have
    no card block at all. Those references are EXCLUDED so no unrelated card is
    dragged to them. code_cells blocks never move.
  * Separator-blind + (?!\d)-guarded number handling is inherited from R6 for the
    visual-ordering check.
  * When the cut lands at the very end of a text block and the next block is a visual
    that this same block names EARLIER than the card, the card is emitted AFTER that
    visual run, so R6's placements are not displaced.

Idempotent by construction: a card already sitting at its naming paragraph is
re-assigned to the same split point, producing byte-identical output.

Usage:
    inline_cards.py <module.json> [--out PATH] [--report PATH] [--dry-run]
"""
import argparse
import json
import re
import sys

# "card below" but never "code card below" / "python card below" (those are code_cells)
MENTION = re.compile(r'(?<![\w-])(?<!code )(?<!python )cards?\s+below(?![\w])', re.I)

# --- inherited from inline_figures.py (R6): numbered visual identification ---------
ASSET_ID = re.compile(r'^(fig|eq)-(\d{1,3})[-.](\d{1,3})$')
ASSET_FILE = re.compile(r'^(?:.*/)?(fig|eq)-(\d{1,3})[-.](\d{1,3})\.png$')
SEP = r'[-.‐‑‒–—―−]'
LABEL = {'fig': r'(?:figures?|figs?\.?)', 'eq': r'(?:equations?|eqs?\.?)'}
VISUAL_TYPES = ('figure', 'equation')

SENT_END = re.compile(r'(?<=[.!?…])["”\')\]]*(?=\s)')


def visual_number(block):
    for key, rx in (('asset', ASSET_ID), ('src', ASSET_FILE), ('asset', ASSET_FILE)):
        val = block.get(key)
        if isinstance(val, str):
            m = rx.match(val)
            if m:
                return (m.group(1), int(m.group(2)), int(m.group(3)))
    return None


def ref_regex(kind, chapter, num):
    # (?!\d) guard: 2-6 must never match 2-60
    return re.compile(
        r'(?<![\w-])' + LABEL[kind] + r'\s*0*' + str(chapter) +
        r'\s*' + SEP + r'\s*0*' + str(num) + r'(?![\d\w])', re.IGNORECASE)


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


def inside_fence(content, off):
    """True when offset sits inside a ``` fence or a $$ math block."""
    pos = 0
    in_fence = in_math = False
    for line in content.splitlines(keepends=True):
        st = line.strip()
        nxt = pos + len(line)
        opener = st.startswith('```') or (not in_fence and st == '$$')
        if pos <= off < nxt:
            return in_fence or in_math or opener
        if st.startswith('```'):
            in_fence = not in_fence
        elif not in_fence and st == '$$':
            in_math = not in_math
        pos = nxt
    return False


def legal_split_offsets(content):
    """Paragraph boundaries OUTSIDE code fences and $$ math."""
    offsets = []
    pos = 0
    in_fence = in_math = False
    for line in content.splitlines(keepends=True):
        st = line.strip()
        if st.startswith('```'):
            in_fence = not in_fence
        elif not in_fence and st == '$$':
            in_math = not in_math
        elif not in_fence and not in_math and st == '':
            offsets.append(pos)
        pos += len(line)
    offsets.append(len(content))   # end of block is always legal
    return offsets


def nows(s):
    return re.sub(r'\s+', '', s)


def split_text_block(block, split_points, stats):
    """split_points: sorted [(offset, [blocks to splice])]. Conserves every non-ws char."""
    content = block.get('content', '')
    out = []
    cursor = 0
    pieces = []
    for offset, spliced in split_points:
        head = content[cursor:offset].strip('\n')
        if head.strip():
            piece = dict(block)
            piece['content'] = head
            out.append(piece)
            pieces.append(head)
        out.extend(spliced)
        cursor = offset
    tail = content[cursor:].strip('\n')
    if tail.strip():
        piece = dict(block)
        piece['content'] = tail
        out.append(piece)
        pieces.append(tail)
    if not pieces:
        return [block]
    # HARD INVARIANT: splitting a text block conserves its characters exactly.
    if nows(''.join(pieces)) != nows(content):
        raise AssertionError(
            'character conservation FAILED on text split (%d -> %d non-ws chars)'
            % (len(nows(content)), len(nows(''.join(pieces)))))
    stats['text_blocks_split'] += 1
    stats['text_pieces_emitted'] += len(pieces)
    return out


def transform_item(blocks, stats):
    cards = [i for i, b in enumerate(blocks) if b.get('type') == 'card']
    if not cards:
        return blocks

    claimed = set()
    in_text = {}      # text block idx -> [(offset, mention_pos, order, card_block)]
    after_block = {}  # block idx      -> [card_block, ...]
    order = 0

    for bi, b in enumerate(blocks):
        if b.get('type') != 'text':
            continue
        content = b.get('content', '') or ''
        for m in MENTION.finditer(content):
            if inside_fence(content, m.start()):
                stats['skipped_in_fence'] += 1
                continue
            stats['mentions'] += 1
            tgt = next((ci for ci in cards if ci > bi and ci not in claimed), None)
            if tgt is None:
                stats['mention_without_card_below'] += 1
                continue

            offsets = legal_split_offsets(content)
            offset = next((o for o in offsets if o >= m.end()), None)
            if offset is None:
                stats['no_legal_split'] += 1
                continue

            para = next((sp for sp in paragraph_spans(content)
                         if sp[0] <= m.start() < sp[1]), None)

            # --- sentence sub-cut -------------------------------------------------
            # (a) another card is named later in this paragraph, in a later sentence
            #     -> a paragraph cut would silently re-batch the two cards.
            # (b) the paragraph ends on a colon introducer whose referent is the NEXT
            #     paragraph (a table/list) -> a paragraph cut would wedge the card
            #     between the introducer and the thing it introduces.
            if para is not None and offset >= para[1]:
                sub = None
                nxt_m = MENTION.search(content, m.end(), para[1])
                if nxt_m and SENT_END.search(content, m.end(), nxt_m.start()):
                    sub, reason = nxt_m.start(), 'second_card_in_paragraph'
                elif content[para[0]:para[1]].rstrip().endswith(':'):
                    sub, reason = para[1], 'colon_introducer'
                if sub is not None:
                    sm = SENT_END.search(content, m.end(), sub)
                    if sm and sm.end() < offset:
                        offset = sm.end()
                        stats['sentence_cut'] += 1
                        stats['sentence_cut_' + reason] += 1

            claimed.add(tgt)
            card = blocks[tgt]

            # --- do not displace R6's visual placements ---------------------------
            # cut at end of block + next block(s) are visuals this block names EARLIER
            # than the card  ->  emit the card AFTER that visual run.
            if offset == len(content):
                anchor = bi
                while anchor + 1 < len(blocks) and blocks[anchor + 1].get('type') in VISUAL_TYPES:
                    vn = visual_number(blocks[anchor + 1])
                    if vn is None:
                        break
                    # R6's invariant is STRICTER than card adjacency and must win: if this
                    # text block names the visual at all, R6 placed that visual immediately
                    # after this block, so slipping a card in front of it would put a
                    # NON-VISUAL between the visual and its own naming sentence. Skip past
                    # it regardless of which of the two is mentioned first -- measured: the
                    # mention-order test alone left 8 figures (fig-4-12, fig-4-13, fig-5-12,
                    # eq-5-8, fig-9-14, fig-14-10, fig-14-27, fig-19-4) failing R6 gate G1.
                    if ref_regex(*vn).search(content) is None:
                        break
                    anchor += 1
                if anchor != bi:
                    after_block.setdefault(anchor, []).append(card)
                    stats['placed_after_visual'] += 1
                    if tgt == anchor + 1:
                        stats['already_in_place'] += 1
                    else:
                        stats['moved'] += 1
                    continue

            if tgt == bi + 1 and offset == len(content):
                stats['already_in_place'] += 1
            else:
                stats['moved'] += 1
            in_text.setdefault(bi, []).append((offset, m.start(), order, card))
            order += 1

    stats['cards_untouched'] += len(cards) - len(claimed)

    if not in_text and not after_block:
        return blocks

    out = []
    for i, b in enumerate(blocks):
        if i in claimed:
            pass                                    # emitted at its anchor
        elif i in in_text:
            groups = {}
            for offset, mpos, o, cb in sorted(in_text[i]):
                groups.setdefault(offset, []).append(cb)
            out.extend(split_text_block(b, sorted(groups.items()), stats))
        else:
            out.append(b)
        if i in after_block:
            out.extend(after_block[i])
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

    if dump(doc, indent, trailing_nl) != raw:
        print('WARN: round-trip is not byte-identical for %s (indent=%s); '
              'diff will not be placement-only' % (args.path, indent), file=sys.stderr)

    import collections
    stats = collections.Counter()
    for k in ('mentions', 'moved', 'already_in_place', 'cards_untouched',
              'mention_without_card_below', 'skipped_in_fence', 'no_legal_split',
              'sentence_cut', 'placed_after_visual', 'text_blocks_split',
              'text_pieces_emitted'):
        stats[k] = 0

    transform(doc, stats)
    out_text = dump(doc, indent, trailing_nl)

    target = args.out or args.path
    if not args.dry_run:
        with open(target, 'w', encoding='utf-8') as fh:
            fh.write(out_text)
    if args.report:
        with open(args.report, 'w', encoding='utf-8') as fh:
            json.dump(dict(stats), fh, indent=2, sort_keys=True)
    print(json.dumps(dict(stats), indent=2, sort_keys=True))


if __name__ == '__main__':
    main()
