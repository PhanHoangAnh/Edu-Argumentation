"""Live quiz rooms — HTTP + WebSocket (study-rooms-qna P3, 30-09-26).

  POST /api/rooms            {bookId, blocks[], qCount 5-30, secs 10|20|30, mode? "speed"(default)|"accuracy"} -> {code, qCount, requested}
                             409 {error, code} if the account already owns an open room; 429 at the room cap
  GET  /api/rooms/{code}     -> lobby snapshot | 404
  WS   /api/rooms/{code}/ws  client: join · start (owner) · answer{qIdx,choice} · next (owner) · pong
                             server: lobby · question (NO `correct`) · answered · reveal · final · ended · ping

⛔ `async def` (the plan's standing-rule carve-out, F14): the store is an asyncio.Lock-guarded
   in-memory structure on the event loop. Blocking work (module load, session lookup) goes through
   run_in_threadpool.
⛔ THE HTTP MIDDLEWARE NEVER RUNS FOR A WEBSOCKET (M7). The WS handler checks, in order and BEFORE
   accept(): same-origin (main.origin_ok — the rule _gate uses), the session (main.session_lookup —
   the lookup require_session uses), the room, the caps. Then accept(); a failed check closes at
   once with 4403 (origin/session), 4404 (unknown room), 4429 (cap) or 1011 (account store down),
   and NO data frame is ever sent first.
⛔ The player's identity and display name come from the session account, never from `join`.
⚠ `import main as core` and core.X at CALL time only (main is partially initialised when addons load).
⚠ Named residuals (P3 report): the threadpool (40) is shared by slow model calls and these handshake
   session lookups; the per-socket message RATE is not capped (64 KB frames bound each message).
"""
from __future__ import annotations

import asyncio
import json
import re
import secrets
from http import HTTPStatus
from typing import Any

from fastapi import APIRouter, Depends, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import Response
from starlette.concurrency import run_in_threadpool

import ai
import auth
import db
import main as core
from addons import rooms_store as rs

router = APIRouter(prefix="/api/rooms")

BLOCK_ID = re.compile(r"^ch\d+-b\d+$")
MAX_BLOCKS = 500


def _load_questions(book: str, blocks: list[str], wanted: int, seed: int) -> list[dict[str, Any]]:
    """Blocking (reads module.json): called through run_in_threadpool."""
    module = ai.load_module(None, book)                 # ValueError("Unknown book.")
    quiz = module.get("quizData") if isinstance(module, dict) else None
    return rs.pick_questions(quiz if isinstance(quiz, list) else [], blocks, wanted, seed)


def _int(value: Any) -> int | None:
    return value if isinstance(value, int) and not isinstance(value, bool) else None


@router.post("")
async def create_room(req: core.Posted = Depends(core.posted)) -> Response:
    blocked = core._gate(req)
    if blocked:
        return blocked
    try:
        payload = req.read_json()
        book = payload.get("bookId")
        if not isinstance(book, str) or not book.strip():
            raise ValueError("Pick a book first.")
        blocks = payload.get("blocks")
        if (not isinstance(blocks, list) or not blocks or len(blocks) > MAX_BLOCKS
                or not all(isinstance(b, str) and BLOCK_ID.match(b) for b in blocks)):
            raise ValueError("Pick at least one lesson.")
        wanted = _int(payload.get("qCount"))
        if wanted is None or not rs.Q_MIN <= wanted <= rs.Q_MAX:
            raise ValueError(f"Pick {rs.Q_MIN}-{rs.Q_MAX} questions.")
        secs = _int(payload.get("secs"))
        if secs not in rs.SECS_ALLOWED:
            raise ValueError("Pick 10, 20 or 30 seconds.")
        mode = payload.get("mode", "speed")
        if mode not in rs.MODES:
            raise ValueError("Pick speed or accuracy scoring.")
        questions = await run_in_threadpool(_load_questions, book, sorted(set(blocks)), wanted,
                                            secrets.randbits(32))
    except (ValueError, TypeError, json.JSONDecodeError) as error:
        return core._json(HTTPStatus.BAD_REQUEST, {"error": str(error)})
    if not questions:
        return core._json(HTTPStatus.BAD_REQUEST, {"error": "No questions in these lessons."})
    account = req.account
    try:
        room = await rs.STORE.create(account.id, account.display_name or account.username, book,
                                     sorted(set(blocks)), questions, secs, mode)
    except rs.AlreadyOwner as error:
        mine = next((r.code for r in rs.STORE.rooms.values() if r.owner_id == account.id and r.state != "final"), None)
        return core._json(HTTPStatus.CONFLICT, {"error": str(error), "code": mine})
    except rs.CapReached as error:
        return core._json(HTTPStatus.TOO_MANY_REQUESTS, {"error": str(error)})
    return core._json(HTTPStatus.OK, {"code": room.code, "qCount": room.q_count, "requested": wanted})


@router.get("/{code}")
async def room_snapshot(code: str, request: Request) -> Response:
    room = rs.STORE.get(code)
    if room is None:
        return core._json(HTTPStatus.NOT_FOUND, {"error": "Room ended."})
    return core._json(HTTPStatus.OK, rs.STORE.snapshot(room, request.state.account.id))


async def _refuse(ws: WebSocket, code: int) -> None:
    """accept() then close at once: a close BEFORE accept becomes an HTTP 403 and the browser only
    ever sees 1006. No data frame is sent."""
    await ws.accept()
    await ws.close(code)


@router.websocket("/{code}/ws")
async def room_socket(ws: WebSocket, code: str) -> None:
    # 1. same-origin — the SAME rule as _gate (a missing Origin passes; the cookie is still needed).
    if not core.origin_ok(ws.headers):
        await _refuse(ws, 4403)
        return
    # 2. the session — the SAME lookup as require_session.
    try:
        account, _refreshed = await core.session_lookup(ws.cookies.get(auth.COOKIE_NAME))
    except db.StoreUnavailable:
        await _refuse(ws, 1011)
        return
    if account is None:
        await _refuse(ws, 4403)
        return
    # 3. the room, then the caps (a socket slot is held from here until the finally below).
    room, verdict = await rs.STORE.reserve(code, account.id)
    if verdict == "unknown":
        await _refuse(ws, 4404)
        return
    if verdict == "cap":
        await _refuse(ws, 4429)
        return
    try:
        await ws.accept()
        try:
            await rs.STORE.join(room, account.id, account.display_name or account.username, ws)
        except rs.CapReached:
            await ws.close(4429)
            return
        except LookupError:
            await ws.close(4404)
            return
        while True:
            try:
                raw = await asyncio.wait_for(ws.receive_text(), rs.PING_S)
            except asyncio.TimeoutError:
                await rs.STORE._send(ws, {"type": "ping"})
                continue
            try:
                message = json.loads(raw)
            except (ValueError, TypeError):
                continue
            if not isinstance(message, dict):
                continue
            kind = message.get("type")
            if kind == "answer":
                await rs.STORE.answer(room, account.id, message.get("qIdx"), message.get("choice"))
            elif kind == "start":
                await rs.STORE.start(room, account.id)
            elif kind == "next":
                await rs.STORE.next(room, account.id)
            elif kind in ("pong", "join"):
                await rs.STORE.touch(room)      # `join` carries nothing we trust: identity is the session's
    except (WebSocketDisconnect, RuntimeError, KeyError):
        pass
    finally:
        await rs.STORE.leave(room, account.id, ws)
        await rs.STORE.release_slot()
