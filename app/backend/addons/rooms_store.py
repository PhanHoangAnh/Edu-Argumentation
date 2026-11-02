"""Live quiz rooms — the in-memory room store (study-rooms-qna P3, 30-09-26).

ONE asyncio.Lock guards every room. Everything here runs on the event loop: timers are asyncio
tasks, never threads (the unit has TasksMax=256).

⛔ SEND OUTSIDE THE LOCK (F18). Every broadcast snapshots (socket, payload) pairs under the lock,
   releases it, then sends each with a 5 s timeout. A client that times out or errors is dropped.
   One slow phone can never stall a room, and the lock is never held across a network write.
⛔ `correct` NEVER leaves the server before the reveal: question_frame() has no such key, and
   gates/gate-r-ws.py reads every captured question frame for it.
⚠ D2 (user decision 29-09-26): any signed-in reader can look the answer up in
   /book/<id>/module.json. The protocol still withholds `correct` until reveal, so the server
   never helps a cheater. Options keep the book's order (no per-room shuffle).
⚠ Nothing is persisted. A restart ends every room; a client then gets close 4404 -> "Room ended".
⚠ Caps are sized to the unit (M5): open-files soft limit 1024 -> <= 200 sockets; 20 rooms;
   30 players per room; 1 active owned room per account. The interval and cap constants below
   are MODULE constants: gates/gate-r-ws.py lowers them IN ITS OWN PROCESS. The live unit never
   sets them (no env override exists, F21).
"""
from __future__ import annotations

import asyncio
import json
import random
import secrets
import time
from dataclasses import dataclass, field
from typing import Any

ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
CODE_LEN = 6

MAX_SOCKETS = 200
MAX_ROOMS = 20
MAX_PLAYERS = 30

SWEEP_INTERVAL_S = 60.0       # the expiry sweep
IDLE_S = 30 * 60.0            # a room with no activity for this long is removed
FINAL_KEEP_S = 10 * 60.0      # a finished room is kept this long for the podium
OWNER_GONE_S = 60.0           # owner disconnected this long -> the room ends
SEND_TIMEOUT_S = 5.0          # per-socket send budget; a slower client is dropped
PING_S = 25.0                 # app-level ping after this much silence (nginx reads 180 s)

Q_MIN, Q_MAX = 5, 30
SECS_ALLOWED = (10, 20, 30)
MODES = ("speed", "accuracy")      # speed: 500-1000 pts by time left · accuracy: 1 pt per correct answer


class CapReached(Exception):
    """A global or per-room cap is full (HTTP 429 / WS close 4429)."""


class AlreadyOwner(Exception):
    """The account already owns an active room (HTTP 409)."""


@dataclass
class Player:
    account_id: int
    name: str
    score: int = 0
    answers: dict[int, dict[str, Any]] = field(default_factory=dict)
    socket: Any = None


@dataclass
class Room:
    code: str
    owner_id: int
    owner_name: str
    book_id: str
    blocks: list[str]
    questions: list[dict[str, Any]]
    secs: int
    mode: str = "speed"
    players: dict[int, Player] = field(default_factory=dict)
    state: str = "lobby"                 # lobby | question | reveal | final
    q_idx: int = -1
    deadline: float = 0.0                # monotonic
    deadline_wall_ms: int = 0            # the same instant, epoch ms, for the client's countdown
    started_at: float = 0.0
    last_activity: float = field(default_factory=time.monotonic)
    final_at: float = 0.0
    timer: asyncio.Task | None = None
    owner_timer: asyncio.Task | None = None

    @property
    def q_count(self) -> int:
        return len(self.questions)


# ------------------------------------------------------------------ pure helpers
def pick_questions(quiz: list[Any], blocks: list[str], wanted: int, seed: int) -> list[dict[str, Any]]:
    """quizData entries whose source.block is selected, in lesson order, shuffled with the room's
    seed, first `wanted` kept. Options keep the book's order (D2)."""
    chosen = set(blocks)
    pool = []
    for position, item in enumerate(quiz):
        if not isinstance(item, dict):
            continue
        source = item.get("source") if isinstance(item.get("source"), dict) else {}
        block = source.get("block")
        options = item.get("options")
        correct = item.get("correct")
        if block not in chosen or not isinstance(options, list) or len(options) < 2:
            continue
        if isinstance(correct, bool) or not isinstance(correct, int) or not 0 <= correct < len(options):
            continue
        explanations = item.get("explanations") if isinstance(item.get("explanations"), list) else []
        pool.append((str(block), position, {
            "question": str(item.get("question") or ""),
            "options": [str(o) for o in options],
            "correct": correct,
            "explanations": [str(e) for e in explanations][: len(options)],
        }))
    pool.sort(key=lambda row: (row[0], row[1]))          # lesson order: chNN-bNN, then book order
    ordered = [row[2] for row in pool]
    random.Random(seed).shuffle(ordered)
    return ordered[:wanted]


