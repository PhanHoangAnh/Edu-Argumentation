#!/usr/bin/env bash
# Edu-Argumentation gate suite runner.
#
# WHY THIS SCRIPT EXISTS (read before editing):
#   The :8791 smoke harness is NOT a static file server. It is the real edu_server.py run
#   from the repo, serving static assets out of a SEPARATE tree (/var/tmp/edu-smoke).
#   So a BACKEND change needs a process restart and a FRONTEND change needs a file copy.
#   Before this script, the only defence against running gates against stale code was a
#   human remembering to `cp`. This script makes both structural.
#
# RULES BAKED IN (do not "simplify" these away):
#   * ./node_modules/.bin/playwright, NEVER npx  — npx fetches from the registry when the
#     package is absent, which breaks the offline story on the customer-facing machine.
#   * /var/tmp only. NEVER /tmp or /dev/shm: they are tmpfs (RAM) on the work PC.
#   * Counting regex is '^(PASS|FAIL)  ' with TWO trailing spaces. The one-space form also
#     matches the 'FAILED: ...' summary line and over-counts a red run.
#   * The 27/12/10 = 49 vector of gate.mjs/gate-q.mjs/gate-a.mjs is FROZEN. New gates go in
#     new files (gate-self.mjs, gate-b456.mjs) and are asserted SEPARATELY.
set -uo pipefail

GATES_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$GATES_DIR/../aws-quiz-app" && pwd)"
SMOKE_DIR="${GATE_SMOKE_DIR:-/var/tmp/edu-smoke}"
OUT_DIR="${GATE_OUT_DIR:-/var/tmp/p0-after}"
PORT="${GATE_PORT:-8791}"
export GATE_BASE="${GATE_BASE:-http://127.0.0.1:${PORT}}"

# R3/E2: the A-G18 baseline ships WITH the suite. Without this export gate-a.mjs reports
# 9/10 on a fresh checkout and the vector diff fails for entirely the wrong reason.
export A_G18_BASELINE="${A_G18_BASELINE:-$GATES_DIR/ag18-before.json}"

