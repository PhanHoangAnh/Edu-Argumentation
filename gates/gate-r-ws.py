#!/usr/bin/env python3
"""gate-r-ws.py — R-suite: LIVE QUIZ ROOMS over WebSocket (study-rooms-qna P3, 30-09-26). Tier 2.

Runs uvicorn IN THIS PROCESS (same asyncio loop as the client) on 127.0.0.1:$R_WS_PORT (8788), so
the room store's caps and timers can be LOWERED HERE — never through the live unit's environment
(F21). The server gets the unit's own WS flags (--ws-max-size 65536, no deflate, 25 s ping).
The client is the `websockets` library from the test venv. Accounts and sessions live in the
ISOLATED gate database (edu_study_gate) — run-gates-react.sh wipes it every run; the gate-ws-*
accounts made here are deleted again at the end.

⛔ What this proves: the WS auth order (origin + session BEFORE accept, then a close code with ZERO
   data frames), the caps, protocol secrecy (no `correct` in any question frame), scoring, early and
   deadline reveals, rejoin, owner-gone and idle expiry. It does NOT prove anything through nginx
   (the both-doors 3-player sim does) or with real browsers.

Result lines (RS-COUNT in gate-r-self.mjs moves with this number, always): 27.
Each line: fails when <the named condition> — see the check text.

Env: EDU_DB_ENV_PATH (gate DB, REQUIRED) · R_BACKEND (default ../app/backend) · R_SMOKE_LIB
     (default /var/tmp/edu-smoke/lib) · R_WS_PORT (8788) · R_WS_DIR (/var/tmp/edu-ws-harness)
"""
from __future__ import annotations

import asyncio
import json
import os
import sys
import time
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

HERE = Path(__file__).resolve().parent
BACKEND = Path(os.environ.get("R_BACKEND") or HERE.parent / "app" / "backend").resolve()
SMOKE_LIB = os.environ.get("R_SMOKE_LIB") or "/var/tmp/edu-smoke/lib"
PORT = int(os.environ.get("R_WS_PORT") or 8788)
WDIR = Path(os.environ.get("R_WS_DIR") or "/var/tmp/edu-ws-harness")
BASE = f"http://127.0.0.1:{PORT}"
WSBASE = f"ws://127.0.0.1:{PORT}"
ORIGIN = f"http://127.0.0.1:{PORT}"
BOOK = "geron-homl3"
BLOCKS = ["ch01-b01", "ch01-b02", "ch01-b03"]

if not os.environ.get("EDU_DB_ENV_PATH"):
    print("REFUSING: needs EDU_DB_ENV_PATH (the gate DB) — run via run-gates-react.sh", file=sys.stderr)
    sys.exit(2)
if "edu_study_gate" not in Path(os.environ["EDU_DB_ENV_PATH"]).read_text():
    print("REFUSING: EDU_DB_ENV_PATH does not point at edu_study_gate", file=sys.stderr)
    sys.exit(2)
if str(WDIR).startswith(("/tmp", "/dev/shm")):
    print("REFUSING: tmpfs path (RAM)", file=sys.stderr)
    sys.exit(2)

WDIR.mkdir(parents=True, exist_ok=True)
(WDIR / "stores").mkdir(exist_ok=True)
(WDIR / "stores" / "settings.json").write_text('{"ai_question_count":5,"fresh_quiz_size":20,"require_access_token":false}\n')
(WDIR / "stores" / "progress.json").write_text('{"modules":{},"version":2}\n')
(WDIR / "stores" / "provider.env").write_text("")
for key, value in {
    "EDU_LIBRARY_ROOT": SMOKE_LIB, "EDU_ASSET_ROOT": str(Path(SMOKE_LIB).parent / "assets"),
    "EDU_PROGRESS_PATH": str(WDIR / "stores" / "progress.json"),
    "EDU_SETTINGS_PATH": str(WDIR / "stores" / "settings.json"),
    "EDU_LIBRARY_META_PATH": str(WDIR / "stores" / "library-meta.json"),
    "EDU_BOOK_ROOT": str(WDIR / "stores" / "books"), "EDU_ENV_PATH": str(WDIR / "stores" / "provider.env"),
}.items():
    os.environ.setdefault(key, value)

