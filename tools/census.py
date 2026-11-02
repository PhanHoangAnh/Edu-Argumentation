#!/usr/bin/env python3
r"""
census.py — one NUMBER per measurable teaching-contract clause, for one module.json.

Numbers, not verdicts: no thresholds, no pass/fail, no opinion. It reads the file
and prints; it writes nothing unless --scatter is given.

⛔ IT EXITS 0 EVEN WHEN THE BOOK IS RED. Deliberate (it is a measuring tape, not a
gate). A gate built on it MUST compare a NAMED OUTPUT VALUE, never the exit status:
delete one card from the RED fixture and it prints `S4_block_card 258` and exits 0.
`census.py ... && echo ok` is a guaranteed false green.

⚠ REBUILT 23-09-26. The Phase-1 original (geron-material-green, 22-09-26) was
written on the home Mac and never pushed. It was PROMOTED from the 21-line
edu-replatform/reapply-scripts-22-09/census.py and extended. This file is a
reconstruction from the written spec and was proven against the committed oracle
`phase-01-census-baseline_22-09-26.txt` on the frozen RED fixture
(sha256 6712483edde57959c141883055c7fa2ea6197f9f3803a324da4f5f990faff8cb).
Lines that do NOT reproduce the oracle are listed, with the measured delta, in
process/features/ml/active/geron-material-green_22-09-26/
phase-01-tools-rebuild_REPORT_23-09-26.md — read that before trusting
L4 / L8 / Q4.

TWO TEXT SURFACES (the choice matters; both were fixed by matching the oracle)
------------------------------------------------------------------------------
PROSE      = text.content + card.content. Used for "is it NAMED in the prose"
             (L5, L10, R6) and for L8 prose characters.
TEACHING   = what the reader is taught on the page: text.content, card title +
             content, deeper term + text, figure title + caption + alt +
             description, equation title + caption + latex + explain. CALLOUTS
             ARE NOT TEACHING (book exercises / key points / "Look it up"), nor
             are code cells. Used for Q2 verbatim, Q6 / R20 answer-copy runs and
             L7 zero-teaching lessons.
             ⚠ Consequence worth knowing: 208 of the 209 Q2 "non-verbatim"
             questions ARE verbatim — in a callout. Counting callouts as teaching
             makes Q2_nonverbatim 1. The number is a statement about WHERE the
             evidence was quoted from, not only about whether it was invented.

LESSON IDS
----------
ch{section+1:02d}-b{item+1:02d}, 1-based, the same id quizData.source.block uses.
⚠ `--json` per-chapter keys are 0-BASED section indices ('0'..'18'); the text
output is 1-based (ch01..ch19). pc['2'] in the JSON is CHAPTER 3. Kept as the
original shipped it, because phase reports already cite the quirk.

Usage:
    census.py <module.json> [--per-chapter] [--json] [--scatter OUT.tsv]
"""
import argparse
import ast
import collections
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import question_classifier as QC  # noqa: E402  (sibling tool, same directory)

BLOCK_TYPES = ("text", "callout", "figure", "deeper", "card", "code_cells", "equation")
LESSON_ID = re.compile(r"^ch\d{2}-b\d{2}$")
MARK_R7 = "R7/code_cells.py"
MARK_CORR = "ch02-b09-corr-cell 22-09-26"

# answer-copy tokens: lowercase words of 2+ chars, underscores and apostrophes kept,
# digits dropped. Measured: reproduces the R20 scatter's run length for 1549 of 1550
# questions; the one outlier (ch10-b23, LaTeX-only option) sits above 6 either way.
TOKEN = re.compile(r"[a-z_']{2,}")
LATEX = re.compile(r"\$[^$\n]+\$")
FENCE = re.compile(r"```.*?```", re.S)
FIG_NUM = re.compile(r"^(Figure|Equation)\s+(\d+)[-–‑](\d+)")
DEMONSTRATIVE = re.compile(r"^(That|This|It|These|Those)\b")
COPY_RUN = 6
Q1_FLOOR = 0.5
# R20 axis 2 content words. ⚠ NOT a reproduction of the lost original's list —
# see the report for the measured agreement with the committed scatter.
STOPWORDS = frozenset((
    "a an the and or but if of to in on at by for with from as is are was were be been being "
    "it its this that these those there their they them he she we you your i me my our not no "
    "do does did have has had will would can could should may might must so than then too very "
    "just also into over under about which what who whom whose when where why how all any each "
    "some such only own same other more most few both one two three").split())

