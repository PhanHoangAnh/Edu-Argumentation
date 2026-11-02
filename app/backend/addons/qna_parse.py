"""The Q&A grade parser (study-rooms-qna P2, 29-09-26). PURE: no I/O, no model call.

parse_grade(text) -> the normalised grade dict, or None. It NEVER invents a score: a reply that
does not carry a valid grade object is None, and the caller (addons/qna.py) retries once or
answers 502. A partial or default score must never reach the learner.

Scan rule (plan P2 item 3, V7): walk the text left to right. At each `{` or `[` try to decode ONE
JSON value there (raw_decode, so braces inside strings are handled). If a value decodes, it is
THE candidate at that position: valid -> return it; invalid -> jump past that value's end and keep
scanning. NEVER look inside a value that decoded — that is what stops `[{"score":9}]` and
`{"score":NaN,"x":{"score":9}}` passing through their inner object. If nothing decodes at a
position, move one character on.

NaN / Infinity / -Infinity decode as float('nan') and then fail the finite check.
"""
from __future__ import annotations

import json
import math
import re
from typing import Any

_FENCE = re.compile(r"```[A-Za-z0-9_-]*")
_DECODER = json.JSONDecoder(parse_constant=lambda _name: float("nan"))
LIST_KEYS = ("right", "wrong", "missing", "almost")


def _validate(value: Any) -> dict[str, Any] | None:
    if not isinstance(value, dict):
        return None
    score = value.get("score")
    # bool is an int subclass: `true` must not read as 1.
    if isinstance(score, bool) or not isinstance(score, (int, float)):
        return None
    if not math.isfinite(score) or score < 0 or score > 10:
        return None
    out: dict[str, Any] = {"score": score}
    for key in LIST_KEYS:
        items = value.get(key, [])
        if not isinstance(items, list) or not all(isinstance(item, str) for item in items):
            return None
        out[key] = items
    feedback = value.get("feedback", "")
    if not isinstance(feedback, str):
        return None
    out["feedback"] = feedback
    return out


def parse_grade(text: Any) -> dict[str, Any] | None:
    if not isinstance(text, str):
        return None
    source = _FENCE.sub("", text)
    index, size = 0, len(source)
    while index < size:
        if source[index] in "{[":
            try:
                value, end = _DECODER.raw_decode(source, index)
            except ValueError:
                index += 1
                continue
            valid = _validate(value)
            if valid is not None:
                return valid
            index = max(end, index + 1)
            continue
        index += 1
    return None