case "$SMOKE_DIR$OUT_DIR" in /tmp/*|*/dev/shm/*) echo "REFUSING: tmpfs path (RAM). Use /var/tmp." >&2; exit 2;; esac
mkdir -p "$OUT_DIR"

# ---------------------------------------------------------------------------
# HARNESS STATE — do not "simplify" the exclude list away.
#
# $SMOKE_DIR is NOT a copy of the repo. It is the repo's FRONTEND assets PLUS three
# things the repo does not contain and cannot regenerate:
#   lib/               the BOOK LIBRARY (EDU_LIBRARY_ROOT below points at it). ~102 MB,
#                      two real book packages. It exists ONLY here and on nn. A plain
#                      `rsync --delete` from the repo DELETES IT, and every gate then
#                      fails with a page.goto networkidle timeout, because the app
#                      retries the now-404 /book/<id>/module.json forever. Measured
#                      21-09-26: that wipe took the suite from 49 result lines to 0.
#   progress.json      the harness's own study progress
#   library-meta.json  the book titles the library list renders
#
# Only the FRONTEND is synced (index.html, js/, the small static assets). The server
# itself runs from $APP_DIR, so it is never copied here.
# ---------------------------------------------------------------------------
echo "== harness re-sync (frontend only): $APP_DIR -> $SMOKE_DIR =="
mkdir -p "$SMOKE_DIR"
rsync -a "$APP_DIR"/index.html "$APP_DIR"/favicon.svg "$APP_DIR"/logo.svg "$SMOKE_DIR"/
rsync -a --delete "$APP_DIR"/js/   "$SMOKE_DIR"/js/
rsync -a --delete "$APP_DIR"/data/ "$SMOKE_DIR"/data/

# Fail LOUDLY if the library root is missing. Before this guard the symptom was a
# 30 s networkidle timeout and a 0-line transcript — three suites "failing" for a
# reason that had nothing to do with the code under test.
if [ ! -f "$SMOKE_DIR/lib/geron-homl3/module.json" ]; then
  cat >&2 <<MSG
REFUSING TO RUN: the book library is missing at \$SMOKE_DIR/lib/.
  The gates measure REAL equations from the real Geron module; a stub will not do.
  Restore it (read-only, no service is touched):
    rsync -a nn:'~/foxai-data/edu-argumentation/library/geron-homl3/'                  $SMOKE_DIR/lib/geron-homl3/
    rsync -a nn:'~/foxai-data/edu-argumentation/library/openintro-statistics-2019-1045f2f5/' $SMOKE_DIR/lib/demo-book/
MSG
  exit 2
fi
[ -f "$SMOKE_DIR/progress.json" ]     || echo '{}' > "$SMOKE_DIR/progress.json"
[ -f "$SMOKE_DIR/library-meta.json" ] || echo '{}' > "$SMOKE_DIR/library-meta.json"

echo "== restarting the :$PORT smoke harness (a plain process — there is NO systemd unit) =="
# Only ever kills a local python3 edu_server.py on THIS port. Never touches anything on nn.
OLD_PIDS=$(ss -ltnpH "sport = :$PORT" 2>/dev/null | grep -oP 'pid=\K[0-9]+' | sort -u || true)
for p in $OLD_PIDS; do
  if ps -o args= -p "$p" 2>/dev/null | grep -q 'edu_server.py'; then kill "$p" 2>/dev/null || true; fi
done
sleep 1
( cd "$APP_DIR" && \
  EDU_LIBRARY_ROOT="$SMOKE_DIR/lib" \
  EDU_PROGRESS_PATH="$SMOKE_DIR/progress.json" \
  EDU_LIBRARY_META_PATH="$SMOKE_DIR/library-meta.json" \
  nohup python3 edu_server.py --port "$PORT" --directory "$SMOKE_DIR" \
    > "$OUT_DIR/harness-$PORT.log" 2>&1 & echo $! > "$OUT_DIR/harness-$PORT.pid" )
for _ in $(seq 1 40); do
  curl -sf -o /dev/null "$GATE_BASE/" && break; sleep 0.25
done
curl -sf -o /dev/null "$GATE_BASE/" || { echo "HARNESS DID NOT COME UP on $GATE_BASE"; exit 2; }
echo "   harness up: $GATE_BASE (pid $(cat "$OUT_DIR/harness-$PORT.pid"))"

PW="$GATES_DIR/node_modules/.bin/playwright"   # E6: never npx
[ -x "$PW" ] || { echo "MISSING $PW — run: cd gates && npm install && ./node_modules/.bin/playwright install chromium"; exit 2; }

RC=0
declare -A COUNT EXITC

run_suite () {   # $1 = suite file, $2 = transcript basename, $3 = expected result-line count
  local f="$1" tag="$2" want="$3" t="$OUT_DIR/$2.txt" c e
  echo "== $f =="
  ( cd "$GATES_DIR" && node "$f" ) > "$t" 2>&1; e=$?
  # R2: TWO trailing spaces. Rejects the 'FAILED: ...' summary line.
  c=$(grep -cE '^(PASS|FAIL)  ' "$t" || true)
  COUNT[$tag]=$c; EXITC[$tag]=$e
  # E4: belt AND braces — exit code alone is not trusted (gate-q.mjs shipped without one).
  if [ "$e" -ne 0 ]; then echo "   EXIT $e  <-- FAIL"; RC=1; else echo "   exit 0"; fi
  if [ "$c" -ne "$want" ]; then echo "   result lines $c, expected $want  <-- FAIL"; RC=1; else echo "   result lines $c/$want"; fi
  grep -E '^FAIL  ' "$t" || true
}

run_suite gate.mjs   gate   27
run_suite gate-q.mjs gateq  12
run_suite gate-a.mjs gatea  10

FROZEN=$(( ${COUNT[gate]} + ${COUNT[gateq]} + ${COUNT[gatea]} ))
echo
echo "== FROZEN VECTOR (gate.mjs + gate-q.mjs + gate-a.mjs) =="
echo "   ${COUNT[gate]} + ${COUNT[gateq]} + ${COUNT[gatea]} = $FROZEN  (must be 49)"
[ "$FROZEN" -eq 49 ] || { echo "   <-- FAIL: the frozen vector moved. This is a FAILED PHASE, not a new baseline."; RC=1; }

# ---- new-in-P0 suites: SEPARATE files, SEPARATE assertion (R1). They never touch the 49. ----
NEWTOTAL=0
if [ -f "$GATES_DIR/gate-b456.mjs" ]; then
  run_suite gate-b456.mjs b456 "${GATE_B456_COUNT:-6}"; NEWTOTAL=$(( NEWTOTAL + ${COUNT[b456]} ))
fi
# Ruling R24 (23-09-26): code runner removed, Copy button added. Its own file, own count.
if [ -f "$GATES_DIR/gate-copy.mjs" ]; then
  run_suite gate-copy.mjs copy "${GATE_COPY_COUNT:-7}"; NEWTOTAL=$(( NEWTOTAL + ${COUNT[copy]} ))
fi
if [ -f "$GATES_DIR/gate-self.mjs" ]; then
  # gate-self.mjs parses the transcripts above (R5), so it MUST run last.
  run_suite gate-self.mjs self "${GATE_SELF_COUNT:-6}"; NEWTOTAL=$(( NEWTOTAL + ${COUNT[self]} ))
fi

echo
echo "===================== SUMMARY ====================="
echo " frozen suites : $FROZEN / 49   (gate 27 | gate-q 12 | gate-a 10)"
echo " new suites    : $NEWTOTAL       (gate-b456 + gate-copy + gate-self — asserted separately, R1)"
echo " total         : $(( FROZEN + NEWTOTAL ))"
echo " transcripts   : $OUT_DIR/{gate,gateq,gatea,b456,copy,self}.txt"
[ "$RC" -eq 0 ] && echo " RESULT        : ALL GREEN" || echo " RESULT        : FAILED"
echo "==================================================="
exit $RC