# C6 — the call surface that performs a REMOTE fetch. Label -> pattern.
FETCH_CALLS = (
    ("urllib.request.urlretrieve", re.compile(r"\burlretrieve\s*\(")),
    ("urllib.request.urlopen", re.compile(r"\burlopen\s*\(")),
    ("requests", re.compile(r"\brequests\.(?:get|post|put|patch|delete|head|request)\s*\(")),
    ("sklearn.datasets.fetch_*", re.compile(r"\bfetch_[a-z0-9_]+\s*\(")),
    ("tfds.load", re.compile(r"\btfds\.load\s*\(")),
    ("keras get_file", re.compile(r"\bget_file\s*\(")),
    ("load_dataset", re.compile(r"\bload_dataset\s*\(")),
    ("wget/curl", re.compile(r"^\s*!\s*(?:wget|curl)\b", re.M)),
)
URL = re.compile(r"https?://")


# ----------------------------------------------------------------- traversal
def lessons(doc):
    """[(chapter 1-based, lesson id, item)] in page order."""
    out = []
    for si, sec in enumerate((doc.get("tutorialData") or {}).get("sections") or []):
        for ii, it in enumerate(sec.get("items") or []):
            out.append((si + 1, "ch%02d-b%02d" % (si + 1, ii + 1), it))
    return out


def blocks(item):
    return [b for b in (item.get("blocks") or []) if isinstance(b, dict)]


def prose_parts(item):
    return [str(b.get("content") or "") for b in blocks(item) if b.get("type") in ("text", "card")]


def prose(item):
    return "\n".join(prose_parts(item))


def teaching_text(item):
    out = []
    for b in blocks(item):
        t = b.get("type")
        if t == "text":
            out.append(b.get("content") or "")
        elif t == "card":
            out += [b.get("title") or "", b.get("content") or ""]
        elif t == "deeper":
            for x in b.get("items") or []:
                if isinstance(x, dict):
                    out += [x.get("term") or "", x.get("text") or ""]
        elif t == "figure":
            out += [b.get(k) or "" for k in ("title", "caption", "alt", "description")]
        elif t == "equation":
            out += [b.get(k) or "" for k in ("title", "caption", "latex", "explain")]
    return "\n".join(str(s) for s in out)


def ws(s):
    return re.sub(r"\s+", " ", s or "").strip()


def tokens(s):
    return TOKEN.findall((s or "").lower())


def longest_run(a, b):
    """Longest run of consecutive tokens of `a` that also occurs consecutively in `b`."""
    pos = collections.defaultdict(list)
    for j, t in enumerate(b):
        pos[t].append(j)
    best = 0
    for i in range(len(a)):
        for j in pos.get(a[i], ()):
            k = 0
            while i + k < len(a) and j + k < len(b) and a[i + k] == b[j + k]:
                k += 1
            if k > best:
                best = k
    return best


def cells(item):
    for b in blocks(item):
        if b.get("type") == "code_cells":
            for c in b.get("cells") or []:
                if isinstance(c, dict):
                    yield b, c


def correct_option(q):
    opts = q.get("options") or []
    c = q.get("correct")
    return str(opts[c]) if isinstance(c, int) and not isinstance(c, bool) and 0 <= c < len(opts) else ""


def content_words(s):
    return {t for t in tokens(s) if t not in STOPWORDS}


def evidence_overlap(q):
    ev = (q.get("source") or {}).get("evidence") or ""
    e = content_words(ev)
    s = content_words(str(q.get("question") or "") + " " + correct_option(q))
    if not e or not s:
        return 0.0
    return round(len(e & s) / len(s), 4)


