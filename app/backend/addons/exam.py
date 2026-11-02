"""Timed mock exam add-on API — exam-recall-suite P3a (22-10-26). Migration 007_exam_runs.sql.

WIRE CONTRACT (stable; P3b builds on it). All routes signed-in (no session -> 401 from the middleware).
JSON in, JSON out. Times are ISO-8601 UTC with offset ("2026-10-22T08:00:00+00:00").

  GET  /api/exam/open?module=<id>
       -> 200 {module, preview: Preview, run: Run|null, last: Result|null, expiredNow: bool}
          run        = the open run of this account x book (null = none). A run found past its deadline is
                       finished BY THIS READ (finishedBy "deadline"), then run = null, expiredNow = true and
                       last = its result.
          last       = the newest finished run of this book (null = never finished one).
       -> 400 unknown book
  POST /api/exam/start   {module, questions?: int, minutes?: int, restart?: bool}
       -> 201 {run: Run, resumed: false, previous: Result|null}   a new run
       -> 200 {run: Run, resumed: true,  previous: null}          the open run, unchanged (reload / 2nd Start)
          restart=true finishes the open run first (finishedBy "restart") and returns it as `previous`; an
          open run past its deadline is always finished first (finishedBy "deadline") -> `previous`.
          questions/minutes: used ONLY when the book has no valid exam block (Preview.isDefault = true);
          1..Preview.maxQuestions and 1..Preview.maxMinutes; omitted -> Preview.questions / Preview.minutes.
          With a valid exam block they are ignored (the block's numbers are the exam's).
       -> 400 bad module/numbers, or a book with no usable questions
  POST /api/exam/answer  {runId, question: "<key>", chosen: int | int[] | null}
          chosen: one option position (single-answer question) · a list of distinct positions (choose-N,
          Run.questions[i].choose > 1; graded as an EXACT set) · null = clear the answer.
       -> 200 {runId, question, chosen, answeredCount, remainingSeconds}
       -> 409 {error, code: "deadline", result: Result}   at/after deadline: NOT saved; the run is finished now
       -> 409 {error, code: "finished", result: Result}   the run was already finished
       -> 400 question not in this run / chosen shape wrong · 404 {error} no such run for this account
  POST /api/exam/flag    {runId, question: "<key>", flagged: bool}
          also sets/clears the learner's normal flag (question_flags = the P1 "Flagged (N)" list).
       -> 200 {runId, question, flagged, flags: ["<key>", ...]}
       -> 409 / 400 / 404 exactly as /api/exam/answer
  POST /api/exam/finish  {runId}
       -> 200 {result: Result, alreadyFinished: bool}       a retried Submit returns the same result
       -> 404 {error}
  Every POST: 403 cross-origin (core._gate) · 429 rate limit (bucket "exam") · 400 body > 8 KB / not JSON.
  503 {error} = the account store is unreachable.

  Preview = {mode: "exam"|"practice", name: str|null, questions: int, minutes: int,
             isDefault: bool,              true = questions/minutes are editable UI defaults (no exam block),
                                           NOT exam facts; false = from the book's exam block
             poolSize: int, maxQuestions: int|null, maxMinutes: int|null   (null when isDefault = false)
             areaKind: "domain"|"chapter", areas: [{id, name, available, weight?}],
             scaled: {passScaled, scaleMin, scaleMax}|null}   null = no scaled score will be shown
  Run     = {id, module, status: "open", mode, name, startedAt, deadlineAt, serverNow, remainingSeconds,
             minutes, total, areaKind,
             questions: [{n, key, chapter, area, choose}],   key = the book question's source.question;
                                                             choose = how many options to pick (1 = single)
             answers: {"<key>": int | int[]}, answeredCount, flags: ["<key>"]}
             The client renders each question from its own copy of the book (quizData, by source.question).
             Timer: count down remainingSeconds from the moment the response arrived (or deadlineAt vs
             serverNow) — never from the device clock alone.
  Result  = {id, module, status: "finished", mode, name, startedAt, deadlineAt, finishedAt,
             finishedBy: "submit"|"deadline"|"restart", areaKind,
             total, right, answered, unanswered, rawPct,           raw = right / total; unanswered = wrong
             areas: [{id, name, total, right, pct}],                per area (domain, else chapter)
             scaled: {estimate, scaleMin, scaleMax, passScaled, passedEstimate, method}|null,
             scaledIsEstimate: bool,                                true whenever scaled is not null
             questions: [{n, key, chapter, area, chosen, correct, right, flagged}]}
             scaled is null for a book without an exam block (or a block without passScaled): show raw
             right/total and the per-area % only — no scaled score, no pass/fail.

Rules (pick, clock, grading, estimate): addons/exam_blueprint.py. SQL: store.py P3 block.
⛔ The account is ALWAYS the session's (req.account / core._account), never a body field; a run id of another
   account answers 404. Questions are picked here from the book (ai.load_module) — never from the client.
⛔ `import main as core` and core.X at CALL time (the qna/rooms/study_more add-on rule).
⚠ GET /api/exam/open may WRITE (it closes an expired run). That is the "first read past the deadline" rule;
   a cross-site GET can at most close a run that is already over.
"""
from __future__ import annotations

import json
import random
import time
import uuid
from collections import defaultdict, deque
from datetime import datetime, timezone
from http import HTTPStatus
from typing import Any

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import JSONResponse, Response

import ai
import db
import main as core
import store
from addons import exam_blueprint as rules

router = APIRouter()

