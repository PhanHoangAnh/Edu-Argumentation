"""Gate harness for tutor-book-index (plan tutor-book-index_30-09-26). NOT deployed.

app/tools/ is outside deploy-study.sh's rsync, so this file is scp'd to nn:/var/tmp/tbi/ and run
from the deployed backend with the service's own environment:

    cd /srv/foxai/edu-study/backend && export $(systemctl show -p Environment --value foxai-edu-study) \\
      && ~/edu-study-venv/bin/python /var/tmp/tbi/tutor_index_gates.py <gate> [...]

Gates: completeness (G2) · dumpsha (G3) · legacy-identity (G6) · replay (G7) · crosschapter (G8)
· cost (G5) · cite (G9) · fts-fault (G11) · make-fault (builds fault copies under /var/tmp/tbi).
Exit 0 = PASS, 1 = FAIL. Every fault copy lives under /var/tmp/tbi; the real library/ is only
ever opened read-only (mode=ro). Provider keys are read through settings.provider_config() and
are never printed.
"""

from __future__ import annotations

import argparse
import dataclasses
import glob
import hashlib
import importlib.util
import json
import os
import random
import re
import shutil
import sqlite3
import statistics
import sys
import time
from collections import Counter
from pathlib import Path
from urllib.error import URLError

sys.path.insert(0, os.getcwd())
import ai  # noqa: E402
import bookctx  # noqa: E402
import settings  # noqa: E402
import store  # noqa: E402

SCRATCH = Path("/var/tmp/tbi")
LIBRARY = Path(bookctx.LIBRARY_ROOT)
BOOK_ROOT = settings.store_path("EDU_BOOK_ROOT")
CITE = re.compile(r"ch\s?(\d+),\s*p\.\s?(\d+)", re.I)
CITE_LESSON = re.compile(r"ch\s?(\d+),\s*lesson\s+(\d+)", re.I)


def out(result: dict) -> int:
    print(json.dumps(result, indent=1, ensure_ascii=False, default=str))
    return 0 if result.get("ok") else 1


def scratch(path: str | Path) -> Path:
    resolved = Path(path).resolve()
    if SCRATCH.resolve() not in resolved.parents and resolved != SCRATCH.resolve():
        sys.exit(f"REFUSED: {resolved} is not under {SCRATCH}")
    return resolved


def ro(path: Path) -> sqlite3.Connection:
    return sqlite3.connect(f"file:{path}?mode=ro", uri=True)


def books(root: Path, wanted: str | None) -> list[str]:
    if wanted:
        return [wanted]
    return sorted(p.parent.name for p in root.glob("*/book-index.sqlite"))


def module_of(book_id: str) -> dict:
    return json.loads((LIBRARY / book_id / "module.json").read_text(encoding="utf-8"))


def page_sha(pages: list) -> str:
    # Same fingerprint as the importer's bookindex.pages_sha256 (re-derived, not imported).
    return hashlib.sha256(json.dumps([str(p or "") for p in pages], ensure_ascii=False, sort_keys=True)
                          .encode("utf-8")).hexdigest()


def page_file_for(sha: str) -> list[str] | None:
    for name in [str(BOOK_ROOT / "homl3.pages.json")] + sorted(glob.glob(str(BOOK_ROOT / "cache" / "*.pages.json"))):
        try:
            pages = json.loads(Path(name).read_text(encoding="utf-8"))["pages"]
        except (OSError, ValueError, KeyError):
            continue
        if page_sha(pages) == sha:
            return [str(p or "") for p in pages]
    return None