sys.path.insert(0, str(BACKEND))
os.chdir(BACKEND)
import uvicorn  # noqa: E402
import websockets  # noqa: E402
from websockets.exceptions import ConnectionClosed  # noqa: E402

import auth  # noqa: E402
import db  # noqa: E402
import main  # noqa: E402
from addons import rooms_store as rs  # noqa: E402

RESULTS: list[bool] = []


def check(cid: str, ok: bool, text: str, detail: str = "") -> None:
    RESULTS.append(bool(ok))
    print(f"{'PASS' if ok else 'FAIL'}  {cid} {text}{'' if ok else '  -- ' + detail}", flush=True)


# ------------------------------------------------------------------ accounts (gate DB only)
USERS = ["gate-ws-1", "gate-ws-2", "gate-ws-3", "gate-ws-4"]


def make_accounts() -> dict[str, tuple[int, str]]:
    out = {}
    for i, name in enumerate(USERS, 1):
        db.execute("DELETE FROM accounts WHERE username = %s AND NOT is_owner", (name,))
        account = auth.create_account(name, f"WS Player {i}", "gate-ws-password-" + "x" * 12, owner=False)
        out[name] = (account.id, auth.issue_session(account.id))
    return out


def drop_accounts() -> None:
    for name in USERS:
        db.execute("DELETE FROM accounts WHERE username = %s AND NOT is_owner", (name,))


# ------------------------------------------------------------------ http + ws helpers
def _http(method: str, path: str, token: str | None, body: dict | None = None, origin: str | None = ORIGIN):
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Cookie"] = f"edu_session={token}"
    if origin:
        headers["Origin"] = origin
    data = json.dumps(body).encode() if body is not None else None
    try:
        with urlopen(Request(BASE + path, data=data, headers=headers, method=method), timeout=15) as r:
            return r.status, json.loads(r.read() or b"{}")
    except HTTPError as e:
        try:
            return e.code, json.loads(e.read() or b"{}")
        except ValueError:
            return e.code, {}


async def http(*args, **kw):
    return await asyncio.to_thread(_http, *args, **kw)


async def create(token: str, q_count: int = 5, secs: int = 10, blocks=None):
    return await http("POST", "/api/rooms", token, {"bookId": BOOK, "blocks": blocks or BLOCKS, "qCount": q_count, "secs": secs})


async def open_ws(code: str, token: str | None, origin: str | None = ORIGIN):
    headers = {"Cookie": f"edu_session={token}"} if token else {}
    return await websockets.connect(f"{WSBASE}/api/rooms/{code}/ws", additional_headers=headers, origin=origin,
                                    open_timeout=10, max_size=2**20)


async def refused(code: str, token: str | None, origin: str | None = ORIGIN) -> tuple[int | None, int]:
    """(close code, data frames received before the close)."""
    frames = 0
    try:
        ws = await open_ws(code, token, origin)
    except Exception as error:  # noqa: BLE001 — a handshake refusal (HTTP 403) is a FAIL, not a close
        return None, -1 if "403" in str(error) else -2
    try:
        while True:
            await asyncio.wait_for(ws.recv(), 5)
            frames += 1
    except ConnectionClosed as closed:
        return (closed.rcvd.code if closed.rcvd else None), frames
    except asyncio.TimeoutError:
        await ws.close()
        return None, frames


class Client:
    """A player: records every frame it receives."""

    def __init__(self, ws):
        self.ws = ws
        self.frames: list[dict] = []
        self.closed_code: int | None = None
        self._task = asyncio.create_task(self._pump())
        self._new = asyncio.Event()

    async def _pump(self):
        try:
            async for raw in self.ws:
                frame = json.loads(raw)
                if frame.get("type") == "ping":
                    await self.ws.send('{"type":"pong"}')
                self.frames.append(frame)
                self._new.set()
        except ConnectionClosed as closed:
            self.closed_code = closed.rcvd.code if closed.rcvd else None
        self._new.set()

    async def wait(self, kind: str, pred=lambda f: True, timeout: float = 15.0) -> dict | None:
        end = time.monotonic() + timeout
        seen = 0
        while True:
            for f in self.frames[seen:]:
                if f.get("type") == kind and pred(f):
                    return f
            seen = len(self.frames)
            left = end - time.monotonic()
            if left <= 0 or (self._task.done() and seen == len(self.frames)):
                return None
            self._new.clear()
            try:
                await asyncio.wait_for(self._new.wait(), left)
            except asyncio.TimeoutError:
                return None

    async def send(self, message: dict):
        await self.ws.send(json.dumps(message))

    async def close(self):
        await self.ws.close()
        await asyncio.gather(self._task, return_exceptions=True)


