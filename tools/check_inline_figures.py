#!/usr/bin/env python3
"""
check_inline_figures.py — Tier-1 gates for ruling R6.

G1 PLACEMENT   every numbered visual whose number is named in its item's prose sits
               AFTER the naming text block with NO text block in between.
G3 CONSERVED   visual multiset identical; non-whitespace prose characters identical;
               block accounting exact (blocks_after - blocks_before == extra text pieces);
               every non-text, non-visual, NON-CARD block preserved in order;
               cards conserved as a MULTISET (same cards, same count) but NOT in order.

               WHY CARDS ARE EXEMPT FROM THE ORDER ASSERTION (22-09-26):
               ruling R6 ("every visual renders at its point of mention") was extended to
               CARDS. A card is now interleaved to sit beside the prose that needs it, so
               R6 MOVES cards on purpose. The old `ob == oa` order assertion therefore
               asserted the opposite of what the ruling now requires: it was stale BY
               CONSTRUCTION, not failing because anything broke. Deleting it outright would
               have left cards unguarded, so it is REPLACED by the property that does still
               hold under R6 -- a card may move, but no card may be added, dropped or
               altered. Every other non-text non-visual block is still order-locked exactly
               as before, and G1 PLACEMENT and every figure/equation assertion are
               UNCHANGED. Fault-proved: deleting one card turns G3 RED.

(G2 idempotence is proved by the caller with sha256 of two consecutive runs.)

Usage: check_inline_figures.py <before.json> <after.json>
Exit 0 = all gates GREEN, 1 = any gate RED.
"""
import collections
import json
import re
import sys

sys.path.insert(0, __file__.rsplit('/', 1)[0])
from inline_figures import visual_number, ref_regex, VISUAL_TYPES  # noqa: E402

WS = re.compile(r'\s+')


def items(doc):
    for sec in doc.get('tutorialData', {}).get('sections', []) or []:
        for it in sec.get('items', []) or []:
            yield it


def visual_key(b):
    return (b.get('type'), b.get('asset'), b.get('src'), b.get('title'), b.get('caption'))


def paragraph_spans(content):
    """(start, end) of each blank-line-delimited chunk, fence/math aware."""
    spans = []
    pos = start = 0
    in_fence = in_math = False
    for line in content.splitlines(keepends=True):
        s = line.strip()
        if s.startswith('```'):
            in_fence = not in_fence
        elif not in_fence and s == '$$':
            in_math = not in_math
        elif not in_fence and not in_math and s == '':
            if content[start:pos].strip():
                spans.append((start, pos))
            start = pos + len(line)
        pos += len(line)
    if content[start:].strip():
        spans.append((start, len(content)))
    return spans


def all_mentions(content, visuals):
    """[(offset, key)] of every mention of any visual in `visuals`, in text order."""
    out = []
    for key, rx in visuals:
        for m in rx.finditer(content):
            out.append((m.start(), m.end(), key))
    out.sort()
    return out


def gate_placement(doc):
    """R6 placement, STRENGTHENED (the R6 wording alone is vacuous on the batched shape):
       C1 a naming text block t precedes the visual, with no text block between
       C2 only visual blocks sit between t and the visual
       C3 the mention is inside the LAST paragraph of t  (no paragraph break between
          the sentence and the picture)
       C4 no OTHER asset's mention sits between this mention and the picture, unless that
          other asset's own visual follows this one contiguously in the same visual run
          (prose order == block order: two figures named in one sentence, shown together)
    """
    checked = failures = skipped = 0
    detail = []
    reasons = collections.Counter()
    for it in items(doc):
        blocks = it.get('blocks', []) or []
        text_idx = [i for i, b in enumerate(blocks) if b.get('type') == 'text']
        numbered = {}
        for i, b in enumerate(blocks):
            if b.get('type') in VISUAL_TYPES:
                n = visual_number(b)
                if n:
                    numbered[i] = (n, ref_regex(*n))
        vis_rx = [(n, rx) for (n, rx) in numbered.values()]

        for j, b in enumerate(blocks):
            if j not in numbered:
                if b.get('type') in VISUAL_TYPES:
                    skipped += 1
                continue
            num, rx = numbered[j]
            naming = [(i, m) for i in text_idx
                      for m in [rx.search(blocks[i].get('content', '') or '')] if m]
            if not naming:
                skipped += 1
                continue
            checked += 1
            why = None
            ok = False
            for t, m in naming:
                if t >= j:
                    why = why or 'naming text block comes AFTER the picture'
                    continue
                if any(t < k < j for k in text_idx):
                    why = why or 'another text block sits between the sentence and the picture'
                    continue
                if any(blocks[k].get('type') not in VISUAL_TYPES for k in range(t + 1, j)):
                    why = why or 'a non-visual block sits between the sentence and the picture'
                    continue
                content = blocks[t].get('content', '') or ''
                spans = paragraph_spans(content)
                last = spans[-1] if spans else (0, len(content))
                if not (last[0] <= m.start() < last[1]):
                    below = sum(1 for s in spans if s[0] > m.start())
                    why = ('%d paragraph(s) below the sentence that names it '
                           '— the reader still scrolls away' % below)
                    continue
                run = [k for k in range(t + 1, len(blocks))
                       if blocks[k].get('type') in VISUAL_TYPES]
                run_after = []
                for k in range(t + 1, len(blocks)):
                    if blocks[k].get('type') not in VISUAL_TYPES:
                        break
                    run_after.append(k)
                # benign mentions: (a) a visual shown TOGETHER with this one in the same
                # contiguous run, after it; (b) a BACK-reference to a visual already shown
                # above this text block — the reader has already seen it, no scroll-away.
                allowed = [numbered[k][0] for k in run_after if k in numbered and k > j]
                allowed += [numbered[k][0] for k in numbered if k < t]
                intruders = [key for (s, e, key) in all_mentions(content, vis_rx)
                             if s >= m.end() and key != num and key not in allowed]
                if intruders:
                    why = ('sits after prose that also names %s — the block was not split'
                           % ', '.join('%s-%d%s%d' % (k[0], k[1], '-' if k[0] == 'fig' else '-', k[2])
                                       for k in dict.fromkeys(intruders)))
                    continue
                ok = True
                break
            if not ok:
                failures += 1
                reasons[why or 'no valid placement'] += 1
                if len(detail) < 8:
                    detail.append('%r %s: %s' % (it.get('term'), b.get('asset'), why))
    return checked, failures, skipped, detail, reasons


