#!/usr/bin/env python3
r"""
question_classifier.py — teaching-contract Q3/Q4: sort every question into
concept / api / trivia, from the question text alone.

⚠ REBUILT 23-09-26. This file is a RECONSTRUCTION. The Phase-1 original
(22-09-26, geron-material-green) was written on the user's home Mac and never
pushed; its rule text was lost with it. This rebuild's concept/api/trivia
split does NOT reproduce the original's numbers, and was not tuned to: it is a
rule written down here, in full, so the next measurement is reproducible even
if this one is not comparable. Measured disagreement with the lost original on
the frozen RED fixture (sha256 6712483e...):

    original (phase-01-census-baseline_22-09-26.txt): concept 1371 / api 165 / trivia 14
    this rebuild:                                    see the report
    phase-01-tools-rebuild_REPORT_23-09-26.md

Treat Q4 numbers from before and after 23-09-26 as two different instruments.
The contract itself (TEACHING-CONTRACT_22-09-26.md §Q3/Q4) calls this a
heuristic and requires it be reported as +/-5 %; a gap larger than that is a
different method, not noise.

THE WRITTEN RULE
----------------
An IDENTIFIER is any of, found in the text:
  * a backtick code span that starts like a Python name   `pd.cut`
    (a span such as `.tgz` — a file extension — is NOT an identifier)
  * a call                               fit_transform(   train_test_split()
  * a dotted name (both sides >= 2 chars) sklearn.datasets   model.coef_
  * a snake_case name                    random_state   n_estimators
  * a keyword argument                   stratify=
("e.g." / "i.e." are not dotted names — both sides must be two characters.)

Each question is classified from its STEM and its CORRECT OPTION only:
  api      the stem quotes an identifier AND either the correct option quotes one
           too, or the stem asks about the API surface itself (argument, parameter,
           method, function, attribute, class, call, returns, keyword, import,
           module, syntax, hyperparameter)
  trivia   not api, and the stem asks for a bare fact with no explanatory load:
           who / which or what year / how many / what percentage / which company /
           named after / stands for / acronym
  concept  everything else

Separately, IDENTIFIER QUESTION (the ch1-5 audit's D1 sense, "a question that
quotes a library identifier") = the stem or ANY option quotes an identifier.
This is a different, wider number than `api` and is reported beside it.
It REPRODUCES the 23-09 written-rule figures on RED: ch02 31.4 % (33/105),
ch13 51.4 % (54/105, the worst chapter). ⚠ Honest provenance: the `.tgz`
exclusion was added after a first draft read ch02 as 34/105; the one extra
question was ch02-b04-q5, whose only "identifier" was the file extension `.tgz`.

Deterministic, stdlib only, Python 3.10-compatible (nn runs 3.10.12). It reads
module.json and writes nothing.

Usage:
    question_classifier.py <module.json> [--per-chapter] [--json]
"""
import argparse
import collections
import json
import re
import sys

IDENTIFIER = re.compile(
    r"`[A-Za-z_][^`\n]*`"                          # backtick span that starts like a name
    r"|\b[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*\("        # call
    r"|\b[A-Za-z_]\w+\.[A-Za-z_]\w+"               # dotted name, both sides >= 2
    r"|\b[a-z][a-z0-9]*_[a-z0-9_]+\b"              # snake_case
    r"|\b[A-Za-z_]\w*=(?!=)"                       # keyword argument
)
API_ASK = re.compile(
    r"\b(argument|arguments|parameter|parameters|method|methods|function|functions|attribute|"
    r"attributes|class|call|calls|return|returns|keyword|import|module|syntax|hyperparameter|"
    r"hyperparameters)\b", re.I)
TRIVIA_ASK = re.compile(
    r"\b(who|which year|what year|in what year|how many|what percentage|which company|"
    r"named after|stands for|acronym)\b", re.I)

CLASSES = ("concept", "api", "trivia")


def has_identifier(text):
    return bool(IDENTIFIER.search(text or ""))


def classify(q):
    """Return 'concept' | 'api' | 'trivia' for one quizData entry."""
    stem = str(q.get("question") or "")
    options = q.get("options") or []
    correct = q.get("correct")
    right = str(options[correct]) if isinstance(correct, int) and 0 <= correct < len(options) else ""
    if has_identifier(stem) and (has_identifier(right) or API_ASK.search(stem)):
        return "api"
    if TRIVIA_ASK.search(stem):
        return "trivia"
    return "concept"


def is_identifier_question(q):
    """D1 sense: the stem or any option quotes a code identifier."""
    texts = [str(q.get("question") or "")] + [str(o) for o in (q.get("options") or [])]
    return any(has_identifier(t) for t in texts)


def chapter_of(q):
    src = q.get("source") or {}
    ch = src.get("chapter")
    if isinstance(ch, int):
        return ch
    m = re.match(r"^ch(\d{2})-b\d{2}$", str(src.get("block") or ""))
    return int(m.group(1)) if m else 0


def classify_module(doc):
    """{'total': Counter, 'per_chapter': {ch: Counter}, 'identifier': Counter, 'questions': Counter}"""
    total = collections.Counter({c: 0 for c in CLASSES})
    per = collections.defaultdict(lambda: collections.Counter({c: 0 for c in CLASSES}))
    ident = collections.Counter()
    nq = collections.Counter()
    for q in doc.get("quizData") or []:
        ch = chapter_of(q)
        cls = classify(q)
        total[cls] += 1
        per[ch][cls] += 1
        nq[ch] += 1
        if is_identifier_question(q):
            ident[ch] += 1
    return {"total": total, "per_chapter": dict(per), "identifier": ident, "questions": nq}


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("path")
    ap.add_argument("--per-chapter", action="store_true")
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args(argv)
    with open(args.path, encoding="utf-8") as fh:
        doc = json.load(fh)
    r = classify_module(doc)
    n = sum(r["total"].values())
    ident_total = sum(r["identifier"].values())
    if args.json:
        out = {
            "total": dict(r["total"]),
            "questions": n,
            "identifier_questions": ident_total,
            "per_chapter": {
                "ch%02d" % ch: dict(r["per_chapter"][ch], questions=r["questions"][ch],
                                    identifier=r["identifier"][ch])
                for ch in sorted(r["per_chapter"])
            },
        }
        json.dump(out, sys.stdout, indent=1, sort_keys=True)
        sys.stdout.write("\n")
        return 0
    print("question classes of %s" % args.path)
    for c in CLASSES:
        print("  %-24s %d" % (c, r["total"][c]))
    print("  %-24s %.4f" % ("api_fraction", r["total"]["api"] / n if n else 0.0))
    print("  %-24s %d (%.1f%%)" % ("identifier_questions", ident_total, 100.0 * ident_total / n if n else 0.0))
    print("  note                     heuristic; contract Q3 requires reporting as +/-5%")
    if args.per_chapter:
        print("  per chapter: concept / api / trivia · api% · identifier-question%")
        for ch in sorted(r["per_chapter"]):
            c = r["per_chapter"][ch]
            k = r["questions"][ch]
            print("  ch%02d  %3d / %3d / %3d  of %3d   api %5.1f%%   identifier %5.1f%%" % (
                ch, c["concept"], c["api"], c["trivia"], k,
                100.0 * c["api"] / k if k else 0.0, 100.0 * r["identifier"][ch] / k if k else 0.0))
    return 0


if __name__ == "__main__":
    sys.exit(main())
