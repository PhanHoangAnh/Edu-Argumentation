#!/usr/bin/env python3
"""stub-upstream.py — a LOOPBACK stand-in for 9router AND the .68:8790 runner.

edu-replatform Phase 04. Used ONLY by gates/run-gates-react.sh's write harness (:8796).

WHY A STUB. The write gates fire 21 quizzes, 61 asks, 31 grades and 121 runs to prove the
rate buckets reject at their thresholds. Against the real provider that is real budget spent
to test a counter, and against the real runner it is 121 kernel executions. Plan note: "use a
stub for the bucket test and say so" — this is that stub, and the report says so.

WHAT IT PROVES THAT A MOCK INSIDE THE APP COULD NOT. The app talks to it over real HTTP with
the real urllib code path, the real SSE parsing (response_content) and the real headers. And
it LOGS what it received — model name, Authorization/X-Edu-Runner-Key presence, the runner
payload — to a JSON-lines file, so a gate can assert BEHAVIOUR ("the tutor sent model X"),
not configuration ("the file says X").

  POST /v1/chat/completions   -> text/event-stream, like 9router (a non-streamed 9router reply
                                 is HTTP 200 with EMPTY content — so the stub streams too)
  POST /run /interrupt /restart -> runner JSON

  POST /__script              -> ⚑ study-rooms-qna P2 (29-09-26): SCRIPTED-REPLY QUEUE for fault
                                 injection. Body {"replies": [{"text": "...", "delay_s": 0}, ...],
                                 "reset": true|false}. The next N completions return those texts in
                                 order (same streamed format), each after its own delay_s. An empty
                                 queue = the default behaviour above, unchanged. {"reset": true} with
                                 no replies clears the queue.

Env: STUB_PORT (default 8797) · STUB_LOG (JSON lines, required) · STUB_DELAY (seconds, 0).
Never binds anything but 127.0.0.1.
"""
from __future__ import annotations

import json
import os
import re
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT = int(os.getenv("STUB_PORT", "8797"))
LOG = os.environ["STUB_LOG"]
DELAY = float(os.getenv("STUB_DELAY", "0"))
SCRIPT: list[dict] = []
SCRIPT_LOCK = threading.Lock()


def next_scripted() -> dict | None:
    with SCRIPT_LOCK:
        return SCRIPT.pop(0) if SCRIPT else None


def qna_kind(system: str) -> str | None:
    """The Q&A examiner's three prompts (app/backend/addons/qna.py)."""
    if "Q&A examiner" not in system:
        return None
    if "Write ONE open question" in system:
        return "qna-question"
    if "Grade the learner" in system:
        return "qna-grade"
    if "Give ONE short hint" in system:          # P2b (30-09-26): the optional hint
        return "qna-hint"
    return "qna-ask"


QNA_DEFAULT = {
    "qna-question": "Explain the main idea of this lesson in your own words.",
    "qna-grade": json.dumps({"score": 9, "right": ["stub point"], "almost": [], "missing": [], "wrong": [],
                             "feedback": "Stub grade."}),
    "qna-ask": "Stub answer from the theory.",
    "qna-hint": "Think about what the performance measure is.",
}


def record(entry: dict) -> None:
    with open(LOG, "a", encoding="utf-8") as handle:
        handle.write(json.dumps(entry) + "\n")