# ------------------------------------------------------------------------------------ G2
def g2(args) -> int:
    root = Path(args.root) if args.root else LIBRARY
    rng = random.Random(30926)
    report, ok = {}, True
    for book_id in books(root, args.book):
        problems = []
        conn = ro(root / book_id / "book-index.sqlite")
        meta = dict(conn.execute("SELECT key, value FROM meta"))
        sections = module_of(book_id)["tutorialData"]["sections"]
        if meta.get("schema_version") != "1":
            problems.append(f"schema_version {meta.get('schema_version')}")
        chapters = conn.execute("SELECT chapter, first_page, last_page FROM chapters ORDER BY chapter").fetchall()
        if [c[0] for c in chapters] != list(range(1, len(sections) + 1)):
            problems.append(f"chapters {[c[0] for c in chapters]} != 1..{len(sections)}")
        lessons = conn.execute("SELECT count(*) FROM docs WHERE kind='lesson'").fetchone()[0]
        want_lessons = sum(len(s["items"]) for s in sections)
        if lessons != want_lessons:
            problems.append(f"lessons {lessons} != module {want_lessons}")
        detail = {"source": meta.get("source"), "chapters": len(chapters), "lessons": lessons}
        if meta.get("source") == "pages":
            pages = page_file_for(meta.get("pages_sha256", ""))
            if pages is None:
                problems.append("no page file matches meta.pages_sha256")
            else:
                total = conn.execute("SELECT count(*) FROM docs WHERE kind='page'").fetchone()[0]
                body = conn.execute("SELECT count(*) FROM docs WHERE kind='page' AND chapter>0").fetchone()[0]
                want_body = sum(b - a + 1 for _c, a, b in chapters)
                detail.update(pages=total, chapter_pages=body, expected_chapter_pages=want_body)
                if total != len(pages):
                    problems.append(f"pages {total} != page file {len(pages)}")
                if body != want_body:
                    problems.append(f"chapter pages {body} != sum of ranges {want_body}")
                for number, a, b in chapters:
                    wrong = conn.execute("SELECT count(*) FROM docs WHERE kind='page' AND chapter=? AND (page<? OR page>?)",
                                         (number, a, b)).fetchone()[0]
                    if wrong:
                        problems.append(f"ch{number}: {wrong} pages outside {a}-{b}")
                sample = [rng.randint(a, b) for _c, a, b in rng.sample(chapters, min(5, len(chapters)))]
                for page in sample:
                    row = conn.execute("SELECT text FROM docs WHERE kind='page' AND page=?", (page,)).fetchone()
                    if row is None or row[0] != pages[page - 1]:
                        problems.append(f"page base: docs page {page} != pages[{page - 1}]")
                detail["sampled_pages"] = sample
                if book_id == "geron-homl3":
                    first = conn.execute("SELECT d.text FROM docs d JOIN chapters c ON c.chapter=d.chapter "
                                         "WHERE d.kind='page' AND d.chapter=4 AND d.page=c.first_page").fetchone()
                    detail["geron_ch4_first"] = first[0][:40] if first else None
                    if not first or not first[0].startswith("Chapter 4"):
                        problems.append("Géron ch4 first page does not start 'Chapter 4'")
        conn.close()
        detail["ok"] = not problems
        detail["problems"] = problems
        report[book_id] = detail
        ok &= not problems
    return out({"gate": "G2", "ok": ok and bool(report), "root": str(root), "books": report})


# ------------------------------------------------------------------------------------ G3
def g3(args) -> int:
    root = Path(args.root) if args.root else LIBRARY
    for book_id in books(root, args.book):
        conn = ro(root / book_id / "book-index.sqlite")
        digest = hashlib.sha256()
        for key, value in conn.execute("SELECT key, value FROM meta WHERE key != 'built_at' ORDER BY key"):
            digest.update(f"meta\t{key}\t{value}\n".encode())
        for row in conn.execute("SELECT * FROM chapters ORDER BY chapter"):
            digest.update(("chapters\t" + json.dumps(row, ensure_ascii=False) + "\n").encode())
        for row in conn.execute("SELECT * FROM docs ORDER BY id"):
            digest.update(("docs\t" + json.dumps(row, ensure_ascii=False) + "\n").encode())
        count = conn.execute("SELECT count(*) FROM docs").fetchone()[0]
        conn.close()
        print(f"{book_id}\t{count}\t{digest.hexdigest()}")
    return 0


