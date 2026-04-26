#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

: "${AXON_QWEN_BASE_URL:=http://192.168.1.153:8081/v1}"
: "${AXON_QWEN_MODEL_ID:=Qwen3.6-35B-A3B-abliterated-Q4_K_M.gguf}"
: "${AXON_ENGRAM_MCP_SERVER:=/home/mmca/mcp-servers/engram-mcp/engram-mcp-server.mjs}"
: "${AXON_AGENTIC_MCP_SERVER:=/home/mmca/mcp-servers/agentic-mcp/agentic-mcp-server.mjs}"
: "${ENGRAM_WORKER_URL:=http://localhost:37779}"

PROFILE="$ROOT/profiles/axon.vector-qwen-engram.jsonc"
AGENT_NAME="axon-interop-test-$$"
SESSION_ID="interop-test-session-$$"
API="${ENGRAM_WORKER_URL%/}"
PASS=0
FAIL=0
TASK_ID=""
CHANNEL_ID=""

cleanup() {
  echo ""
  echo "--- Cleanup ---"
  if [[ -n "$TASK_ID" ]]; then
    curl -fsS -H "x-api-key: $ENGRAM_API_KEY" -X DELETE "$API/api/tasks/$TASK_ID" \
      -H "Content-Type: application/json" -d "{\"agent_name\":\"$AGENT_NAME\"}" >/dev/null 2>&1 || true
    echo "Deleted task $TASK_ID"
  fi
  if [[ -n "$CHANNEL_ID" ]]; then
    curl -fsS -H "x-api-key: $ENGRAM_API_KEY" -X DELETE "$API/api/channels/$CHANNEL_ID" \
      -H "Content-Type: application/json" -d "{\"agent_name\":\"$AGENT_NAME\"}" >/dev/null 2>&1 || true
    echo "Archived test channel $CHANNEL_ID"
  fi
  curl -fsS -H "x-api-key: $ENGRAM_API_KEY" -X POST "$API/api/agents/deregister" \
    -H "Content-Type: application/json" -d "{\"name\":\"$AGENT_NAME\"}" >/dev/null 2>&1 || true
  echo "Deregistered $AGENT_NAME"
  rm -rf "$smoke_dir" 2>/dev/null || true
}
trap cleanup EXIT

report() {
  local name="$1" result="$2"
  if [[ "$result" == "PASS" ]]; then
    PASS=$((PASS + 1))
    echo "  PASS  $name"
  else
    FAIL=$((FAIL + 1))
    echo "  FAIL  $name"
  fi
}

smoke_dir="$(mktemp -d)"

# --- Prerequisites ---
echo "=== Prerequisites ==="

if [[ -z "${ENGRAM_API_KEY:-}" ]]; then
  echo "ENGRAM_API_KEY is required." >&2
  exit 1
fi

if ! command -v bun >/dev/null 2>&1; then
  echo "bun is required." >&2
  exit 1
fi

if ! curl -fsS "$API/health" >/dev/null 2>&1; then
  echo "Engram worker at $API is not healthy." >&2
  exit 1
fi
echo "  OK  Engram worker healthy"

api_root="${AXON_QWEN_BASE_URL%/}"
health_url="${api_root%/v1}/health"
if ! curl -fsS "$health_url" >/dev/null 2>&1; then
  echo "Qwen endpoint at $AXON_QWEN_BASE_URL is not healthy." >&2
  exit 1
fi
echo "  OK  Qwen endpoint healthy"

if [[ ! -f "$PROFILE" ]]; then
  echo "Missing profile: $PROFILE" >&2
  exit 1
fi
echo "  OK  Profile exists"
echo ""

# --- Test a: Agent Registration ---
echo "=== Test a: Agent Registration ==="

reg_resp=$(curl -fsS -H "x-api-key: $ENGRAM_API_KEY" -X POST "$API/api/agents/register" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"$AGENT_NAME\",\"session_id\":\"$SESSION_ID\",\"hostname\":\"interop-test\",\"project\":\"axon\",\"source_ai\":\"axon-test\"}" 2>&1) || true

if echo "$reg_resp" | grep -q '"Agent registered"'; then
  report "agent_registration" "PASS"
else
  report "agent_registration" "FAIL"
  echo "    Response: $reg_resp"
fi

agents_resp=$(curl -fsS -H "x-api-key: $ENGRAM_API_KEY" "$API/api/agents" 2>&1) || true
if echo "$agents_resp" | grep -qF "$AGENT_NAME"; then
  report "agent_visible_in_list" "PASS"
else
  report "agent_visible_in_list" "FAIL"
fi
echo ""

# --- Test b: Message Send/Receive ---
echo "=== Test b: Message Send/Receive ==="

msg_marker="interop-ping-$$-$(date +%s)"
send_resp=$(curl -fsS -H "x-api-key: $ENGRAM_API_KEY" -X POST "$API/api/agents/messages" \
  -H "Content-Type: application/json" \
  -d "{\"sender\":\"$AGENT_NAME\",\"recipient\":\"$AGENT_NAME\",\"content\":\"$msg_marker\"}" 2>&1) || true

