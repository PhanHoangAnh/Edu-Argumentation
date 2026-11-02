"""Add-on API routers (study-rooms-qna P1, 29-09-26).

One list literal of `<module>.router` names; gates/gate-routes.mjs counts them. Empty in P1.
Add-on modules use `import main as core` and touch `core.X` at CALL time only (main is
partially initialised when this package is imported).
"""
from fastapi import APIRouter

from addons import qna  # noqa: E402  (P2, 29-09-26)
from addons import rooms  # noqa: E402  (P3, 30-09-26: live quiz rooms, HTTP + WebSocket)
from addons import study_more  # noqa: E402  (exam-recall-suite P1, 22-10-26: review stats, prefs, flags, answer log)
from addons import history  # noqa: E402  (exam-recall-suite P2, 22-10-26: answer history + mastery, read-only)
from addons import exam  # noqa: E402  (exam-recall-suite P3, 22-10-26: timed mock exam, migration 007)

ADDON_ROUTERS: list[APIRouter] = [qna.router, rooms.router, study_more.router, history.router, exam.router]