def points_for(remaining: float, secs: int, mode: str = "speed") -> int:
    """speed: correct -> round(1000 * (0.5 + 0.5 * remaining/secs)); accuracy: correct -> 1, however
    fast. Wrong -> 0 in both (the caller)."""
    if mode == "accuracy":
        return 1
    fraction = max(0.0, min(1.0, remaining / secs))
    return round(1000 * (0.5 + 0.5 * fraction))


def question_frame(room: Room) -> dict[str, Any]:
    """⛔ NO `correct` KEY, ever. Built from an explicit allow-list, never from the stored dict."""
    item = room.questions[room.q_idx]
    return {"type": "question", "qIdx": room.q_idx, "total": room.q_count, "question": item["question"],
            "options": list(item["options"]), "secs": room.secs, "deadline": room.deadline_wall_ms}


def board(room: Room) -> list[dict[str, Any]]:
    rows = sorted(room.players.values(), key=lambda p: (-p.score, p.name.lower(), p.account_id))
    return [{"name": p.name, "score": p.score, "rank": i + 1} for i, p in enumerate(rows)]


def lobby_frame(room: Room) -> dict[str, Any]:
    return {"type": "lobby", "code": room.code, "owner": room.owner_name, "qCount": room.q_count,
            "secs": room.secs, "mode": room.mode, "state": room.state,
            "players": [{"name": p.name, "online": p.socket is not None}
                        for p in sorted(room.players.values(), key=lambda p: p.name.lower())]}


def reveal_frame(room: Room) -> dict[str, Any]:
    item = room.questions[room.q_idx]
    per_question = []
    for p in room.players.values():
        answer = p.answers.get(room.q_idx)
        per_question.append({"name": p.name, "points": answer["points"] if answer else 0,
                             "answered": answer is not None, "score": p.score})
    per_question.sort(key=lambda r: (-r["points"], r["name"].lower()))
    return {"type": "reveal", "qIdx": room.q_idx, "total": room.q_count, "correct": item["correct"],
            "explanations": list(item["explanations"]), "perQuestionBoard": per_question, "board": board(room)}


def final_frame(room: Room) -> dict[str, Any]:
    rows = board(room)
    return {"type": "final", "podium": rows[:3], "board": rows}


