#!/usr/bin/env python3
"""exam_fixture.py — gate-only books for the timed mock exam (exam-recall-suite P3c, 22-10-26).

Two tiny packaged books, written under /var/tmp at run time (never the real library on nn):
  gate-exam-book    8 chapters x 13 questions = 104, WITH an `exam` block:
                    GATE-CLF · 65 q · 90 min · scale [100, 1000] · passScaled 700 ·
                    D1 24 (ch1-2) · D2 30 (ch3-4) · D3 34 (ch5-6) · D4 12 (ch7-8)
                    -> largest remainder 65 x 24/30/34/12 = 16/19/22/8. Two choose-N questions in ch1.
  gate-noexam-book  5 chapters x 6 questions = 30, NO exam block -> "Practice exam": editable defaults
                    min(40, 30) = 30 q / 60 min, chapter mix, no scaled score, no pass/fail.
The right answer of every question is `correct_of(key)`, so a gate can answer right or wrong on purpose.

Used by gates/gate-exam-backend.py (import: books(), write_library()) and gates/gate-exam.mjs, which
runs `serve`: stage a local preview = a COPY of the backend + a built dist/ under --work, migrate the
ISOLATED gate DB (edu_study_gate, via ~/.config/foxai/edu-study-gate-db.env; never edu_study), create one
throwaway account + a session, print `READY {json}`, run uvicorn until SIGTERM/stdin EOF, then delete the
account (ON DELETE CASCADE) and close the tunnel it opened.

  /var/tmp/edu-study-testvenv/bin/python3 gates/stubs/exam_fixture.py library /var/tmp/x
  /var/tmp/edu-study-testvenv/bin/python3 gates/stubs/exam_fixture.py serve --port 8788 --web app/frontend/dist
"""
from __future__ import annotations

import argparse, json, os, re, secrets, shutil, signal, socket, subprocess, sys, time
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent.parent
EXAM_BOOK, NOEXAM_BOOK = "gate-exam-book", "gate-noexam-book"
EXAM_BLOCK = {
    "name": "GATE-CLF", "questions": 65, "minutes": 90, "scale": [100, 1000], "passScaled": 700,
    "domains": [
        {"id": "D1", "name": "Cloud Concepts", "weight": 24, "chapterIds": [1, 2]},
        {"id": "D2", "name": "Security and Compliance", "weight": 30, "chapterIds": [3, 4]},
        {"id": "D3", "name": "Cloud Technology and Services", "weight": 34, "chapterIds": [5, 6]},
        {"id": "D4", "name": "Billing, Pricing, and Support", "weight": 12, "chapterIds": [7, 8]},
    ],
}
CHOOSE_N = {"ch01-b01-q1": [0, 2], "ch01-b01-q2": [1, 3]}       # 5 options, pick 2


def correct_of(key: str):
    """The fixture's right answer for a question key (a list = choose-N)."""
    if key in CHOOSE_N:
        return list(CHOOSE_N[key])
    return int(re.search(r"q(\d+)$", key).group(1)) % 4


def _book(module_id: str, title: str, chapters: int, per_chapter: int, exam: dict | None) -> dict:
    sections, quiz = [], []
    for c in range(1, chapters + 1):
        sections.append({"title": f"Chapter {c}: Gate topic {c}", "items": [
            {"term": f"Gate lesson {c}.1", "blocks": [{"type": "text", "content": f"Gate lesson text for chapter {c}."}]}]})
        for i in range(1, per_chapter + 1):
            key = f"ch{c:02d}-b01-q{i}"
            n_opts = 5 if key in CHOOSE_N else 4
            quiz.append({
                "question": f"Gate exam question {c}.{i} ({key}): which option is right?",
                "options": [f"Option {chr(65 + o)} of {c}.{i}" for o in range(n_opts)],
                "correct": correct_of(key),
                "explanations": [f"Explanation {o}" for o in range(n_opts)],
                "source": {"chapter": c, "block": f"ch{c:02d}-b01", "question": key},
            })
    data = {"moduleId": module_id, "tutorialData": {"title": title, "sections": sections}, "quizData": quiz}
    if exam is not None:
        data["exam"] = exam
    return data


def books() -> dict[str, dict]:
    return {EXAM_BOOK: _book(EXAM_BOOK, "Gate exam book", 8, 13, EXAM_BLOCK),
            NOEXAM_BOOK: _book(NOEXAM_BOOK, "Gate practice book", 5, 6, None)}


def write_library(root: Path) -> Path:
    for mid, data in books().items():
        (root / mid).mkdir(parents=True, exist_ok=True)
        (root / mid / "module.json").write_text(json.dumps(data), encoding="utf-8")
    return root


