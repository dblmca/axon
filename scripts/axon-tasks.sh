#!/usr/bin/env bash
set -euo pipefail

: "${ENGRAM_WORKER_URL:=http://localhost:37779}"
: "${ENGRAM_API_KEY:?ENGRAM_API_KEY is required}"
: "${ENGRAM_AGENT_NAME:?ENGRAM_AGENT_NAME is required}"

PROJECT="${ENGRAM_PROJECT:-axon}"

response=$(curl -fsS \
  -H "x-api-key: $ENGRAM_API_KEY" \
  "${ENGRAM_WORKER_URL%/}/api/tasks?project=$(printf '%s' "$PROJECT" | jq -sRr @uri)&assigned_to=$(printf '%s' "$ENGRAM_AGENT_NAME" | jq -sRr @uri)" 2>/dev/null) || {
  echo -e "\033[31mFailed to reach Engram tasks API\033[0m" >&2
  exit 1
}

tasks=$(echo "$response" | jq '[.tasks // .[] | select(.status != "done" and .status != "cancelled")]' 2>/dev/null || echo "[]")
count=$(echo "$tasks" | jq 'length' 2>/dev/null || echo 0)

if [[ "$count" -eq 0 ]]; then
  echo -e "\033[32mNo pending tasks for ${ENGRAM_AGENT_NAME}\033[0m"
  exit 0
fi

echo -e "\033[1m${count} active task(s) for ${ENGRAM_AGENT_NAME}:\033[0m"
echo

echo "$tasks" | jq -r '.[] | "\(.id)\t\(.title)\t\(.status)\t\(.priority // "medium")\t\(.graph_id // "")"' 2>/dev/null | while IFS=$'\t' read -r id title status priority graph; do
  case "$status" in
    in_progress) color="\033[33m" ;;
    blocked|input_required) color="\033[31m" ;;
    pending) color="\033[36m" ;;
    *) color="\033[0m" ;;
  esac
  graph_tag=""
  [[ -n "$graph" ]] && graph_tag=" \033[90m[${graph}]\033[0m"
  echo -e "  \033[1m#${id}\033[0m ${title}"
  echo -e "    ${color}${status}\033[0m | priority: ${priority}${graph_tag}"
  echo
done
