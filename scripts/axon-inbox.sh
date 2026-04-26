#!/usr/bin/env bash
set -euo pipefail

: "${ENGRAM_WORKER_URL:=http://localhost:37779}"
: "${ENGRAM_API_KEY:?ENGRAM_API_KEY is required}"
: "${ENGRAM_AGENT_NAME:?ENGRAM_AGENT_NAME is required}"

LIMIT="${1:-10}"
UNREAD_ONLY="${2:-true}"

response=$(curl -fsS \
  -H "x-api-key: $ENGRAM_API_KEY" \
  "${ENGRAM_WORKER_URL%/}/api/agents/messages/inbox?name=$(printf '%s' "$ENGRAM_AGENT_NAME" | jq -sRr @uri)&unread_only=${UNREAD_ONLY}&limit=${LIMIT}" 2>/dev/null) || {
  echo -e "\033[31mFailed to reach Engram inbox\033[0m" >&2
  exit 1
}

count=$(echo "$response" | jq '.messages | length' 2>/dev/null || echo 0)

if [[ "$count" -eq 0 ]]; then
  echo -e "\033[32mInbox empty — no unread messages\033[0m"
  exit 0
fi

echo -e "\033[1m${count} message(s) for ${ENGRAM_AGENT_NAME}:\033[0m"
echo

echo "$response" | jq -r '.messages[] | "\(.id)\t\(.sender)\t\(.created_at // .timestamp // "unknown")\t\(.content)"' 2>/dev/null | while IFS=$'\t' read -r id sender ts content; do
  ts_short="${ts%T*}"
  preview="${content:0:200}"
  echo -e "  \033[36m#${id}\033[0m \033[1m${sender}\033[0m \033[90m(${ts_short})\033[0m"
  echo -e "    ${preview}"
  echo
done
