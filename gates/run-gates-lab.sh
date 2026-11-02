#!/usr/bin/env bash
# G-lab wrapper (plan lab-practice_24-09-26, contract C6/E15). Drives the LIVE Lab + study app
# through two ssh tunnels — never a local preview, never the public IP.
#
#   bash gates/run-gates-lab.sh            [LAB_SHOTS=<dir>]
#
# * Memory precondition (plan E3): refuses to start below LAB_MIN_AVAIL_MB (6000) MemAvailable —
#   Playwright + Chromium next to the chapter agents' TensorFlow jobs is how the box freezes.
# * Identity: the owner's purpose='gate' session, minted on nn and kept in
#   ~/.config/foxai/lab-gate.tok (mode 600) by the operator; this script reads it into the
#   ENVIRONMENT of the gate process (never argv, never a local file). Mint/revoke are the
#   operator's (see the plan's Notation block) so one token serves every gate in a session.
# * Tunnels 18798 -> nn:8798 (Lab) and 18767 -> nn:8767 (study) are torn down on exit.
set -euo pipefail
GATES_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MIN="${LAB_MIN_AVAIL_MB:-6000}"
avail=$(awk '/^MemAvailable:/{print int($2/1024)}' /proc/meminfo)
if (( avail < MIN )); then
  echo "DEFERRED: MemAvailable ${avail} MB < ${MIN} MB — not starting Chromium (plan E3)." >&2
  exit 3
fi
export TMPDIR=/var/tmp
LAB_SHOTS="${LAB_SHOTS:-/var/tmp/lab-shots}"
ssh -N -o ExitOnForwardFailure=yes -L 18798:127.0.0.1:8798 -L 18767:127.0.0.1:8767 nn &
TUNNEL=$!
trap 'kill $TUNNEL 2>/dev/null || true' EXIT
for _ in $(seq 1 20); do curl -s -o /dev/null http://127.0.0.1:18798/lab/api/health && break; sleep 0.5; done
LAB_TOKEN="$(ssh nn 'cat ~/.config/foxai/lab-gate.tok')" \
LAB_BASE=http://127.0.0.1:18798 STUDY_BASE=http://127.0.0.1:18767 LAB_SHOTS="$LAB_SHOTS" \
  node "$GATES_DIR/gate-lab.mjs"