async def player(code: str, token: str, origin: str | None = ORIGIN, join_name: str | None = None) -> Client:
    c = Client(await open_ws(code, token, origin))
    await c.send({"type": "join", **({"name": join_name} if join_name else {})})
    return c


async def end_all_rooms():
    async with rs.STORE.lock:
        doomed = [rs.STORE._end(r) for r in list(rs.STORE.rooms.values())]
    for sockets in doomed:
        await rs.STORE._finish(sockets, "expired")


# ------------------------------------------------------------------ the suite
async def suite(acc: dict[str, tuple[int, str]]):
    (id1, t1), (id2, t2), (id3, t3), (id4, t4) = (acc[u] for u in USERS)

    # ---- HTTP ----
    status, _ = await http("POST", "/api/rooms", t1, {"bookId": BOOK, "blocks": BLOCKS, "qCount": 5, "secs": 10}, origin="http://evil.example")
    check("WS-H1", status == 403, "POST /api/rooms from a foreign Origin -> 403 (fails when the create route skips _gate)", f"status={status}")
    status, body = await create(t1, blocks=["ch99-b99"])
    check("WS-H2", status == 400, "a room over lessons with zero questions -> 400 (fails when an empty room can be created)", f"status={status} {body}")
    status, body = await create(t1)
    code1 = body.get("code", "")
    status2, body2 = await create(t1)
    check("WS-H3", status == 200 and status2 == 409 and body2.get("code") == code1,
          "a second open room for the same account -> 409 carrying the first code (fails when one account can hoard rooms)", f"{status} {status2} {body2}")
    s404, _ = await http("GET", "/api/rooms/ZZZZZZ", t1)
    s200, snap = await http("GET", f"/api/rooms/{code1}", t2)
    check("WS-H4", s404 == 404 and s200 == 200 and snap.get("isOwner") is False and "correct" not in json.dumps(snap),
          "GET unknown code -> 404; GET a live code -> a snapshot with no answers (fails when the snapshot leaks `correct`)", f"{s404} {s200} {snap}")
    saved = rs.MAX_ROOMS
    rs.MAX_ROOMS = len(rs.STORE.rooms) + 1
    sa, _ = await create(t2)
    sb, bb = await create(t3)
    rs.MAX_ROOMS = saved
    check("WS-H5", sa == 200 and sb == 429, "the room cap is enforced -> 429 (fails when MAX_ROOMS is not checked)", f"{sa} {sb} {bb}")
    await end_all_rooms()

    # ---- WS refusals: close code, ZERO data frames ----
    status, body = await create(t1)
    code = body["code"]
    cc, n = await refused(code, t1, origin="http://evil.example")
    check("WS-A1", cc == 4403 and n == 0, "wrong Origin -> close 4403 with 0 data frames (fails when origin is not checked before accept)", f"code={cc} frames={n}")
    cc, n = await refused(code, None)
    check("WS-A2", cc == 4403 and n == 0, "no session cookie -> close 4403 with 0 data frames (fails when the WS skips the session check)", f"code={cc} frames={n}")
    cc, n = await refused(code, "not-a-real-token")
    check("WS-A3", cc == 4403 and n == 0, "a forged cookie -> close 4403 with 0 data frames (fails when any cookie is trusted)", f"code={cc} frames={n}")
    cc, n = await refused("ZZZZZZ", t1)
    check("WS-A4", cc == 4404 and n == 0, "unknown room -> close 4404 with 0 data frames (fails when an unknown code is accepted)", f"code={cc} frames={n}")
    saved = rs.MAX_SOCKETS
    rs.MAX_SOCKETS = rs.STORE.sockets
    cc, n = await refused(code, t1)
    rs.MAX_SOCKETS = saved
    check("WS-A5", cc == 4429 and n == 0, "global socket cap -> close 4429 with 0 data frames (fails when MAX_SOCKETS is not enforced)", f"code={cc} frames={n}")
    real = auth.session_account

    def down(_token):
        raise db.StoreUnavailable("gate: simulated outage")
    auth.session_account = down
    try:
        cc, n = await refused(code, t1)
    finally:
        auth.session_account = real
    check("WS-A6", cc == 1011 and n == 0, "account store down -> close 1011 with 0 data frames (fails when StoreUnavailable escapes or leaks a frame)", f"code={cc} frames={n}")
    c = await player(code, t2, origin=None, join_name="EVIL NAME")
    lobby = await c.wait("lobby", lambda f: any(p["name"] == "WS Player 2" for p in f["players"]))
    names = [p["name"] for p in (lobby or {}).get("players", [])]
    check("WS-A7", lobby is not None and "EVIL NAME" not in names,
          "no Origin + a valid cookie is accepted, and the name is the SESSION's, never the join message's (fails when `join` sets identity)", f"names={names}")
    saved = rs.MAX_PLAYERS
    rs.MAX_PLAYERS = 1
    cc, n = await refused(code, t3)
    rs.MAX_PLAYERS = saved
    check("WS-P1", cc == 4429 and n == 0, "players-per-room cap -> close 4429 with 0 data frames (fails when MAX_PLAYERS is not enforced)", f"code={cc} frames={n}")
    await c.close()
    await end_all_rooms()

    # ---- a full game: 3 players, 5 questions, 10 s ----
    status, body = await create(t1, q_count=5, secs=10)
    code = body["code"]
    host, p2, p3 = await player(code, t1), await player(code, t2), await player(code, t3)
    await host.wait("lobby", lambda f: len(f["players"]) == 3)
    await p2.send({"type": "start"})                        # not the owner: ignored
    await asyncio.sleep(0.5)
    ignored = all(f.get("type") != "question" for f in host.frames)
    await host.send({"type": "start"})
    q0 = await host.wait("question", lambda f: f["qIdx"] == 0)
    check("WS-G0", ignored and q0 is not None, "only the owner can start (fails when a player's `start` opens the game)", f"ignored={ignored} q0={bool(q0)}")
    item0 = rs.STORE.get(code).questions[0]
    right, wrong = item0["correct"], (item0["correct"] + 1) % len(item0["options"])
    t_sent = time.monotonic()
    await p2.send({"type": "answer", "qIdx": 0, "choice": right})
    await p2.send({"type": "answer", "qIdx": 0, "choice": wrong})          # a second answer: ignored
    await p3.send({"type": "answer", "qIdx": 0, "choice": wrong})
    await host.send({"type": "answer", "qIdx": 0, "choice": right})
    rv0 = await host.wait("reveal", lambda f: f["qIdx"] == 0, timeout=12)
    elapsed = time.monotonic() - t_sent
    check("WS-G1", rv0 is not None and elapsed < 5, "reveal comes EARLY once every player has answered (fails when it always waits for the deadline)", f"elapsed={elapsed:.1f}s")
    rows = {r["name"]: r for r in (rv0 or {}).get("perQuestionBoard", [])}
    pts2, pts3 = rows.get("WS Player 2", {}).get("points"), rows.get("WS Player 3", {}).get("points")
    upper = rs.points_for(10, 10)
    lower = rs.points_for(10 - min(10, elapsed + 1), 10)
    check("WS-G2", pts2 is not None and lower <= pts2 <= upper and pts3 == 0,
          "speed points: correct = round(1000*(0.5+0.5*remaining/secs)), wrong = 0, first answer counts (fails when the formula, the wrong-answer 0 or first-answer-wins breaks)",
          f"p2={pts2} (band {lower}..{upper}) p3={pts3}")
    check("WS-S2", rv0 is not None and rv0.get("correct") == right and isinstance(rv0.get("explanations"), list),
          "the reveal frame carries `correct` + `explanations` (fails when the answer is never revealed)", f"correct={(rv0 or {}).get('correct')} explanations={type((rv0 or {}).get('explanations')).__name__}")
    # q1: nobody but the host answers -> the deadline reveals
    await host.send({"type": "next"})
    q1 = await p2.wait("question", lambda f: f["qIdx"] == 1)
    await host.send({"type": "answer", "qIdx": 1, "choice": rs.STORE.get(code).questions[1]["correct"]})
    t1s = time.monotonic()
    rv1 = await p2.wait("reveal", lambda f: f["qIdx"] == 1, timeout=14)
    waited = time.monotonic() - t1s
    check("WS-G3", q1 is not None and rv1 is not None and waited >= 7,
          "without every answer the reveal waits for the deadline (fails when a partial set reveals early)", f"waited={waited:.1f}s")
    # rejoin keeps the score
    score_before = next((r["score"] for r in rv1["board"] if r["name"] == "WS Player 2"), None) if rv1 else None
    await p2.close()
    p2 = await player(code, t2)
    back = await p2.wait("reveal", lambda f: f["qIdx"] == 1)
    score_after = next((r["score"] for r in back["board"] if r["name"] == "WS Player 2"), None) if back else None
    check("WS-R1", back is not None and score_before is not None and score_after == score_before,
          "a player who drops and rejoins gets the current state and keeps the score (fails when rejoin resets or loses state)", f"{score_before} -> {score_after}")
    for q in range(2, 5):
        await host.send({"type": "next"})
        await host.wait("question", lambda f, q=q: f["qIdx"] == q)
        for c_, choice in ((host, rs.STORE.get(code).questions[q]["correct"]), (p2, 0), (p3, 1)):
            await c_.send({"type": "answer", "qIdx": q, "choice": choice})
        await host.wait("reveal", lambda f, q=q: f["qIdx"] == q, timeout=14)
    await host.send({"type": "next"})
    fin = await p3.wait("final")
    podium = (fin or {}).get("podium", [])
    ordered = [r["score"] for r in (fin or {}).get("board", [])]
    check("WS-G4", fin is not None and len(podium) == 3 and ordered == sorted(ordered, reverse=True) and podium[0]["name"] == "WS Player 1",
          "final: podium of 3, board sorted by score, the all-correct host first (fails when ranking is wrong)", f"{podium}")
    qframes = [f for c_ in (host, p2, p3) for f in c_.frames if f.get("type") == "question"]
    leaked = [f for f in qframes if "correct" in f or "explanations" in f]
    check("WS-S1", len(qframes) >= 10 and not leaked,
          "SECRECY: no question frame carries `correct` or `explanations` (fails when question_frame leaks the answer; floor: >=10 frames captured)",
          f"frames={len(qframes)} leaked={len(leaked)}")
    for c_ in (host, p2, p3):
        await c_.close()
    await end_all_rooms()

    # ---- owner gone ----
    saved = rs.OWNER_GONE_S
    rs.OWNER_GONE_S = 1.0
    status, body = await create(t1)
    code = body["code"]
    host, p2 = await player(code, t1), await player(code, t2)
    await p2.wait("lobby", lambda f: len(f["players"]) == 2)
    await host.close()
    ended = await p2.wait("ended", timeout=6)
    rs.OWNER_GONE_S = saved
    check("WS-O1", ended is not None and ended.get("reason") == "owner_left" and rs.STORE.get(code) is None,
          "owner gone > OWNER_GONE_S -> players get ended{owner_left} and the room is removed (fails when a hostless room lives on)", f"{ended}")
    await p2.close()

    # ---- idle expiry (constants lowered IN THIS PROCESS) ----
    saved = (rs.IDLE_S, rs.SWEEP_INTERVAL_S)
    status, body = await create(t3)
    code = body["code"]
    p3 = await player(code, t3)
    await p3.wait("lobby")
    rs.IDLE_S = 0.5
    await asyncio.sleep(0.8)
    removed = await rs.STORE.sweep()
    ended = await p3.wait("ended", timeout=5)
    cc, n = await refused(code, t3)
    rs.IDLE_S, rs.SWEEP_INTERVAL_S = saved
    check("WS-E1", code in removed and ended is not None and ended.get("reason") == "expired" and cc == 4404,
          "an idle room expires: players get ended{expired}, the code then closes 4404 (fails when rooms never expire)", f"removed={removed} ended={ended} reconnect={cc}")
    await p3.close()
    # the sweep loop itself runs on its interval
    rs.SWEEP_INTERVAL_S, rs.IDLE_S = 0.3, 0.2
    if rs.STORE._sweeper is not None:
        rs.STORE._sweeper.cancel()
        rs.STORE._sweeper = None
    status, body = await create(t4)
    await asyncio.sleep(1.5)
    auto = rs.STORE.get(body.get("code", "")) is None
    rs.IDLE_S, rs.SWEEP_INTERVAL_S = saved
    if rs.STORE._sweeper is not None:
        rs.STORE._sweeper.cancel()
        rs.STORE._sweeper = None
    check("WS-E2", status == 200 and auto, "the background sweep removes an idle room on its own (fails when the sweeper is never started)", f"status={status} removed={auto}")

    # ---- a finished room also expires ----
    saved_final = rs.FINAL_KEEP_S
    status, body = await create(t2, q_count=5)
    code = body["code"]
    room = rs.STORE.get(code)
    room.state, room.final_at = "final", time.monotonic() - 1
    rs.FINAL_KEEP_S = 0.5
    removed = await rs.STORE.sweep()
    rs.FINAL_KEEP_S = saved_final
    check("WS-E3", code in removed, "a finished room is removed FINAL_KEEP_S after the podium (fails when final rooms are kept forever)", f"removed={removed}")

    # ---- frame size limit (the unit's --ws-max-size 65536) ----
    status, body = await create(t1)
    code = body["code"]
    big = await player(code, t1)
    await big.wait("lobby")
    try:
        await big.ws.send("x" * 70_000)
    except ConnectionClosed:
        pass
    try:
        await asyncio.wait_for(asyncio.shield(big._task), 5)
    except asyncio.TimeoutError:
        await big.close()                                   # the server kept the socket: no limit
    check("WS-F1", big.closed_code == 1009, "a 70 KB frame is refused with 1009 (fails when --ws-max-size 65536 is not applied)", f"close={big.closed_code}")
    await end_all_rooms()
    await asyncio.sleep(0.5)
    check("WS-C1", rs.STORE.sockets == 0, "every socket slot is released after its connection ends (fails when the global count leaks)", f"sockets={rs.STORE.sockets}")


