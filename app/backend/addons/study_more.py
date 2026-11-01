"""Study-more add-on API — exam-recall-suite P1 (22-10-26): review stats, study prefs, flags, answer log.

  GET  /api/review/stats?module=     -> {dueNow, dueToday, next7[{day,count}], next7Total, total, leeches,
                                         leechKeys[], newToday, newPerDay, sessionSize, retention|null,
                                         reviews30, retentionDays}
  GET  /api/review/due-blocks?module=            -> {blocks[{block, due}], dueCount, total}   (01-11-26)
  GET  /api/review/due-in?module=&blocks=&limit= -> {due[...], dueCount}  /api/review/due for some blocks
  GET  /api/study/prefs?module=      -> {module, newPerDay, sessionSize}             (defaults 20 / 20)
  POST /api/study/prefs  {module, newPerDay?, sessionSize?}     -> same shape   (0-200 · 10-50 step 5)
  GET  /api/flags?module=            -> {module, flags[{question, flaggedAt, body?}], count}
  POST /api/flags        {module, question | body, flagged: bool}   -> {question, flagged}
  POST /api/answers      {module, question | body, runKind, correct, clientId,
                          confidence?, chosen?, chapter?, domain?, runId?}         -> {outcome, question}
                                                                    outcome = logged | duplicate

A book question is named by its key (`question`: "ch03-b05-q2"). An AI-written question has no key, so
the client sends its `body` ({question, options, correct, explanations?}) and the SERVER derives the key
(store.ai_review_key: "ai-" + 12 hex of sha1) — a client-sent key is ignored when a body is present.

⛔ Signed-in: the session middleware refuses every non-public route before it reaches here; the account is
   ALWAYS the session's (`req.account` / core._account), never a field of the body.
⛔ Every POST goes through core._gate (same-origin, 403) then the `study` rate bucket (429), like
   /api/review/*. Bodies are capped (12 KB) before parsing.
⛔ `import main as core` and core.X at CALL time, except the names defined above main.py's include point
   (RATE, _BUCKETS, posted, Posted) — the qna/rooms add-on rule.
"""
from __future__ import annotations

import json
import time
from collections import defaultdict, deque
from http import HTTPStatus

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import JSONResponse, Response

import db
import main as core
import store

# No prefix: the routes span /api/review, /api/study, /api/flags and /api/answers (gate-routes reads the
# full path from each decorator when there is no prefix).
router = APIRouter()

# BOTH lines — _BUCKETS is built from RATE once in main.py; RATE alone -> KeyError 500 (qna.py V2 note).
core.RATE["study"] = (1200, 600)     # generous: one flag/answer call per answered question
core._BUCKETS["study"] = defaultdict(deque)
MAX_STUDY_BYTES = 4 * 1024 + store.MAX_BODY_BYTES


def _limited(req: core.Posted) -> JSONResponse | None:
    blocked = core._gate(req)
    if blocked:
        return blocked
    moment = time.monotonic()
    with core._BUCKET_LOCK:
        recent = core._bucket_prune("study", req.client, moment)
        if len(recent) >= core.RATE["study"][0]:
            return core._json(HTTPStatus.TOO_MANY_REQUESTS, {"error": "Too many study calls just now."})
        recent.append(moment)
    return None


def _store_error(error: Exception) -> JSONResponse:
    if isinstance(error, db.StoreUnavailable):
        return core._json(HTTPStatus.SERVICE_UNAVAILABLE, {"error": str(error)})
    return core._json(HTTPStatus.BAD_REQUEST, {"error": str(error)})


_BAD = (db.StoreUnavailable, ValueError, TypeError, json.JSONDecodeError)


@router.get("/api/review/stats")
def study_review_stats(request: Request, module: str = Query(default="")) -> Response:
    try:
        return core._json(HTTPStatus.OK, store.review_stats(core._account(request).id, store.module_key(module)))
    except db.StoreUnavailable as error:
        return _store_error(error)


@router.get("/api/review/due-blocks")
def study_review_due_blocks(request: Request, module: str = Query(default="")) -> Response:
    """01-11-26 review reminder: cards due now per block (the client groups blocks into chapters)."""
    try:
        return core._json(HTTPStatus.OK, store.review_due_by_block(core._account(request).id, store.module_key(module)))
    except db.StoreUnavailable as error:
        return _store_error(error)


@router.get("/api/review/due-in")
def study_review_due_in(request: Request, module: str = Query(default=""), blocks: str = Query(default=""),
                        limit: int = Query(default=store.SESSION_SIZE_DEFAULT)) -> Response:
    """01-11-26 review reminder: the due cards of one chapter's blocks — /api/review/due's shape."""
    try:
        return core._json(HTTPStatus.OK, store.review_due_in_blocks(
            core._account(request).id, store.module_key(module), store.review_blocks(blocks), limit))
    except _BAD as error:
        return _store_error(error)


@router.get("/api/study/prefs")
def study_prefs_get(request: Request, module: str = Query(default="")) -> Response:
    key = store.module_key(module)
    try:
        return core._json(HTTPStatus.OK, {"module": key, **store.read_prefs(core._account(request).id, key)})
    except db.StoreUnavailable as error:
        return _store_error(error)


@router.post("/api/study/prefs")
def study_prefs_save(req: core.Posted = Depends(core.posted)) -> Response:
    blocked = _limited(req)
    if blocked:
        return blocked
    try:
        payload = req.read_json(MAX_STUDY_BYTES)
        key = store.module_key(payload.get("module"))
        prefs = store.save_prefs(req.account.id, key, store.prefs_update(payload))
    except _BAD as error:
        return _store_error(error)
    return core._json(HTTPStatus.OK, {"module": key, **prefs})


@router.get("/api/flags")
def study_flags_list(request: Request, module: str = Query(default="")) -> Response:
    try:
        return core._json(HTTPStatus.OK, store.list_flags(core._account(request).id, store.module_key(module)))
    except db.StoreUnavailable as error:
        return _store_error(error)


@router.post("/api/flags")
def study_flags_set(req: core.Posted = Depends(core.posted)) -> Response:
    blocked = _limited(req)
    if blocked:
        return blocked
    try:
        payload = req.read_json(MAX_STUDY_BYTES)
        if not isinstance(payload.get("flagged"), bool):
            raise ValueError("flagged must be true or false.")
        qkey, body = store.question_key_and_body(payload)
        reply = store.set_flag(req.account.id, store.module_key(payload.get("module")), qkey, payload["flagged"], body)
    except _BAD as error:
        return _store_error(error)
    return core._json(HTTPStatus.OK, reply)


@router.post("/api/answers")
def study_answers_log(req: core.Posted = Depends(core.posted)) -> Response:
    blocked = _limited(req)
    if blocked:
        return blocked
    try:
        payload = req.read_json(MAX_STUDY_BYTES)
        entry = store.answer_entry(payload)
        outcome = store.log_answer(req.account.id, store.module_key(payload.get("module")), entry)
    except _BAD as error:
        return _store_error(error)
    return core._json(HTTPStatus.CREATED if outcome == "logged" else HTTPStatus.OK,
                      {"outcome": outcome, "question": entry["question_key"]})
