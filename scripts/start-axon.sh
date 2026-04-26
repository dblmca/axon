#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SESSION="${1:-axon}"

if tmux has-session -t "$SESSION" 2>/dev/null; then
  echo "Session '$SESSION' already exists — attaching."
  exec tmux attach-session -t "$SESSION"
fi

ENGRAM_API_KEY="$(grep ENGRAM_API_KEY ~/engram/engram-server/.env | cut -d= -f2)"
export ENGRAM_API_KEY
export ENGRAM_TMUX_SESSION="$SESSION"

tmux new-session -d -s "$SESSION" \
  "ENGRAM_API_KEY='${ENGRAM_API_KEY}' ENGRAM_TMUX_SESSION='${SESSION}' '$ROOT/scripts/run-vector-qwen.sh'; exec bash"

echo "Started Axon in tmux session '$SESSION'."
echo "Attach: tmux attach -t $SESSION"