# ------------------------------------------------------------------------------------ fault copies
def make_fault(args) -> int:
    dest = scratch(args.dest)
    source = LIBRARY / args.book / "book-index.sqlite"
    target = dest / args.book / "book-index.sqlite"
    shutil.rmtree(dest / args.book, ignore_errors=True)
    target.parent.mkdir(parents=True, exist_ok=True)
    if args.kind == "absent":
        return out({"ok": True, "made": str(target.parent), "kind": "absent"})
    if args.kind == "corrupt":
        target.write_bytes(os.urandom(4096))
        return out({"ok": True, "made": str(target), "kind": args.kind})
    src = ro(source)
    dst = sqlite3.connect(str(target))
    src.backup(dst)
    src.close()
    if args.kind == "delete-row":
        dst.execute("DELETE FROM docs WHERE id = (SELECT min(id) FROM docs WHERE kind='page' AND chapter>0)")
    elif args.kind == "shift-page":
        dst.execute("UPDATE docs SET page = page - 1 WHERE kind='page'")
    elif args.kind == "schema2":
        dst.execute("UPDATE meta SET value='2' WHERE key='schema_version'")
    elif args.kind == "shuffle-chapters":
        n = dst.execute("SELECT max(chapter) FROM chapters").fetchone()[0]
        dst.execute("UPDATE docs SET chapter = (chapter % ?) + 1 WHERE chapter > 0", (n,))
    elif args.kind == "copy":
        pass
    else:
        sys.exit(f"unknown kind {args.kind}")
    dst.commit()
    dst.close()
    return out({"ok": True, "made": str(target), "kind": args.kind})


# ------------------------------------------------------------------------------------ ask rows
def log_rows(path: str) -> list[dict]:
    rows = []
    for line in Path(path).read_text(encoding="utf-8").splitlines():
        try:
            row = json.loads(line)
        except ValueError:
            continue
        if row.get("module") and row.get("chapter") and row.get("question"):
            rows.append(row)
    return rows


def ask_inputs(row: dict) -> dict:
    """What api_ask derives from a request, derived the same way (main.py:664-676)."""
    book, chapter, block = row["module"], int(row["chapter"]), int(row["block"])
    chapter_title, lesson = ai.source_for_block(None, chapter, block, book)
    module = ai.load_module(None, book)
    term = module["tutorialData"]["sections"][chapter - 1]["items"][block - 1].get("term", "")
    return {"book": book, "chapter": chapter, "block": block, "question": str(row["question"]).strip(),
            "chapter_title": chapter_title, "lesson": lesson, "term": term,
            "module_id": store.module_id_for(module), "visuals": ai.block_visuals(module, chapter, block)}


class Captured(Exception):
    pass


def capture_into(module, sink: list):
    def fake(request, timeout=None):  # noqa: ARG001
        sink.append(request.data)
        raise URLError("captured, not sent")
    module.urlopen = fake


FAKE = settings.ProviderConfig(api_url="https://example.invalid/v1/chat/completions", api_key="k",
                               model="m", access_token="", json_mode=True)


def body_of(module, call) -> bytes:
    sink: list = []
    capture_into(module, sink)
    try:
        call()
    except ValueError:
        pass
    if len(sink) != 1:
        raise RuntimeError(f"expected 1 captured request, got {len(sink)}")
    return sink[0]