# --------------------------------------------------------------------------- serve (local staged preview)
def serve(args: argparse.Namespace) -> int:
    env_path = Path(os.environ.get("EX_GATE_DB_ENV") or Path.home() / ".config/foxai/edu-study-gate-db.env")
    env_text = env_path.read_text(encoding="utf-8")
    if "EDU_DB_NAME=edu_study_gate" not in env_text.splitlines():
        print("REFUSED: the DB env does not point at edu_study_gate", file=sys.stderr)
        return 2
    db_port = int(re.search(r"^EDU_DB_PORT=(\d+)", env_text, re.M).group(1))
    work = Path(args.work)
    backend_src = Path(args.backend).resolve()
    web_src = Path(args.web).resolve()
    if not (web_src / "index.html").is_file():
        print(f"REFUSED: no built index.html in {web_src}", file=sys.stderr)
        return 2
    for name in ("backend", "web"):
        shutil.rmtree(work / name, ignore_errors=True)
    shutil.copytree(backend_src, work / "backend", ignore=shutil.ignore_patterns("__pycache__", "*.pyc"))
    shutil.copytree(web_src, work / "web")
    write_library(work / "lib")
    (work / "settings.json").write_text('{"ai_question_count":5,"fresh_quiz_size":20,"require_access_token":false}\n')
    (work / "progress.json").write_text('{"version":2,"modules":{}}\n')
    run_env = {**os.environ, "EDU_DB_ENV_PATH": str(env_path), "EDU_LIBRARY_ROOT": str(work / "lib"),
               "EDU_SETTINGS_PATH": str(work / "settings.json"), "EDU_PROGRESS_PATH": str(work / "progress.json"),
               "EDU_LIBRARY_META_PATH": str(work / "library-meta.json"), "EDU_BOOK_ROOT": str(work / "books"),
               "EDU_ENV_PATH": str(work / "provider.env"), "EDU_ASSET_ROOT": str(work / "assets")}
    bdir = work / "backend"
    open_port = lambda p: socket.socket().connect_ex(("127.0.0.1", p)) == 0
    tunnel = None
    if not open_port(db_port):
        tunnel = subprocess.Popen(["ssh", "-N", "-o", "ExitOnForwardFailure=yes", "-L", f"127.0.0.1:{db_port}:127.0.0.1:5432", "nn"])
        for _ in range(160):        # ssh to nn over the VPN can take several seconds
            if open_port(db_port):
                break
            time.sleep(0.25)
    admin = lambda *a, stdin=None: subprocess.run([sys.executable, "-m", "admin", *a], cwd=bdir, env=run_env, input=stdin,
                                                  capture_output=True, text=True)
    user = f"gate-ex-{secrets.token_hex(3)}"
    server = None
    try:
        for _ in range(5):          # the forwarded port can accept before the DB answers
            mig = admin("migrate", "--no-backup")
            if mig.returncode == 0:
                break
            time.sleep(2)
        made = admin("create-user", "--username", user, "--display-name", "Gate Exam", stdin=secrets.token_urlsafe(18) + "\n")
        token = admin("mint-session", "--username", user, "--ttl", "5400").stdout.strip()
        if mig.returncode or made.returncode or len(token) < 20:
            print("STAGE FAILED", mig.stdout, mig.stderr, made.stdout, made.stderr, file=sys.stderr)
            return 1
        log = open(args.log, "w")
        server = subprocess.Popen([sys.executable, "-m", "uvicorn", "main:app", "--host", "127.0.0.1", "--port", str(args.port)],
                                  cwd=bdir, env=run_env, stdout=log, stderr=subprocess.STDOUT)
        for _ in range(80):
            if open_port(args.port):
                break
            time.sleep(0.25)
        print("READY " + json.dumps({"base": f"http://127.0.0.1:{args.port}", "token": token, "user": user,
                                     "migrate": mig.stdout.strip().splitlines()[-1:], "log": args.log}), flush=True)
        stop = {"now": False}
        signal.signal(signal.SIGTERM, lambda *_: stop.update(now=True))
        # stdin EOF (the node parent died or closed it) also stops the stage.
        while not stop["now"] and server.poll() is None:
            if not sys.stdin.readline():
                break
        return 0
    finally:
        if server is not None:
            server.terminate()
            server.wait(timeout=10)
        gone = admin("delete-user", "--username", user, "--yes")
        print(f"CLEANUP {user}: {(gone.stdout + gone.stderr).strip()[:120]}", file=sys.stderr, flush=True)
        if tunnel is not None:
            tunnel.terminate()
            tunnel.wait(timeout=10)


def main() -> int:
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    lib = sub.add_parser("library")
    lib.add_argument("root")
    sv = sub.add_parser("serve")
    sv.add_argument("--port", type=int, default=8788)
    sv.add_argument("--web", default=str(REPO / "app" / "frontend" / "dist"))
    sv.add_argument("--backend", default=str(REPO / "app" / "backend"))
    sv.add_argument("--work", default="/var/tmp/p3c-exam-stage")
    sv.add_argument("--log", default="/var/tmp/p3c-exam-uvicorn.log")
    args = ap.parse_args()
    if args.cmd == "library":
        print(write_library(Path(args.root)))
        return 0
    return serve(args)


if __name__ == "__main__":
    sys.exit(main())