if echo "$send_resp" | grep -q '"Message sent"'; then
  report "message_send" "PASS"
else
  report "message_send" "FAIL"
  echo "    Response: $send_resp"
fi

inbox_resp=$(curl -fsS -H "x-api-key: $ENGRAM_API_KEY" "$API/api/agents/messages/inbox?name=$AGENT_NAME" 2>&1) || true
if echo "$inbox_resp" | grep -qF "$msg_marker"; then
  report "message_receive" "PASS"
else
  report "message_receive" "FAIL"
  echo "    Response: $inbox_resp"
fi
echo ""

# --- Test c: Channel Participation ---
echo "=== Test c: Channel Participation ==="

chan_name="#interop-test-$$"
chan_resp=$(curl -fsS -H "x-api-key: $ENGRAM_API_KEY" -X POST "$API/api/channels" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"$chan_name\",\"description\":\"interop test channel\",\"created_by\":\"$AGENT_NAME\"}" 2>&1) || true

CHANNEL_ID=$(echo "$chan_resp" | grep -oP '"id":\s*\K\d+' | head -1) || true

if [[ -n "$CHANNEL_ID" ]]; then
  report "channel_create" "PASS"
else
  report "channel_create" "FAIL"
  echo "    Response: $chan_resp"
fi

if [[ -n "$CHANNEL_ID" ]]; then
  curl -fsS -H "x-api-key: $ENGRAM_API_KEY" -X POST "$API/api/channels/$CHANNEL_ID/join" \
    -H "Content-Type: application/json" -d "{\"agent_name\":\"$AGENT_NAME\"}" >/dev/null 2>&1 || true

  chan_marker="chan-ping-$$-$(date +%s)"
  post_resp=$(curl -fsS -H "x-api-key: $ENGRAM_API_KEY" -X POST "$API/api/channels/$CHANNEL_ID/messages" \
    -H "Content-Type: application/json" \
    -d "{\"sender\":\"$AGENT_NAME\",\"content\":\"$chan_marker\"}" 2>&1) || true

  if echo "$post_resp" | grep -qF "$chan_marker"; then
    report "channel_post" "PASS"
  else
    report "channel_post" "FAIL"
    echo "    Response: $post_resp"
  fi

  read_resp=$(curl -fsS -H "x-api-key: $ENGRAM_API_KEY" \
    "$API/api/channels/$CHANNEL_ID/messages?agent_name=$AGENT_NAME&limit=1" 2>&1) || true
  if echo "$read_resp" | grep -qF "$chan_marker"; then
    report "channel_read" "PASS"
  else
    report "channel_read" "FAIL"
    echo "    Response: $read_resp"
  fi
else
  report "channel_post" "FAIL"
  report "channel_read" "FAIL"
fi
echo ""

# --- Test d: Task Creation ---
echo "=== Test d: Task Creation ==="

task_marker="interop-task-$$"
task_resp=$(curl -fsS -H "x-api-key: $ENGRAM_API_KEY" -X POST "$API/api/tasks" \
  -H "Content-Type: application/json" \
  -d "{\"title\":\"$task_marker\",\"project\":\"axon\",\"assigned_to\":\"$AGENT_NAME\",\"created_by\":\"$AGENT_NAME\",\"description\":\"automated interop test task\"}" 2>&1) || true

TASK_ID=$(echo "$task_resp" | grep -oP '"id":\s*\K\d+' | head -1) || true

if [[ -n "$TASK_ID" ]]; then
  report "task_create" "PASS"
else
  report "task_create" "FAIL"
  echo "    Response: $task_resp"
fi

tasks_resp=$(curl -fsS -H "x-api-key: $ENGRAM_API_KEY" "$API/api/tasks?project=axon&limit=50" 2>&1) || true
if echo "$tasks_resp" | grep -qF "$task_marker"; then
  report "task_visible_in_list" "PASS"
else
  report "task_visible_in_list" "FAIL"
fi
echo ""

# --- Test e: Context Retrieval ---
echo "=== Test e: Context Retrieval ==="

ctx_resp=$(curl -fsS -H "x-api-key: $ENGRAM_API_KEY" -X POST "$API/api/search/context" \
  -H "Content-Type: application/json" \
  -d '{"project":"axon","session_limit":1,"observation_limit":1}' 2>&1) || true

if echo "$ctx_resp" | grep -q '"project"'; then
  report "context_retrieval" "PASS"
else
  report "context_retrieval" "FAIL"
  echo "    Response: $ctx_resp"
fi
echo ""

# --- Summary ---
echo "=== Results ==="
TOTAL=$((PASS + FAIL))
echo "  $PASS/$TOTAL passed, $FAIL failed"

if [[ "$FAIL" -gt 0 ]]; then
  exit 1
fi
exit 0