# ------------------------------------------------------------------------------------ G6
def g6(args) -> int:
    snap = Path(args.snapshot) / "ai.py"
    want = "5319079b1f0b5c64a273368e14cf94e383767ce22478e3b69e94c1e89068fc72"
    got = hashlib.sha256(snap.read_bytes()).hexdigest()
    if got != want:
        return out({"gate": "G6", "ok": False, "error": f"snapshot ai.py sha {got} != 08e32bd {want}"})
    spec = importlib.util.spec_from_file_location("ai_snapshot_08e32bd", snap)
    old = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(old)
    rows = log_rows(args.log)
    if args.rows != "all":
        rows = rows[:int(args.rows)]
    real_root = bookctx.LIBRARY_ROOT
    fault_root = scratch(args.fault_root)
    modes = {
        "env=legacy, index present": ("legacy", real_root, "geron-homl3"),
        "env unset, file absent": ("", fault_root / "absent", "geron-homl3"),
        "env unset, schema_version=2": ("", fault_root / "schema2", "geron-homl3"),
        "env unset, corrupt file": ("", fault_root / "corrupt", "geron-homl3"),
    }
    results, ok = {}, True
    control_index = 0
    for row in rows:
        inp = ask_inputs(row)
        q, term, ch = inp["question"], inp["term"], inp["chapter"]
        excerpts = old.book_search(inp["module_id"], f"{q} {term}", chapter=ch)
        want_body = body_of(old, lambda: old.ask_tutor(FAKE, inp["chapter_title"], term, inp["lesson"], q, [],
                                                        excerpts, visuals=inp["visuals"], images=[]))
        # Control: with the real index and no kill switch the SAME row must take the index path,
        # or this gate would be comparing legacy with legacy by accident.
        os.environ.pop("EDU_ASK_CONTEXT", None)
        bookctx.LIBRARY_ROOT = real_root
        control_index += bookctx.ask_context(inp["module_id"], q, term, ch)[0] == "index"
        for name, (env, root, _id) in modes.items():
            if env:
                os.environ["EDU_ASK_CONTEXT"] = env
            else:
                os.environ.pop("EDU_ASK_CONTEXT", None)
            bookctx.LIBRARY_ROOT = root
            context = bookctx.ask_context(inp["module_id"], q, term, ch)
            lesson = inp["lesson"] + (" " if args.inject_space else "")
            got_body = body_of(ai, lambda: bookctx.tutor_reply(FAKE, context, inp["chapter_title"], term, lesson, q, [],
                                                                inp["visuals"], [], block=inp["block"]))
            entry = results.setdefault(name, {"rows": 0, "equal": 0, "not_legacy": 0, "first_mismatch": None})
            entry["rows"] += 1
            if context[0] != "legacy":
                entry["not_legacy"] += 1
            if got_body == want_body:
                entry["equal"] += 1
            elif entry["first_mismatch"] is None:
                entry["first_mismatch"] = {"at": row.get("at"), "lesson": row.get("lesson"),
                                           "old_len": len(want_body), "new_len": len(got_body)}
    os.environ.pop("EDU_ASK_CONTEXT", None)
    bookctx.LIBRARY_ROOT = real_root
    for entry in results.values():
        ok &= entry["equal"] == entry["rows"] and entry["not_legacy"] == 0
    ok &= control_index == len(rows)
    return out({"gate": "G6", "ok": ok and bool(rows), "rows": len(rows), "snapshot_ai_sha": got,
                "control_index_path_rows": control_index, "modes": results,
                "inject_space": bool(args.inject_space)})