def called_names(src):
    """Called function/method names and keyword-argument names in one listing."""
    try:
        tree = ast.parse(src)
    except SyntaxError:
        return set()
    names = set()
    for n in ast.walk(tree):
        if isinstance(n, ast.Call):
            f = n.func
            if isinstance(f, ast.Name):
                names.add(f.id)
            elif isinstance(f, ast.Attribute):
                names.add(f.attr)
            names.update(k.arg for k in n.keywords if k.arg)
    return names


def fetch_hits(src):
    return [label for label, rx in FETCH_CALLS if rx.search(src or "")]


# ----------------------------------------------------------------- census
def census(doc):
    L = lessons(doc)
    by_id = {lid: it for _, lid, it in L}
    Q = doc.get("quizData") or []
    v = collections.OrderedDict()
    pc = collections.defaultdict(collections.Counter)     # chapter -> clause counter
    blk = collections.Counter()
    blk_pc = collections.defaultdict(collections.Counter)

    cells_n = 0
    markers = collections.Counter()
    run = collections.Counter()
    for ch, lid, it in L:
        for b in blocks(it):
            t = b.get("type")
            blk[t] += 1
            blk_pc[ch][t] += 1
            if t == "code_cells":
                g = b.get("generated")
                markers["R7" if g == MARK_R7 else "corr" if g == MARK_CORR else
                        "absent" if g is None else "other"] += 1
                for c in b.get("cells") or []:
                    cells_n += 1
                    r = c.get("runnable") if isinstance(c, dict) else None
                    run["true" if r is True else "false" if r is False else "absent"] += 1

    v["S1_sections"] = len((doc.get("tutorialData") or {}).get("sections") or [])
    v["S2_lessons"] = len(L)
    v["S3_questions"] = len(Q)
    for t in BLOCK_TYPES:
        v["S4_block_" + t] = blk[t]
    v["S5_block_types_other"] = sum(n for t, n in blk.items() if t not in BLOCK_TYPES)
    v["S6_inner_cells"] = cells_n
    v["S7_marker_R7"] = markers["R7"]
    v["S8_marker_corr"] = markers["corr"]
    v["S9_marker_absent"] = markers["absent"]
    v["S10_runnable_true"] = run["true"]
    v["S11_runnable_false"] = run["false"]
    v["S12_runnable_absent"] = run["absent"]

    # ---- lesson clauses
    L3 = L4 = L6 = L7 = L9d = L9l = L10f = L10e = R6 = L1 = 0
    book_chars = prose_chars = 0
    l5_seen = {}
    for ch, lid, it in L:
        B = blocks(it)
        P = prose(it)
        T = teaching_text(it)
        book_chars += len(T)
        prose_chars += sum(len(p) for p in prose_parts(it))
        for b in B:
            t = b.get("type")
            if t == "equation" and not b.get("explain"):
                L3 += 1; pc[ch]["L3"] += 1
            if t in ("text", "card") and LATEX.search(str(b.get("content") or "")):
                L4 += 1; pc[ch]["L4"] += 1
            if t in ("text", "card", "callout"):
                texts = [str(b.get("content") or "")] if t != "callout" else \
                        [str(x) for x in (b.get("items") or []) if isinstance(x, str)]
                if any(FENCE.search(s) for s in texts):
                    L6 += 1; pc[ch]["L6"] += 1
        if not T.strip():
            L7 += 1; pc[ch]["L7"] += 1
        if not any(b.get("type") == "deeper" for b in B):
            L9d += 1; pc[ch]["L9d"] += 1
        if not any(b.get("type") == "callout" and "look it up" in str(b.get("title") or "").lower() for b in B):
            L9l += 1; pc[ch]["L9l"] += 1
        # L1 shadow: a code block before the first prose block
        first_code = next((i for i, b in enumerate(B) if b.get("type") == "code_cells" or
                           (b.get("type") == "card" and "```" in str(b.get("content") or ""))), None)
        first_text = next((i for i, b in enumerate(B) if b.get("type") == "text" and
                           str(b.get("content") or "").strip()), None)
        if first_code is not None and (first_text is None or first_code < first_text):
            L1 += 1; pc[ch]["L1"] += 1
        # L10 + R6: numbered visuals and their mention in PROSE
        for vi, b in enumerate(B):
            if b.get("type") not in ("figure", "equation"):
                continue
            m = FIG_NUM.match(str(b.get("title") or ""))
            if not m:
                continue
            label = "%s %s-%s" % m.groups()
            if label not in P:
                if m.group(1) == "Figure":
                    L10f += 1; pc[ch]["L10f"] += 1
                else:
                    L10e += 1; pc[ch]["L10e"] += 1
                continue
            mentions = [i for i, x in enumerate(B)
                        if x.get("type") in ("text", "card") and label in str(x.get("content") or "")]
            if min(abs(i - vi) for i in mentions) > 1:
                R6 += 1; pc[ch]["R6"] += 1
        # L5: a called name / keyword argument never named in the lesson's prose.
        # Each distinct name counts ONCE book-wide, charged to its first chapter.
        for _b, c in cells(it):
            for name in sorted(called_names(str(c.get("source") or ""))):
                if name in l5_seen:
                    continue
                if not re.search(r"(?<!\w)%s(?!\w)" % re.escape(name), P):
                    l5_seen[name] = ch
    for name, ch in l5_seen.items():
        pc[ch]["L5"] += 1

    v["L3_equation_without_explain"] = L3
    v["L4_bare_latex_blocks"] = L4
    v["L5_identifiers_never_named"] = len(l5_seen)
    v["L6_fenced_code_in_prose_block"] = L6
    v["L7_zero_teaching_lessons"] = L7
    v["L8_book_chars"] = book_chars
    v["L8_prose_chars"] = prose_chars
    v["L9_lessons_without_deeper"] = L9d
    v["L9_lessons_without_lookitup"] = L9l
    v["L10_orphan_figures"] = L10f
    v["L10_never_named_equations"] = L10e
    v["R6_displaced_visuals_gt1_block"] = R6
    v["L1_api_before_concept_lessons"] = L1
    v["L2_note"] = "advisory (Tier-1 advisory in contract) — not counted"

    # ---- question clauses
    addressable = sum(1 for _, lid, _it in L if LESSON_ID.match(lid))
    unresolvable = q1_low = q1_rec = q2_miss = q2_nv = q2_ok = q5 = q6 = q7 = 0
    teach_cache = {}
    tok_cache = {}
    scatter = []
    for qi, q in enumerate(Q):
        src = q.get("source") or {}
        lid = str(src.get("block") or "")
        ch = QC.chapter_of(q)
        it = by_id.get(lid)
        if it is None:
            unresolvable += 1
            continue
        if lid not in teach_cache:
            teach_cache[lid] = teaching_text(it)
            tok_cache[lid] = tokens(teach_cache[lid])
        cov = src.get("evidence_coverage")
        if isinstance(cov, (int, float)) and not isinstance(cov, bool):
            q1_rec += 1
            if cov < Q1_FLOOR:
                q1_low += 1
        ev = src.get("evidence")
        if not ev:
            q2_miss += 1; pc[ch]["Q2miss"] += 1
        else:
            q2_ok += 1
            if ws(ev) not in ws(teach_cache[lid]):
                q2_nv += 1
        if DEMONSTRATIVE.search(str(q.get("question") or "")):
            q5 += 1
        right = correct_option(q)
        runlen = longest_run(tokens(right), tok_cache[lid])
        if runlen >= COPY_RUN:
            q6 += 1; pc[ch]["Q6copy"] += 1
        lens = [len(str(o)) for o in (q.get("options") or [])]
        c = q.get("correct")
        if lens and isinstance(c, int) and 0 <= c < len(lens) and lens[c] == max(lens):
            q7 += 1
        scatter.append((qi, runlen, evidence_overlap(q), ch, lid))

    v["S13_lessons_addressable"] = addressable
    v["Q0_questions_unresolvable_to_a_lesson"] = unresolvable
    v["Q1_low_coverage_questions"] = q1_low
    v["Q1_coverage_recorded"] = q1_rec
    v["Q2_missing_evidence"] = q2_miss
    v["Q2_nonverbatim_evidence"] = q2_nv
    v["Q2_evidence_present"] = q2_ok
    v["Q5_demonstrative_stems"] = q5
    v["Q6_answer_copy_run_ge6"] = q6
    v["Q7_longest_option_is_correct"] = q7
    v["Q7_longest_option_fraction"] = "%.4f" % (q7 / len(Q) if Q else 0.0)
    qc = QC.classify_module(doc)
    nq = sum(qc["total"].values())
    v["Q4_concept"] = qc["total"]["concept"]
    v["Q4_api"] = qc["total"]["api"]
    v["Q4_trivia"] = qc["total"]["trivia"]
    v["Q4_api_fraction"] = "%.4f" % (qc["total"]["api"] / nq if nq else 0.0)
    v["Q4_concept_fraction"] = "%.4f" % (qc["total"]["concept"] / nq if nq else 0.0)
    v["Q4_note"] = "heuristic; contract Q3 requires reporting as +/-5%"

    # ---- C6 remote fetch surface (census counts every fetch CALL, local or not;
    #      gates/content/no-network-fetch.mjs is the gate and excludes localhost)
    fetch = []
    url_only = []
    for ch, lid, it in L:
        for _b, c in cells(it):
            s = str(c.get("source") or "")
            if fetch_hits(s):
                fetch.append((str(it.get("term") or ""), str(c.get("id") or "")))
            elif URL.search(s):
                url_only.append((str(it.get("term") or ""), str(c.get("id") or "")))
    v["C6_network_fetch_cells"] = len(fetch)
    v["C6_url_literal_only_cells_advisory"] = len(url_only)
    return v, pc, blk_pc, qc, fetch, scatter