def quiz(count: int) -> dict:
    return {"questions": [{
        "question": f"Stub question {i + 1}?",
        "options": ["right", "wrong a", "wrong b", "wrong c"],
        "correct": 0,
        "explanations": ["yes", "no", "no", "no"],
    } for i in range(count)]}


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *args) -> None:  # quiet
        pass

    def _send(self, status: int, body: bytes, ctype: str) -> None:
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self) -> None:
        length = int(self.headers.get("Content-Length", "0"))
        payload = json.loads(self.rfile.read(length) or b"{}")
        if self.path == "/__script":
            with SCRIPT_LOCK:
                if payload.get("reset"):
                    SCRIPT.clear()
                SCRIPT.extend(r for r in payload.get("replies") or [] if isinstance(r, dict))
                queued = len(SCRIPT)
            self._send(200, json.dumps({"queued": queued}).encode(), "application/json")
            return
        if DELAY:
            time.sleep(DELAY)
        if self.path.endswith("/chat/completions"):
            # ⚑ 30-09-26 (study-rooms-qna P2, defect A): 9router REFUSES a request whose messages are
            #   all `system` — measured on nn for edu-tutor-claude AND edu-tutor-normal: HTTP 400
            #   "messages: at least one message is required" / "messages: Field required". The stub
            #   used to answer it, so /api/qna/question passed every gate and 502'd for the user.
            #   It now refuses exactly like the real provider, and logs the refusal.
            roles = [m.get("role") for m in payload.get("messages", []) if isinstance(m, dict)]
            if not any(r in ("user", "assistant") for r in roles):
                record({"kind": "refused-no-user", "model": payload.get("model"), "roles": roles})
                self._send(400, json.dumps({"error": {"message": "messages: at least one message is required"}}).encode(),
                           "application/json")
                return
            system = " ".join(str(m.get("content")) for m in payload.get("messages", []) if m.get("role") == "system")
            scripted = next_scripted()
            qkind = qna_kind(system)
            if scripted is not None or qkind:
                kind = qkind or "scripted"
                text = str(scripted.get("text", "")) if scripted is not None else QNA_DEFAULT[qkind]
                # P2b (30-09-26): the Q&A system prompt is logged (first 1200 chars) so a gate can
                #   prove the setup options (style, difficulty) reached the model. Fake data only.
                record({"kind": kind, "model": payload.get("model"), "stream": payload.get("stream"),
                        "auth": self.headers.get("Authorization", "")[:7], "scripted": scripted is not None,
                        "system": system[:1200] if qkind else ""})
                if scripted is not None and scripted.get("delay_s"):
                    time.sleep(float(scripted["delay_s"]))
                chunks = [text[i:i + 40] for i in range(0, len(text), 40)] or [""]
                body = "".join(f"data: {json.dumps({'choices': [{'delta': {'content': c}}]})}\n\n" for c in chunks)
                body += "data: [DONE]\n\n"
                self._send(200, body.encode(), "text/event-stream")
                return
            if "multiple-choice study questions" in system:
                count = int(re.search(r"Create exactly (\d+)", system).group(1))
                text, kind = json.dumps(quiz(count)), "quiz"
            elif "marking a junior data engineer" in system:
                user = next(m["content"] for m in payload["messages"] if m["role"] == "user")
                ns = [int(n) for n in re.findall(r"EXERCISE (\d+)", user)]
                text, kind = json.dumps({"results": [{"n": n, "verdict": "correct", "feedback": "stub"} for n in ns]}), "grade"
            else:
                text, kind = "SOURCE: lesson\n\nStub tutor answer.", "ask"
            record({"kind": kind, "model": payload.get("model"), "stream": payload.get("stream"),
                    "auth": self.headers.get("Authorization", "")[:7]})
            chunks = [text[i:i + 40] for i in range(0, len(text), 40)]
            body = "".join(f"data: {json.dumps({'choices': [{'delta': {'content': c}}]})}\n\n" for c in chunks)
            body += "data: [DONE]\n\n"
            self._send(200, body.encode(), "text/event-stream")
            return
        if self.path in ("/run", "/interrupt", "/restart"):
            record({"kind": "runner" + self.path, "key": bool(self.headers.get("X-Edu-Runner-Key")),
                    "cells": len(payload.get("cells") or []), "target": payload.get("target")})
            if self.path == "/run":
                target = payload.get("target")
                ran = [c["id"] for c in payload.get("cells") or []]
                out = {"status": "ok", "cell": target, "ran": ran,
                       "outputs": [{"cell": target, "kind": "stream", "name": "stdout", "text": "stub\n"}]}
            else:
                out = {"ok": True}
            self._send(200, json.dumps(out).encode(), "application/json")
            return
        self._send(404, b'{"error":"stub: unknown"}', "application/json")


if __name__ == "__main__":
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
