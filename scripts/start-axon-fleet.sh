#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COUNT="${1:-4}"
STARTED=()
SKIPPED=()

ENGRAM_API_KEY="$(grep ENGRAM_API_KEY ~/engram/engram-server/.env | cut -d= -f2)"
export ENGRAM_API_KEY

for i in $(seq 1 "$COUNT"); do
  SESSION="axon-${i}"
  if tmux has-session -t "$SESSION" 2>/dev/null; then
    SKIPPED+=("$SESSION")
    continue
  fi
  tmux new-session -d -s "$SESSION" \
    "ENGRAM_API_KEY='${ENGRAM_API_KEY}' ENGRAM_TMUX_SESSION='${SESSION}' '$ROOT/scripts/run-vector-qwen.sh'; exec bash"
  STARTED+=("$SESSION")
done

echo "Fleet launch complete."
if [[ ${#STARTED[@]} -gt 0 ]]; then
  echo "  Started: ${STARTED[*]}"
fi
if [[ ${#SKIPPED[@]} -gt 0 ]]; then
  echo "  Already running: ${SKIPPED[*]}"
fi
echo "  Total: $COUNT sessions"
echo "  Attach: tmux attach -t axon-N"