# ------------------------------------------------------------------ the store
class RoomStore:
    def __init__(self) -> None:
        self.lock = asyncio.Lock()
        self.rooms: dict[str, Room] = {}
        self.sockets = 0
        self._sweeper: asyncio.Task | None = None

    # ---- creation / lookup ------------------------------------------------------
    def _new_code(self) -> str:
        for _ in range(100):
            code = "".join(secrets.choice(ALPHABET) for _ in range(CODE_LEN))
            if code not in self.rooms:
                return code
        raise CapReached("no free room code")

    async def create(self, owner_id: int, owner_name: str, book_id: str, blocks: list[str],
                     questions: list[dict[str, Any]], secs: int, mode: str = "speed") -> Room:
        async with self.lock:
            self._ensure_sweeper()
            if any(r.owner_id == owner_id and r.state != "final" for r in self.rooms.values()):
                raise AlreadyOwner("You already have an open room.")
            if len(self.rooms) >= MAX_ROOMS:
                raise CapReached("Too many rooms are open right now.")
            room = Room(code=self._new_code(), owner_id=owner_id, owner_name=owner_name, book_id=book_id,
                        blocks=list(blocks), questions=questions, secs=secs, mode=mode)
            self.rooms[room.code] = room
            return room

    def get(self, code: str) -> Room | None:
        return self.rooms.get(str(code or "").strip().upper())

    def snapshot(self, room: Room, account_id: int) -> dict[str, Any]:
        frame = lobby_frame(room)
        frame.pop("type")
        frame["isOwner"] = room.owner_id == account_id
        frame["bookId"] = room.book_id
        return frame

    # ---- sockets ----------------------------------------------------------------
    async def reserve(self, code: str, account_id: int) -> tuple[Room | None, str]:
        """Before accept(): 'ok' (a socket slot is now held), 'unknown' or 'cap'."""
        async with self.lock:
            room = self.get(code)
            if room is None:
                return None, "unknown"
            if self.sockets >= MAX_SOCKETS:
                return room, "cap"
            if account_id not in room.players and len(room.players) >= MAX_PLAYERS:
                return room, "cap"
            self.sockets += 1
            return room, "ok"

    async def release_slot(self) -> None:
        async with self.lock:
            self.sockets = max(0, self.sockets - 1)

    async def join(self, room: Room, account_id: int, name: str, socket: Any) -> None:
        """Identity and display name come from the SESSION account, never from a client message."""
        replaced = None
        async with self.lock:
            if self.rooms.get(room.code) is not room:
                raise LookupError("room ended")
            player = room.players.get(account_id)
            if player is None:
                if len(room.players) >= MAX_PLAYERS:
                    raise CapReached("room full")
                player = Player(account_id=account_id, name=name)
                room.players[account_id] = player
            replaced, player.socket = player.socket, socket
            room.last_activity = time.monotonic()
            if account_id == room.owner_id and room.owner_timer is not None:
                room.owner_timer.cancel()
                room.owner_timer = None
            sends = self._to_all(room, lobby_frame(room))
            own = []
            if room.state == "question":
                own.append((socket, question_frame(room)))
                if room.q_idx in player.answers:
                    own.append((socket, {"type": "answered", "qIdx": room.q_idx}))
            elif room.state == "reveal":
                own.append((socket, reveal_frame(room)))
            elif room.state == "final":
                own.append((socket, final_frame(room)))
        if replaced is not None:
            await self._send(replaced, {"type": "ended", "reason": "replaced"})
            await _close(replaced, 1000)
        await self._deliver(sends + own)

    async def leave(self, room: Room, account_id: int, socket: Any) -> None:
        async with self.lock:
            player = room.players.get(account_id)
            if player is None or player.socket is not socket:
                return                                     # already replaced by a newer tab
            player.socket = None                           # keeps the score; can rejoin
            live = self.rooms.get(room.code) is room
            if live and account_id == room.owner_id and room.state != "final" and room.owner_timer is None:
                room.owner_timer = asyncio.create_task(self._owner_gone(room))
            sends = self._to_all(room, lobby_frame(room)) if live else []
        await self._deliver(sends)

    # ---- the game ---------------------------------------------------------------
    async def start(self, room: Room, account_id: int) -> None:
        async with self.lock:
            if account_id != room.owner_id or room.state != "lobby" or self.rooms.get(room.code) is not room:
                return
            room.started_at = time.monotonic()
            sends = self._open_question(room, 0)
        await self._deliver(sends)

    async def next(self, room: Room, account_id: int) -> None:
        async with self.lock:
            if account_id != room.owner_id or room.state != "reveal" or self.rooms.get(room.code) is not room:
                return
            if room.q_idx + 1 < room.q_count:
                sends = self._open_question(room, room.q_idx + 1)
            else:
                room.state = "final"
                room.final_at = time.monotonic()
                room.last_activity = room.final_at
                sends = self._to_all(room, final_frame(room))
        await self._deliver(sends)

    async def answer(self, room: Room, account_id: int, q_idx: Any, choice: Any) -> None:
        """First answer counts; late or duplicate answers are ignored."""
        async with self.lock:
            player = room.players.get(account_id)
            if (player is None or room.state != "question" or q_idx != room.q_idx
                    or room.q_idx in player.answers or isinstance(choice, bool) or not isinstance(choice, int)):
                return
            item = room.questions[room.q_idx]
            if not 0 <= choice < len(item["options"]):
                return
            now = time.monotonic()
            if now > room.deadline:
                return
            correct = choice == item["correct"]
            points = points_for(room.deadline - now, room.secs, room.mode) if correct else 0
            player.answers[room.q_idx] = {"choice": choice, "correct": correct, "points": points}
            player.score += points
            room.last_activity = now
            sends = [(player.socket, {"type": "answered", "qIdx": room.q_idx})] if player.socket else []
            online = [p for p in room.players.values() if p.socket is not None]
            if online and all(room.q_idx in p.answers for p in online):
                sends += self._reveal(room)                 # early reveal: everyone has answered
        await self._deliver(sends)

    async def touch(self, room: Room) -> None:
        async with self.lock:
            room.last_activity = time.monotonic()

    # ---- internals (call with the lock held) --------------------------------------
    def _open_question(self, room: Room, index: int) -> list[tuple[Any, dict[str, Any]]]:
        room.state = "question"
        room.q_idx = index
        now = time.monotonic()
        room.deadline = now + room.secs
        room.deadline_wall_ms = int((time.time() + room.secs) * 1000)
        room.last_activity = now
        if room.timer is not None:
            room.timer.cancel()
        room.timer = asyncio.create_task(self._deadline(room, index))
        return self._to_all(room, question_frame(room))

    def _reveal(self, room: Room) -> list[tuple[Any, dict[str, Any]]]:
        room.state = "reveal"
        if room.timer is not None and room.timer is not asyncio.current_task():
            room.timer.cancel()
        room.timer = None
        return self._to_all(room, reveal_frame(room))

    def _to_all(self, room: Room, payload: dict[str, Any]) -> list[tuple[Any, dict[str, Any]]]:
        return [(p.socket, payload) for p in room.players.values() if p.socket is not None]

    async def _deadline(self, room: Room, index: int) -> None:
        await asyncio.sleep(max(0.0, room.deadline - time.monotonic()))
        async with self.lock:
            if room.state != "question" or room.q_idx != index or self.rooms.get(room.code) is not room:
                return
            sends = self._reveal(room)
        await self._deliver(sends)

    async def _owner_gone(self, room: Room) -> None:
        await asyncio.sleep(OWNER_GONE_S)
        async with self.lock:
            if room.owner_timer is asyncio.current_task():
                room.owner_timer = None
            owner = room.players.get(room.owner_id)
            if self.rooms.get(room.code) is not room or (owner is not None and owner.socket is not None):
                return
            sockets = self._end(room)
        await self._finish(sockets, "owner_left")

    def _end(self, room: Room) -> list[Any]:
        """Remove the room (lock held). Returns the sockets to tell and close."""
        self.rooms.pop(room.code, None)
        for task in (room.timer, room.owner_timer):
            if task is not None and task is not asyncio.current_task():
                task.cancel()
        sockets = [p.socket for p in room.players.values() if p.socket is not None]
        for p in room.players.values():
            p.socket = None
        return sockets

    async def _finish(self, sockets: list[Any], reason: str) -> None:
        await self._deliver([(s, {"type": "ended", "reason": reason}) for s in sockets])
        await asyncio.gather(*(_close(s, 1000) for s in sockets), return_exceptions=True)

    def _ensure_sweeper(self) -> None:
        if self._sweeper is None or self._sweeper.done():
            self._sweeper = asyncio.create_task(self._sweep_loop())

    async def _sweep_loop(self) -> None:
        while True:
            await asyncio.sleep(SWEEP_INTERVAL_S)
            await self.sweep()

    async def sweep(self) -> list[str]:
        """Remove rooms idle IDLE_S, or finished FINAL_KEEP_S ago. Returns the removed codes."""
        now = time.monotonic()
        doomed: list[tuple[str, list[Any]]] = []
        async with self.lock:
            for room in list(self.rooms.values()):
                stale = now - room.last_activity >= IDLE_S
                over = room.state == "final" and now - room.final_at >= FINAL_KEEP_S
                if stale or over:
                    doomed.append((room.code, self._end(room)))
        for _code, sockets in doomed:
            await self._finish(sockets, "expired")
        return [code for code, _ in doomed]

    # ---- delivery (NEVER under the lock) -------------------------------------------
    async def _deliver(self, sends: list[tuple[Any, dict[str, Any]]]) -> None:
        if sends:
            await asyncio.gather(*(self._send(s, payload) for s, payload in sends), return_exceptions=True)

    async def _send(self, socket: Any, payload: dict[str, Any]) -> None:
        try:
            await asyncio.wait_for(socket.send_text(json.dumps(payload, separators=(",", ":"))), SEND_TIMEOUT_S)
        except Exception:                                       # noqa: BLE001 — a dead/slow client is dropped
            await self._drop(socket)

    async def _drop(self, socket: Any) -> None:
        async with self.lock:
            for room in self.rooms.values():
                for p in room.players.values():
                    if p.socket is socket:
                        p.socket = None
                        if p.account_id == room.owner_id and room.state != "final" and room.owner_timer is None:
                            room.owner_timer = asyncio.create_task(self._owner_gone(room))
        await _close(socket, 1011)


async def _close(socket: Any, code: int) -> None:
    try:
        await asyncio.wait_for(socket.close(code), SEND_TIMEOUT_S)
    except Exception:                                           # noqa: BLE001 — already gone
        pass


STORE = RoomStore()
