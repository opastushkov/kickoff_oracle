#!/usr/bin/env bash
# ============================================================
#  Kickoff Oracle - JUROR launcher (a second laptop that JUDGES)
#  Run: ./start-juror.sh   (first time: chmod +x *.sh)
#  Same as the viewer, but it also runs the on-device AI so this
#  laptop can cast its own juror verdict (the two-device,
#  different-model jury). It still JOINS the host's room by invite
#  key - it just brings its own brain. First run downloads the
#  model (needs internet once), then judges fully offline.
#  Ctrl+C stops both. Helper output goes to sidecar.log.
# ============================================================
cd "$(dirname "$0")" || exit 1
git pull

cd frontend/sidecar || exit 1
# A half-finished install leaves node_modules without the native AI
# runtime; check for the actual binary, not just the folder.
if [ ! -x node_modules/bare-runtime-linux-x64/bin/bare ]; then
  rm -rf node_modules
  npm install
fi

# Verify the AI runtime actually executes on this machine.
if ! node_modules/bare-runtime-linux-x64/bin/bare --version >/dev/null 2>&1; then
  echo
  echo " ============================================================"
  echo "  WARNING: the on-device AI runtime does not run on this"
  echo "  machine (missing binary or blocked execution)."
  echo "  Continuing anyway - joining and betting still work,"
  echo "  but this laptop cannot judge until this is fixed."
  echo " ============================================================"
  echo
fi

node server.mjs >../../sidecar.log 2>&1 &
SIDECAR_PID=$!
trap 'kill "$SIDECAR_PID" 2>/dev/null' EXIT
echo "[start-juror] Helper (AI + P2P) running, PID $SIDECAR_PID - log: sidecar.log"

cd ..
[ -d node_modules ] || npx pnpm@11 install
( sleep 20; xdg-open http://localhost:5173 >/dev/null 2>&1 ) &
npx pnpm@11 dev