# ------------------------------------------------------------------------------------ G7
def g7(args) -> int:
    rows = log_rows(args.log)
    keys = args.join.split(",")
    problems, overlap, hits_total, resolved = [], [], 0, 0
    for row in rows:
        module = ai.load_module(None, row["module"])
        sections = module["tutorialData"]["sections"]
        ch, term = int(row["chapter"]), row.get("term", "")
        if args.inject_block_shift is not None:
            index = int(row["block"]) - 1 + args.inject_block_shift
            items = sections[ch - 1]["items"]
            found = [(ch, index + 1)] if 0 <= index < len(items) and items[index].get("term", "") == term else []
        elif keys == ["module", "term"]:
            found = [(c, b) for c, s in enumerate(sections, 1) for b, it in enumerate(s["items"], 1)
                     if isinstance(it, dict) and it.get("term", "") == term]
        else:
            found = [(ch, b) for b, it in enumerate(sections[ch - 1]["items"], 1)
                     if isinstance(it, dict) and it.get("term", "") == term]
        if len(found) != 1:
            problems.append({"at": row.get("at"), "lesson": row.get("lesson"), "term": term,
                             "matches": len(found), "why": "ambiguous" if found else "unresolved"})
            continue
        resolved += 1
        _c, block = found[0]
        question = str(row["question"]).strip()
        module_id = store.module_id_for(module)
        context = bookctx.ask_context(module_id, question, term, ch)
        if context[0] != "index":
            problems.append({"at": row.get("at"), "why": "took the legacy path"})
            continue
        chapter_block, hits = context[1], context[2]
        if chapter_block["chapter"] != ch:
            problems.append({"at": row.get("at"), "why": f"chapter block {chapter_block['chapter']} != {ch}"})
        inside = [h for h in hits if h["chapter"] == ch]
        if inside:
            problems.append({"at": row.get("at"), "why": f"{len(inside)} in-chapter hits"})
        hits_total += len(hits)
        legacy = ai.book_search(module_id, f"{question} {term}", chapter=ch)
        conn = bookctx.open_index(module_id)
        first, last = conn.execute("SELECT first_page, last_page FROM chapters WHERE chapter=?", (ch,)).fetchone()
        conn.close()
        covered = {h["page"] for h in hits if h["page"]}
        for e in legacy:
            pdf_page = e["page"] + 1        # legacy labels are the 0-based list index
            overlap.append((first or 0) <= pdf_page <= (last or -1) or pdf_page in covered)
    ok = not problems and resolved == len(rows) and bool(rows)
    return out({"gate": "G7", "ok": ok, "rows": len(rows), "resolved": resolved, "join": args.join,
                "inject_block_shift": args.inject_block_shift, "problems": problems[:40],
                "problem_count": len(problems), "hits_total": hits_total,
                "legacy_excerpt_pages_covered_by_new_context": f"{sum(overlap)}/{len(overlap)}"})


# ------------------------------------------------------------------------------------ G8
def g8(args) -> int:
    root = Path(args.root) if args.root else LIBRARY
    rng = random.Random(args.seed)
    report, ok = {}, True
    for book_id in books(root, args.book):
        sections = module_of(book_id)["tutorialData"]["sections"]
        terms = Counter(it.get("term", "") for s in sections for it in s["items"] if isinstance(it, dict))
        conn = ro(root / book_id / "book-index.sqlite")
        n = len(sections)
        tried = hit = 0
        misses = []
        for c, section in enumerate(sections, 1):
            pool = [it.get("term", "") for it in section["items"] if isinstance(it, dict)
                    and it.get("term") and bookctx.match_query(it["term"])
                    and (not args.unique_terms_only or terms[it["term"]] == 1)]
            for term in rng.sample(pool, min(args.per_chapter, len(pool))):
                current = (c % n) + 1
                found = bookctx.search_other(conn, term, current)
                tried += 1
                if any(h["chapter"] == c for h in found):
                    hit += 1
                else:
                    misses.append({"chapter": c, "term": term, "got": [h["label"] for h in found]})
        conn.close()
        rate = hit / tried if tried else 0.0
        report[book_id] = {"tried": tried, "hit": hit, "hit_at_4": round(rate, 3), "misses": misses[:10]}
        ok &= rate >= 0.9
    return out({"gate": "G8", "ok": ok and bool(report), "root": str(root), "books": report})


# ------------------------------------------------------------------------------------ G11
HOSTILE = ['"', "NEAR(a b", "*", "-x AND OR", "a' OR 1=1 --", "!@#$%^&*()[]{};:,.<>/?\\|`~" * 23,
           "the and of is it this that what why how", "", "   ", "é ü 漢字 🙂", 'gradient" OR "x']