def prose_nonws(doc):
    total = 0
    for it in items(doc):
        for b in it.get('blocks', []) or []:
            if b.get('type') == 'text':
                total += len(WS.sub('', b.get('content', '') or ''))
    return total


def census(doc):
    vis = collections.Counter()
    other = []                      # order-locked: every non-text, non-visual, non-card block
    cards = collections.Counter()   # multiset only -- R6 moves cards on purpose (see module docstring)
    text_n = blocks_n = 0
    for it in items(doc):
        for b in it.get('blocks', []) or []:
            blocks_n += 1
            t = b.get('type')
            if t in VISUAL_TYPES:
                vis[visual_key(b)] += 1
            elif t == 'text':
                text_n += 1
            elif t == 'card':
                cards[json.dumps(b, sort_keys=True, ensure_ascii=False)] += 1
            else:
                other.append(json.dumps(b, sort_keys=True, ensure_ascii=False))
    return vis, other, cards, text_n, blocks_n


def main():
    before = json.load(open(sys.argv[1], encoding='utf-8'))
    after = json.load(open(sys.argv[2], encoding='utf-8'))
    red = False

    checked, failures, skipped, detail, reasons = gate_placement(after)
    print(f'G1 PLACEMENT : checked={checked} failures={failures} not-applicable={skipped}')
    for d in detail:
        print('   FAIL:', d)
    for why, n in reasons.most_common():
        print(f'   reason x{n}: {why}')
    if failures:
        red = True
        print('G1 RESULT    : RED')
    else:
        print('G1 RESULT    : GREEN')

    vb, ob, cb, tb, bb = census(before)
    va, oa, ca, ta, ba = census(after)
    pb, pa = prose_nonws(before), prose_nonws(after)
    print(f'G3 VISUALS   : before={sum(vb.values())} after={sum(va.values())} '
          f'identical={vb == va}')
    print(f'G3 PROSE     : non-whitespace chars before={pb} after={pa} equal={pb == pa}')
    print(f'G3 OTHER     : non-text non-visual non-card blocks before={len(ob)} '
          f'after={len(oa)} identical-in-order={ob == oa}')
    # R6 moves cards deliberately, so ORDER is not asserted here. What is asserted is that
    # the set of cards is untouched: same cards, same count, byte-identical content.
    print(f'G3 CARDS     : cards before={sum(cb.values())} after={sum(ca.values())} '
          f'multiset-identical={cb == ca} (order deliberately NOT asserted -- ruling R6)')
    if cb != ca:
        miss = sum((cb - ca).values())
        extra = sum((ca - cb).values())
        print(f'   FAIL: {miss} card(s) lost or altered, {extra} card(s) added or altered')
    print(f'G3 ACCOUNTING: blocks {bb} -> {ba} (delta {ba - bb}); '
          f'text {tb} -> {ta} (delta {ta - tb}); exact={ba - bb == ta - tb}')
    if not (vb == va and pb == pa and ob == oa and cb == ca and ba - bb == ta - tb):
        red = True
        print('G3 RESULT    : RED')
    else:
        print('G3 RESULT    : GREEN')

    print('OVERALL      :', 'RED' if red else 'GREEN')
    sys.exit(1 if red else 0)


if __name__ == '__main__':
    main()