def main(argv=None):
    ap = argparse.ArgumentParser(description="one number per measurable teaching-contract clause")
    ap.add_argument("path")
    ap.add_argument("--per-chapter", action="store_true", help="append the per-chapter breakdown")
    ap.add_argument("--json", action="store_true", help="machine-readable (per-chapter keys are 0-BASED)")
    ap.add_argument("--scatter", metavar="OUT.tsv", help="write the R20 2-D scatter for every question")
    args = ap.parse_args(argv)
    with open(args.path, encoding="utf-8") as fh:
        doc = json.load(fh)
    v, pc, blk_pc, qc, fetch, scatter = census(doc)

    if args.scatter:
        with open(args.scatter, "w", encoding="utf-8") as fh:
            fh.write("q_index\tlcs_run_with_lesson\tevidence_overlap\tchapter\tblock\n")
            for qi, runlen, ov, ch, lid in scatter:
                fh.write("%d\t%d\t%s\t%d\t%s\n" % (qi, runlen, ov, ch, lid))

    if args.json:
        chapters = sorted(set(pc) | set(blk_pc))
        out = {"values": v, "network_fetch_cells": fetch,
               "per_chapter": {str(ch - 1): {"clauses": dict(pc[ch]), "blocks": dict(blk_pc[ch]),
                                             "q4": dict(qc["per_chapter"].get(ch, {}))}
                               for ch in chapters}}
        json.dump(out, sys.stdout, indent=1, ensure_ascii=False)
        sys.stdout.write("\n")
        return 0

    print("census of %s" % args.path)
    for k, val in v.items():
        print("  %-38s %s" % (k, val))
    print("  network-fetch cells: %r" % (fetch,))
    if args.per_chapter:
        print("per chapter (clause counters, non-zero only):")
        for ch in sorted(set(pc) | set(blk_pc)):
            print("ch%02d %s" % (ch, dict(sorted(pc[ch].items()))))
        print("per chapter (block counts):")
        for ch in sorted(blk_pc):
            print("ch%02d %s" % (ch, dict(sorted(blk_pc[ch].items()))))
        print("per chapter (Q4 concept / api / trivia):")
        for ch in sorted(qc["per_chapter"]):
            c = qc["per_chapter"][ch]
            print("ch%02d %d / %d / %d" % (ch, c["concept"], c["api"], c["trivia"]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