def g11(args) -> int:
    book = "geron-homl3"
    problems, raw_errors = [], 0
    for text in HOSTILE:
        if args.raw_match:
            conn = bookctx.open_index(book)
            try:
                conn.execute("SELECT count(*) FROM docs_fts WHERE docs_fts MATCH ?", (text,)).fetchall()
            except sqlite3.Error:
                raw_errors += 1
            finally:
                conn.close()
            continue
        try:
            conn = bookctx.open_index(book)
            found = bookctx.search_other(conn, text, 4)
            conn.close()
            if not isinstance(found, list):
                problems.append({"input": text[:30], "why": "not a list"})
            mode = bookctx.ask_context(book, text, "", 4)[0]
            if mode != "index":
                problems.append({"input": text[:30], "why": f"fell back to {mode}"})
        except Exception as error:  # noqa: BLE001
            problems.append({"input": text[:30], "error": f"{type(error).__name__}: {error}"})
    if args.raw_match:
        return out({"gate": "G11-fault", "ok": raw_errors == 0, "raw_inputs_that_raised": raw_errors,
                    "note": "fault-proof: raw text in MATCH must raise, so ok=false is the expected red"})
    return out({"gate": "G11", "ok": not problems, "inputs": len(HOSTILE), "problems": problems})


# ------------------------------------------------------------------------------------ live helpers
class Recorder:
    """urlopen wrapper: records the exact body and the raw stream, then really sends it."""

    def __init__(self, real):
        self.real, self.bodies, self.raws = real, [], []

    def __call__(self, request, timeout=None):
        self.bodies.append(request.data)
        if self.dry:
            raise URLError("dry run")
        response = self.real(request, timeout=timeout)
        recorder = self

        class Proxy:
            headers = response.headers

            def read(self_inner):
                raw = response.read()
                recorder.raws.append(raw)
                return raw

            def __enter__(self_inner):
                return self_inner

            def __exit__(self_inner, *exc):
                response.close()
                return False
        return Proxy()

    dry = False


def usage_of(raw: bytes) -> dict | None:
    found = None
    for line in raw.decode("utf-8", "replace").splitlines():
        line = line.strip()
        if line.startswith("data:") and '"usage"' in line:
            try:
                value = json.loads(line[5:]).get("usage")
            except ValueError:
                continue
            if value:
                found = value
    return found


def lesson_row(module_id: str, chapter: int) -> dict:
    module = ai.load_module(None, module_id)
    item = module["tutorialData"]["sections"][chapter - 1]["items"][0]
    return {"module": module_id, "chapter": chapter, "block": 1, "term": item.get("term", "")}


def live_config(combo: str):
    config = settings.provider_config()
    if config is None:
        sys.exit("no provider configured (provider.env) -- nothing sent")
    return dataclasses.replace(config, model=combo)


