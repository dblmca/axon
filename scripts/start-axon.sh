#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SESSION="axon"
AXON_ARGS=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --session)
      SESSION="$2"
      shift 2
      ;;
    --session=*)
      SESSION="${1#*=}"
      shift
      ;;
    --profile|--model|--project|--task)
      AXON_ARGS+=("$1" "$2")
      shift 2
      ;;
    --profile=*|--model=*|--project=*|--task=*|--worktree)
      AXON_ARGS+=("$1")
      shift
      ;;
    -*)
      echo "Unknown option: $1" >&2
      exit 1
      ;;
    *)
      SESSION="$1"
      shift
      ;;
  esac
done

if tmux has-session -t "$SESSION" 2>/dev/null; then
  echo "Session '$SESSION' already exists — attaching."
  exec tmux attach-session -t "$SESSION"
fi

export ENGRAM_TMUX_SESSION="$SESSION"

cmd="$(printf 'ENGRAM_TMUX_SESSION=%q %q' "$SESSION" "$ROOT/bin/axon")"
for arg in "${AXON_ARGS[@]}"; do
  cmd+=" $(printf '%q' "$arg")"
done
cmd+=" tui; exec bash"

tmux new-session -d -s "$SESSION" "$cmd"

echo "Started Axon in tmux session '$SESSION'."
echo "Attach: tmux attach -t $SESSION"
