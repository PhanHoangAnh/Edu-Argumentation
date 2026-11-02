#!/usr/bin/env python3
"""R13 weight probe: time every newly-unblocked python listing against the REAL runner.

Bounded by the runner itself: CELL_TIMEOUT_SECONDS=60 per cell and
REQUEST_BUDGET_SECONDS=80 per request. A cell that would run forever is killed
at 60 s and reported "timeout" -- the cap IS the bound, so nothing here can run
away. Memory is bounded by the unit cgroup (MemoryMax=6G): an over-heavy cell
kills its kernel and returns "restarted", which is also a measurement.

Per-cell timing trick: cells are requested incrementally (target=c1, then c2,
...) in ONE session. The runner memoises executed cells by source digest, so
request k only executes cell k and elapsed_ms IS that cell own cost.
"""
import json, sys, time, urllib.request
sys.path.insert(0, "/var/tmp")
import code_cells as CC

PROXY = "http://127.0.0.1:8767/api/run"
RESET = "http://127.0.0.1:8767/api/run/reset-kernel"

doc = json.load(open("/var/tmp/r13/live.json"))
avail = json.load(open("/var/tmp/r13/runner-modules.json"))
only = set(sys.argv[1:]) if len(sys.argv) > 1 else None

def post(url, payload, tmo):
    req = urllib.request.Request(url, data=json.dumps(payload).encode(),
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=tmo) as r:
        return json.load(r)

results = []
for si, sec in enumerate(doc.get("tutorialData", {}).get("sections", []) or []):
    chap = si + 1
    if only and str(chap) not in only:
        continue
    chain = CC.collect_chain(sec)
    if not chain:
        continue
    stats = dict(not_python=0, missing_module=0, chain_blocked=0, deprompted=0)
    CC.classify(chain, avail, stats)
    lesson = CC.chain_lesson(sec, si)
    cells = [{"id": "c%02d" % (i + 1), "source": l["source"]} for i, l in enumerate(chain)]
    if len(cells) > 50:
        cells = cells[:50]
    sess = "r13probech%02d" % chap
    try:
        post(RESET, {"session": sess, "module": "geron-homl3", "lesson": lesson}, 60)
    except Exception as e:
        print("reset failed ch%02d: %s" % (chap, e), file=sys.stderr)
    for i, cell in enumerate(cells):
        link = chain[i]
        payload = {"session": sess, "module": "geron-homl3", "lesson": lesson,
                   "target": cell["id"], "cells": cells}
        t0 = time.time()
        try:
            res = post(PROXY, payload, 150)
        except Exception as e:
            res = {"status": "REQUEST-ERROR", "error": str(e)}
        wall = round(time.time() - t0, 1)
        row = dict(chapter=chap, cell=cell["id"], import_runnable=link.get("runnable"),
                   import_reason=link.get("reason"), status=res.get("status"),
                   elapsed_ms=res.get("elapsed_ms"), wall_s=wall,
                   ran=len(res.get("ran", []) or []),
                   head=cell["source"].strip().splitlines()[0][:70] if cell["source"].strip() else "")
        err = [o for o in (res.get("outputs") or []) if o.get("kind") == "error"]
        if err:
            row["error"] = (err[-1].get("ename", "") + ": " + str(err[-1].get("evalue", ""))[:110])
        results.append(row)
        print(json.dumps(row), flush=True)
        if res.get("status") != "ok":
            print(json.dumps(dict(chapter=chap, halted_at=cell["id"], status=res.get("status"))), flush=True)
            break
json.dump(results, open("/var/tmp/r13/weight-ch%s.json" % ("-".join(sorted(only)) if only else "all"), "w"), indent=1)
