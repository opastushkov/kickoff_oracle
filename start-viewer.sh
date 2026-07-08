#!/usr/bin/env bash
# ============================================================
#  Kickoff Oracle - VIEWER launcher (the second laptop)
#  Run: ./start-viewer.sh   (first time: chmod +x *.sh)
#  No AI on this machine - it joins rooms, bets, and watches.
#  Ctrl+C stops both. Helper output goes to sidecar.log.
# ============================================================
cd "$(dirname "$0")" || exit 1
git pull

cd frontend/sidecar || exit 1
[ -d node_modules ] || npm install

QVAC_DISABLE_LLM=1 node server.mjs >../../sidecar.log 2>&1 &
SIDECAR_PID=$!
trap 'kill "$SIDECAR_PID" 2>/dev/null' EXIT
echo "[start-viewer] Helper (P2P only) running, PID $SIDECAR_PID - log: sidecar.log"

cd ..
[ -d node_modules ] || npx pnpm@11 install
( sleep 20; xdg-open http://localhost:5173 >/dev/null 2>&1 ) &
npx pnpm@11 dev
