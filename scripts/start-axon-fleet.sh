#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COUNT="4"
AXON_ARGS=()
STARTED=()
SKIPPED=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --count)
      COUNT="$2"
      shift 2
      ;;
    --count=*)
      COUNT="${1#*=}"
      shift
      ;;
    --profile|--model|--project)
      AXON_ARGS+=("$1" "$2")
      shift 2
      ;;
    --profile=*|--model=*|--project=*)
      AXON_ARGS+=("$1")
      shift
      ;;
    -*)
      echo "Unknown option: $1" >&2
      exit 1
      ;;
    *)
      COUNT="$1"
      shift
      ;;
  esac
done

if ! [[ "$COUNT" =~ ^[0-9]+$ ]] || [[ "$COUNT" -lt 1 ]]; then
  echo "Count must be a positive integer." >&2
  exit 1
fi

for i in $(seq 1 "$COUNT"); do
  SESSION="axon-${i}"
  if tmux has-session -t "$SESSION" 2>/dev/null; then
    SKIPPED+=("$SESSION")
    continue
  fi

  cmd="$(printf 'ENGRAM_TMUX_SESSION=%q %q' "$SESSION" "$ROOT/bin/axon")"
  for arg in "${AXON_ARGS[@]}"; do
    cmd+=" $(printf '%q' "$arg")"
  done
  cmd+=" tui; exec bash"

  tmux new-session -d -s "$SESSION" "$cmd"
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