core.RATE["exam"] = (1200, 600)      # one call per answer / flag change; a 65-question exam stays far under
core._BUCKETS["exam"] = defaultdict(deque)
MAX_EXAM_BYTES = 8 * 1024
_RNG = random.SystemRandom()
_BAD = (ValueError, TypeError, json.JSONDecodeError)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _limited(req: core.Posted) -> JSONResponse | None:
    blocked = core._gate(req)
    if blocked:
        return blocked
    moment = time.monotonic()
    with core._BUCKET_LOCK:
        recent = core._bucket_prune("exam", req.client, moment)
        if len(recent) >= core.RATE["exam"][0]:
            return core._json(HTTPStatus.TOO_MANY_REQUESTS, {"error": "Too many exam calls just now."})
        recent.append(moment)
    return None


def _run_id(payload: dict[str, Any]) -> str:
    try:
        return str(uuid.UUID(str(payload.get("runId") or "")))
    except ValueError:
        raise ValueError("runId must be the id of an exam run.") from None


def _closed(outcome: str, row: dict[str, Any]) -> Response:
    if outcome == "late":
        return core._json(HTTPStatus.CONFLICT, {"error": "Time is up — the exam was submitted.", "code": "deadline",
                                                "result": rules.result_view(row)})
    return core._json(HTTPStatus.CONFLICT, {"error": "This exam is already finished.", "code": "finished",
                                            "result": rules.result_view(row)})


def _error(error: Exception) -> Response:
    if isinstance(error, db.StoreUnavailable):
        return core._json(HTTPStatus.SERVICE_UNAVAILABLE, {"error": str(error)})
    if isinstance(error, store.ExamNotFound):
        return core._json(HTTPStatus.NOT_FOUND, {"error": str(error)})
    return core._json(HTTPStatus.BAD_REQUEST, {"error": str(error)})


@router.get("/api/exam/open")
def exam_open(request: Request, module: str = Query(default="")) -> Response:
    key = store.module_key(module)
    try:
        preview = rules.preview(ai.load_module(None, key))
        now = _now()
        found = store.exam_open(core._account(request).id, key, now, rules)
    except (db.StoreUnavailable, ValueError, TypeError) as error:
        return _error(error)
    return core._json(HTTPStatus.OK, {
        "module": key, "preview": preview,
        "run": rules.run_view(found["run"], now) if found["run"] else None,
        "last": rules.result_view(found["last"]) if found["last"] else None,
        "expiredNow": found["expiredNow"]})


@router.post("/api/exam/start")
def exam_start(req: core.Posted = Depends(core.posted)) -> Response:
    blocked = _limited(req)
    if blocked:
        return blocked
    try:
        payload = req.read_json(MAX_EXAM_BYTES)
        key = store.module_key(payload.get("module"))
        restart = payload.get("restart", False)
        if not isinstance(restart, bool):
            raise ValueError("restart must be true or false.")
        data = ai.load_module(None, key)
        plan = rules.plan_run(data, payload.get("questions"), payload.get("minutes"))   # validate before any write
        now = _now()
        outcome, row, previous = store.exam_start(req.account.id, key, now, restart,
                                                  lambda: rules.build_run(plan, _RNG), rules)
    except (db.StoreUnavailable, *_BAD) as error:
        return _error(error)
    return core._json(HTTPStatus.CREATED if outcome == "created" else HTTPStatus.OK, {
        "run": rules.run_view(row, now), "resumed": outcome == "resumed",
        "previous": rules.result_view(previous) if previous else None})


@router.post("/api/exam/answer")
def exam_answer(req: core.Posted = Depends(core.posted)) -> Response:
    blocked = _limited(req)
    if blocked:
        return blocked
    try:
        payload = req.read_json(MAX_EXAM_BYTES)
        run_id, qkey = _run_id(payload), store.review_key(payload.get("question"))
        if "chosen" not in payload:
            raise ValueError("send chosen (null clears the answer).")
        now = _now()
        outcome, row = store.exam_answer(req.account.id, run_id, qkey, payload["chosen"], now, rules)
    except (db.StoreUnavailable, store.ExamNotFound, *_BAD) as error:
        return _error(error)
    if outcome != "ok":
        return _closed(outcome, row)
    view = rules.run_view(row, now)
    return core._json(HTTPStatus.OK, {"runId": run_id, "question": qkey, "chosen": view["answers"].get(qkey),
                                      "answeredCount": view["answeredCount"],
                                      "remainingSeconds": view["remainingSeconds"]})


@router.post("/api/exam/flag")
def exam_flag(req: core.Posted = Depends(core.posted)) -> Response:
    blocked = _limited(req)
    if blocked:
        return blocked
    try:
        payload = req.read_json(MAX_EXAM_BYTES)
        run_id, qkey = _run_id(payload), store.review_key(payload.get("question"))
        if not isinstance(payload.get("flagged"), bool):
            raise ValueError("flagged must be true or false.")
        outcome, row = store.exam_flag(req.account.id, run_id, qkey, payload["flagged"], _now(), rules)
    except (db.StoreUnavailable, store.ExamNotFound, *_BAD) as error:
        return _error(error)
    if outcome != "ok":
        return _closed(outcome, row)
    return core._json(HTTPStatus.OK, {"runId": run_id, "question": qkey, "flagged": payload["flagged"],
                                      "flags": list(row["flags"] or [])})


@router.post("/api/exam/finish")
def exam_finish(req: core.Posted = Depends(core.posted)) -> Response:
    blocked = _limited(req)
    if blocked:
        return blocked
    try:
        payload = req.read_json(MAX_EXAM_BYTES)
        outcome, row = store.exam_finish(req.account.id, _run_id(payload), _now(), rules)
    except (db.StoreUnavailable, store.ExamNotFound, *_BAD) as error:
        return _error(error)
    return core._json(HTTPStatus.OK, {"result": rules.result_view(row), "alreadyFinished": outcome == "already"})