async def run():
    # R_WS_FAULT_NO_MAXSIZE=1 is the red-first switch for WS-F1 ONLY: the server starts without the
    # unit's --ws-max-size, so WS-F1 must go red. Never set by run-gates-react.sh.
    max_size = 16 * 1024 * 1024 if os.environ.get("R_WS_FAULT_NO_MAXSIZE") == "1" else 65536
    config = uvicorn.Config(main.app, host="127.0.0.1", port=PORT, log_level="warning", lifespan="off",
                            ws_max_size=max_size, ws_per_message_deflate=False, ws_ping_interval=25)
    server = uvicorn.Server(config)
    serving = asyncio.create_task(server.serve())
    for _ in range(80):
        if server.started:
            break
        await asyncio.sleep(0.1)
    if not server.started:
        print("IN-PROCESS SERVER DID NOT START", file=sys.stderr)
        sys.exit(2)
    acc = await asyncio.to_thread(make_accounts)
    try:
        await asyncio.wait_for(suite(acc), 240)
    finally:
        await asyncio.to_thread(drop_accounts)
        server.should_exit = True
        await asyncio.gather(serving, return_exceptions=True)


if __name__ == "__main__":
    asyncio.run(run())
    passed = sum(RESULTS)
    print(f"\n{passed}/{len(RESULTS)} passed")
    sys.exit(0 if passed == len(RESULTS) and RESULTS else 1)
