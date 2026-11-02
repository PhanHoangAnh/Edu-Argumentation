#!/usr/bin/env bash
# S-vpn-lab / S-vpn-login / S-vpn-no-443 / S-public-lab (gate-lab-doors.mjs). Drives the REAL origins
# (http://192.168.100.66:8767 + :8798 over the VPN, https://160.30.252.66) — no tunnels, so it must
# run from a VPN client (10.10.100.0/24).
#
#   bash gates/run-gates-lab-doors.sh      [LAB_SHOTS=<dir>]
#
# Identity + memory rules are run-gates-lab.sh's: the owner's purpose='gate' session in
# nn:~/.config/foxai/lab-gate.tok (minted/revoked by the operator), read into the ENVIRONMENT only;
# refuses to start Chromium below LAB_MIN_AVAIL_MB (6000) MemAvailable.
set -euo pipefail
GATES_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MIN="${LAB_MIN_AVAIL_MB:-6000}"
avail=$(awk '/^MemAvailable:/{print int($2/1024)}' /proc/meminfo)
if (( avail < MIN )); then
  echo "DEFERRED: MemAvailable ${avail} MB < ${MIN} MB — not starting Chromium." >&2
  exit 3
fi
export TMPDIR=/var/tmp
LAB_TOKEN="$(ssh nn 'cat ~/.config/foxai/lab-gate.tok')" \
LAB_SHOTS="${LAB_SHOTS:-/var/tmp/lab-shots}" \
  node "$GATES_DIR/gate-lab-doors.mjs"