# ------------------------------------------------------------------------------------ G5
def g5(args) -> int:
    if args.cap_tokens:
        bookctx.CHAPTER_CAP_TOKENS = args.cap_tokens
    recorder = Recorder(ai.urlopen)
    recorder.dry = args.dry_run
    ai.urlopen = recorder
    rows, problems = [], []
    for combo in args.combos.split(","):
        config = FAKE if args.dry_run else live_config(combo)
        for chapter in [int(c) for c in args.chapters.split(",")]:
            inp = ask_inputs({**lesson_row("geron-homl3", chapter), "question": args.question})
            for mode in ("legacy", "index"):
                if mode == "legacy":
                    context = ("legacy", ai.book_search(inp["module_id"], f"{args.question} {inp['term']}", chapter=chapter))
                else:
                    context = bookctx.ask_context(inp["module_id"], args.question, inp["term"], chapter)
                    if context[0] != "index":
                        problems.append(f"ch{chapter}: index path not taken")
                        continue
                start = time.monotonic()
                answer, error = "", None
                try:
                    reply = bookctx.tutor_reply(config, context, inp["chapter_title"], inp["term"], inp["lesson"],
                                                args.question, [], inp["visuals"], [], block=inp["block"])
                    answer = reply.get("answer") or ""
                except ValueError as exc:
                    error = str(exc)
                wall = round(time.monotonic() - start, 2)
                body = recorder.bodies[-1]
                tokens = len(body.decode("utf-8")) // 4
                usage = usage_of(recorder.raws[-1]) if (recorder.raws and not args.dry_run) else None
                trimmed = "CHAPTER (TRIMMED" in body.decode("utf-8")
                rows.append({"combo": combo, "chapter": chapter, "mode": mode, "prompt_tokens_est": tokens,
                             "router_usage": usage or "n/a", "wall_s": wall, "answer_chars": len(answer),
                             "error": error, "trimmed": trimmed,
                             "chapter_tokens": context[1]["tokens"] if mode == "index" else 0})
                if mode == "index" and tokens > args.max_prompt_tokens:
                    problems.append(f"{combo} ch{chapter}: index prompt {tokens} tok > {args.max_prompt_tokens}")
                if not args.dry_run and (error or not answer.strip()):
                    problems.append(f"{combo} ch{chapter} {mode}: {error or 'empty answer'}")
    for row in rows:
        if row["mode"] == "index":
            base = next(r for r in rows if r["mode"] == "legacy" and r["combo"] == row["combo"] and r["chapter"] == row["chapter"])
            row["multiplier"] = round(row["prompt_tokens_est"] / max(base["prompt_tokens_est"], 1), 1)
    index_walls = [r["wall_s"] for r in rows if r["mode"] == "index"]
    p50 = statistics.median(index_walls) if index_walls else 0
    if not args.dry_run and p50 > 60:
        problems.append(f"index p50 wall {p50}s > 60s")
    asks = log_rows(args.rate_log)
    days = Counter(str(r.get("at", ""))[:10] for r in asks)
    per_day = {"mean": round(len(asks) / max(len(days), 1), 1), "peak": max(days.values()) if days else 0}
    mean_legacy = statistics.mean(r["prompt_tokens_est"] for r in rows if r["mode"] == "legacy") if rows else 0
    mean_index = statistics.mean(r["prompt_tokens_est"] for r in rows if r["mode"] == "index") if index_walls else 0
    projection = {k: {"legacy_tok_per_day": round(v * mean_legacy), "index_tok_per_day": round(v * mean_index)}
                  for k, v in per_day.items()}
    return out({"gate": "G5", "ok": not problems, "dry_run": args.dry_run, "rows": rows, "index_p50_wall_s": p50,
                "asks_logged": len(asks), "days": len(days), "asks_per_day": per_day, "projection": projection,
                "problems": problems, "cap_tokens": bookctx.CHAPTER_CAP_TOKENS,
                "trimmed_seen": any(r["trimmed"] for r in rows)})


# ------------------------------------------------------------------------------------ G9
def g9(args) -> int:
    if args.strip_labels:
        bookctx.label = lambda *a, **k: ""
    recorder = Recorder(ai.urlopen)
    ai.urlopen = recorder
    config = live_config(args.combo)
    rows = [r for r in log_rows(args.log) if 30 <= len(str(r["question"])) <= 400
            and "Traceback" not in r["question"] and "Error" not in r["question"]]
    seen, picked = set(), []
    for row in random.Random(30926).sample(rows, len(rows)):
        if row["question"] in seen:
            continue
        seen.add(row["question"])
        picked.append(row)
        if len(picked) == args.n:
            break
    results, cited, fabricated = [], 0, 0
    for row in picked:
        inp = ask_inputs(row)
        os.environ.pop("EDU_ASK_CONTEXT", None)          # --force-index: harness-only, production env untouched
        context = bookctx.ask_context(inp["module_id"], inp["question"], inp["term"], inp["chapter"])
        if context[0] != "index":
            results.append({"lesson": row.get("lesson"), "error": "legacy path"})
            continue
        try:
            reply = bookctx.tutor_reply(config, context, inp["chapter_title"], inp["term"], inp["lesson"],
                                        inp["question"], [], inp["visuals"], [], block=inp["block"])
        except ValueError as error:
            results.append({"lesson": row.get("lesson"), "error": str(error)})
            continue
        sent = recorder.bodies[-1].decode("utf-8")
        sent_pages = {(int(a), int(b)) for a, b in re.findall(r"\[ch(\d+), p\.(\d+)\]", sent)}
        sent_lessons = {(int(a), int(b)) for a, b in re.findall(r"\[ch(\d+), lesson (\d+)", sent)}
        answer = reply.get("answer") or ""
        pages = {(int(a), int(b)) for a, b in CITE.findall(answer)}
        lessons = {(int(a), int(b)) for a, b in CITE_LESSON.findall(answer)}
        bad = sorted((pages - sent_pages) | (lessons - sent_lessons))
        has = bool(pages or lessons)
        cited += has
        fabricated += bool(bad)
        results.append({"lesson": row.get("lesson"), "source": reply.get("source"), "page": reply.get("page"),
                        "cited": sorted(pages | lessons)[:6], "fabricated": bad, "answer_head": answer[:160]})
    ok = cited >= args.n - 2 and fabricated == 0 and len(picked) == args.n
    return out({"gate": "G9", "ok": ok, "n": len(picked), "cited": cited, "fabricated": fabricated,
                "strip_labels": bool(args.strip_labels), "results": results})


def main() -> int:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="gate", required=True)
    p = sub.add_parser("completeness"); p.add_argument("--all", action="store_true"); p.add_argument("--book"); p.add_argument("--root")
    p = sub.add_parser("dumpsha"); p.add_argument("--all", action="store_true"); p.add_argument("--book"); p.add_argument("--root")
    p = sub.add_parser("make-fault"); p.add_argument("--kind", required=True); p.add_argument("--book", default="geron-homl3"); p.add_argument("--dest", required=True)
    p = sub.add_parser("legacy-identity"); p.add_argument("--snapshot", required=True); p.add_argument("--rows", default="all")
    p.add_argument("--log", default=str(settings.store_path("EDU_PROGRESS_PATH").parent / "logs" / "ask.jsonl"))
    p.add_argument("--fault-root", default="/var/tmp/tbi/g6"); p.add_argument("--inject-space", action="store_true")
    p = sub.add_parser("replay"); p.add_argument("--log", required=True); p.add_argument("--join", default="module,chapter,term")
    p.add_argument("--inject-block-shift", type=int)
    p = sub.add_parser("crosschapter"); p.add_argument("--all", action="store_true"); p.add_argument("--book"); p.add_argument("--root")
    p.add_argument("--per-chapter", type=int, default=3); p.add_argument("--seed", type=int, default=30926); p.add_argument("--unique-terms-only", action="store_true")
    p = sub.add_parser("fts-fault"); p.add_argument("--raw-match", action="store_true")
    p = sub.add_parser("cost"); p.add_argument("--chapters", required=True); p.add_argument("--combos", required=True)
    p.add_argument("--question", required=True); p.add_argument("--rate-log", required=True); p.add_argument("--dry-run", action="store_true")
    p.add_argument("--cap-tokens", type=int); p.add_argument("--max-prompt-tokens", type=int, default=56_000)
    p = sub.add_parser("cite"); p.add_argument("--n", type=int, default=10); p.add_argument("--combo", required=True)
    p.add_argument("--force-index", action="store_true"); p.add_argument("--strip-labels", action="store_true")
    p.add_argument("--log", default=str(settings.store_path("EDU_PROGRESS_PATH").parent / "logs" / "ask.jsonl"))
    args = parser.parse_args()
    return {"completeness": g2, "dumpsha": g3, "make-fault": make_fault, "legacy-identity": g6, "replay": g7,
            "crosschapter": g8, "fts-fault": g11, "cost": g5, "cite": g9}[args.gate](args)


if __name__ == "__main__":
    sys.exit(main())
